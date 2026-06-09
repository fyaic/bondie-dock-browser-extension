"""
图片处理模块
"""

import hashlib
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from typing import Dict, List, Set
import requests

from config import config


class ImageProcessor:
    """图片处理器"""

    def __init__(self, base_url: str, output_dir: Path):
        self.base_url = base_url
        self.output_dir = output_dir
        self.images_dir = config.images.base_dir
        self.images_dir.mkdir(parents=True, exist_ok=True)

        # 跟踪已下载的图片 {original_url: local_path}
        self.downloaded: Dict[str, str] = {}
        self.seen_urls: Set[str] = set()

    def process_images(self, images: List[dict]) -> Dict[str, str]:
        """
        处理图片列表

        Args:
            images: 从页面提取的图片信息列表

        Returns:
            {original_url: relative_path}
        """
        url_map = {}

        for idx, img_info in enumerate(images):
            # 获取有效的图片 URL（处理懒加载）
            img_url = self._get_image_url(img_info)
            if not img_url:
                continue

            # 去重检查
            if img_url in self.seen_urls:
                continue
            self.seen_urls.add(img_url)

            # 下载图片
            local_path = self._download_image(img_url, idx)
            if local_path:
                relative_path = self._build_note_image_path(local_path)
                url_map[img_url] = relative_path
                self.downloaded[img_url] = relative_path

        print(f"[IMAGES] 成功下载 {len(url_map)} 张图片")
        return url_map

    def _get_image_url(self, img_info: dict) -> str:
        """获取有效的图片 URL，处理懒加载"""
        # 按优先级尝试不同的属性
        for attr in config.images.lazy_load_attrs:
            url = img_info.get(attr) or img_info.get(attr.replace('-', '_'))
            if url and not url.startswith('data:'):
                return url

        return None

    def _download_image(self, url: str, idx: int) -> Path:
        """下载单张图片"""
        try:
            # 补全相对 URL
            if url.startswith('//'):
                url = 'https:' + url
            elif url.startswith('/'):
                from urllib.parse import urljoin
                url = urljoin(self.base_url, url)

            print(f"[IMAGES] 下载: {url[:60]}...")

            # 下载
            headers = {'User-Agent': config.fetch.user_agent}
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()

            content = response.content

            # 检查大小
            size_mb = len(content) / (1024 * 1024)
            if size_mb > config.images.max_size_mb:
                print(f"[IMAGES] 跳过过大的图片: {size_mb:.1f}MB")
                return None

            # 确定扩展名
            ext = self._get_extension(url, response.headers.get('content-type', ''))

            # 生成文件名（使用 hash 避免冲突）
            url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
            filename = f"img-{idx+1:03d}-{url_hash}{ext}"
            filepath = self.images_dir / filename

            # 保存
            with open(filepath, 'wb') as f:
                f.write(content)

            print(f"[IMAGES] 保存: {filename} ({len(content)/1024:.1f}KB)")
            return filepath

        except Exception as e:
            print(f"[IMAGES] 下载失败: {e}", file=sys.stderr)
            return None

    def _get_extension(self, url: str, content_type: str) -> str:
        """确定图片扩展名"""
        # 从 URL 推断
        url_lower = url.lower()
        if '.jpg' in url_lower or '.jpeg' in url_lower:
            return '.jpg'
        elif '.png' in url_lower:
            return '.png'
        elif '.gif' in url_lower:
            return '.gif'
        elif '.webp' in url_lower:
            return '.webp'
        elif '.svg' in url_lower:
            return '.svg'

        # 从 Content-Type 推断
        content_type = content_type.lower()
        if 'jpeg' in content_type or 'jpg' in content_type:
            return '.jpg'
        elif 'png' in content_type:
            return '.png'
        elif 'gif' in content_type:
            return '.gif'
        elif 'webp' in content_type:
            return '.webp'
        elif 'svg' in content_type:
            return '.svg'

        # 默认
        return '.png'

    def _build_note_image_path(self, image_path: Path) -> str:
        """生成从笔记目录到图片目录的相对引用路径。"""
        try:
            relative = image_path.relative_to(self.output_dir)
            return relative.as_posix()
        except ValueError:
            return Path(os.path.relpath(image_path, start=self.output_dir)).as_posix()

    def replace_image_urls(self, markdown: str, url_map: Dict[str, str]) -> str:
        """替换 Markdown 中的图片 URL 为 Obsidian 内嵌格式。"""
        import re

        # 匹配 ![alt](url) 格式
        def replace_match(match):
            url = match.group(2)

            # 查找对应的本地路径
            if url in url_map:
                return self._to_obsidian_embed(url_map[url])

            # 尝试其他变体
            for original_url, local_path in url_map.items():
                if original_url in url or url in original_url:
                    return self._to_obsidian_embed(local_path)

            # 未找到映射，保留原样
            return match.group(0)

        # 替换所有图片链接
        result = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', replace_match, markdown)

        return result

    def _to_obsidian_embed(self, path: str) -> str:
        return f"![[{path}]]"
