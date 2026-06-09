"""
网页抓取 fallback - 使用 requests（无需浏览器）
支持微信公众号、知乎、B站等常见网站的正则提取
"""

import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse
from typing import Optional, Dict, Any, List

import requests
from config import config
from title_utils import pick_best_title


class RequestsFetcher:
    """
    轻量级网页抓取器 - 使用 requests
    作为 Playwright 的 fallback，处理静态页面
    """

    def __init__(self):
        # 使用 trust_env=False 绕过系统代理
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({
            'User-Agent': config.fetch.user_agent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        })

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器退出"""
        self.session.close()

    def fetch(self, url: str) -> Dict[str, Any]:
        """
        抓取网页

        Returns:
            {
                'url': str,
                'title': str,
                'html': str,
                'content_html': str,  # 提取的正文 HTML
                'site_type': Optional[str],
                'metadata': Dict,
            }
        """
        print(f"[FETCH] 使用 requests 抓取: {url}")

        # 发送请求
        response = self.session.get(url, timeout=config.fetch.timeout)
        response.raise_for_status()

        # 检测编码
        if response.encoding == 'ISO-8859-1':
            response.encoding = response.apparent_encoding

        html = response.text
        final_url = response.url

        print(f"[FETCH] 状态码: {response.status_code}")
        print(f"[FETCH] 内容长度: {len(html)} 字符")

        # 检测网站类型
        site_type = config.detect_site(final_url)

        # 提取标题
        # 提取正文
        content_html = self._extract_content(html, final_url, site_type)

        title = pick_best_title(
            self._extract_content_title(content_html),
            self._extract_meta_title(html),
            self._extract_title(html),
        )
        print(f"[FETCH] 标题: {title}")

        # 提取元数据
        metadata = self._extract_metadata(html, site_type)

        return {
            'url': final_url,
            'original_url': url,
            'title': title,
            'html': html,
            'content_html': content_html,
            'site_type': site_type,
            'metadata': metadata,
        }

    def _extract_title(self, html: str) -> str:
        """从 HTML 中提取标题"""
        # 尝试从 title 标签提取
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.DOTALL | re.IGNORECASE)
        if title_match:
            title = title_match.group(1).strip()
            # 清理 HTML 实体
            title = self._clean_html_entities(title)
            return title
        return "未命名"

    def _extract_meta_title(self, html: str) -> str:
        """从 meta 中提取标题。"""
        patterns = [
            r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']',
            r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:title["\']',
            r'<meta[^>]*name=["\']twitter:title["\'][^>]*content=["\']([^"\']+)["\']',
            r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']twitter:title["\']',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                return self._clean_html_tags(match.group(1))
        return ""

    def _extract_content_title(self, html: str) -> str:
        """从正文中提取 h1 标题。"""
        match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL | re.IGNORECASE)
        if match:
            return self._clean_html_tags(match.group(1))
        return ""

    def _extract_content(self, html: str, url: str, site_type: Optional[str]) -> str:
        """提取正文内容"""

        # 根据网站类型使用特定提取方法
        if site_type == 'wechat':
            return self._extract_wechat_content(html)
        elif site_type in ('zhihu', 'zhihu_answer'):
            return self._extract_zhihu_content(html)
        elif site_type == 'juejin':
            return self._extract_juejin_content(html)
        elif site_type == 'bilibili':
            return self._extract_bilibili_content(html)

        # 通用提取方法
        return self._extract_generic_content(html)

    def _extract_wechat_content(self, html: str) -> str:
        """提取微信公众号文章内容"""
        print("[EXTRACT] 使用微信公众号提取规则")

        # 正则匹配 js_content 区域
        patterns = [
            r'<div[^>]*id=["\']js_content["\'][^>]*>(.*?)</div>\s*(?=<script|</body>|<!--)',
            r'<div[^>]*id=["\']js_content["\'][^>]*>(.*?)</div>\s*</div>\s*</div>',
        ]

        for pattern in patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                content = match.group(1)
                print(f"[EXTRACT] 提取成功，长度: {len(content)}")
                return content

        print("[EXTRACT] 微信公众号特定规则失败，回退到通用方法")
        return self._extract_generic_content(html)

    def _extract_zhihu_content(self, html: str) -> str:
        """提取知乎文章内容"""
        print("[EXTRACT] 使用知乎提取规则")

        # 尝试匹配 RichContent 区域
        patterns = [
            r'<div[^>]*class=["\'][^"\']*RichContent-inner[^"\']*["\'][^>]*>(.*?)</div>\s*</div>\s*</div>\s*</div>',
            r'<div[^>]*class=["\']RichContent-inner["\'][^>]*>(.*?)</div>',
            r'<article[^>]*>(.*?)</article>',
        ]

        for pattern in patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                content = match.group(1)
                print(f"[EXTRACT] 提取成功，长度: {len(content)}")
                return content

        print("[EXTRACT] 知乎特定规则失败，回退到通用方法")
        return self._extract_generic_content(html)

    def _extract_juejin_content(self, html: str) -> str:
        """提取掘金文章内容"""
        print("[EXTRACT] 使用掘金提取规则")

        pattern = r'<article[^>]*class=["\']article-content["\'][^>]*>(.*?)</article>'
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)

        if match:
            print(f"[EXTRACT] 提取成功，长度: {len(match.group(1))}")
            return match.group(1)

        print("[EXTRACT] 掘金特定规则失败，回退到通用方法")
        return self._extract_generic_content(html)

    def _extract_bilibili_content(self, html: str) -> str:
        """提取 B站 文章内容"""
        print("[EXTRACT] 使用 B站提取规则")

        # 尝试匹配文章主体
        patterns = [
            r'<div[^>]*class=["\']article-content["\'][^>]*>(.*?)</div>\s*</div>\s*</div>',
            r'<div[^>]*id=["\']article-content["\'][^>]*>(.*?)</div>',
        ]

        for pattern in patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                content = match.group(1)
                print(f"[EXTRACT] 提取成功，长度: {len(content)}")
                return content

        print("[EXTRACT] B站特定规则失败，回退到通用方法")
        return self._extract_generic_content(html)

    def _extract_generic_content(self, html: str) -> str:
        """通用内容提取方法"""
        print("[EXTRACT] 使用通用提取规则")

        # 常见内容区域选择器（正则匹配）
        patterns = [
            # article 标签
            r'<article[^>]*>(.*?)</article>',
            # main 标签
            r'<main[^>]*>(.*?)</main>',
            # 常见 content 类
            r'<div[^>]*class=["\'][^"\']*(?:post-content|entry-content|article-content|content-main)[^"\']*["\'][^>]*>(.*?)</div>',
            # content id
            r'<div[^>]*id=["\']content["\'][^>]*>(.*?)</div>',
            # 正文 div
            r'<div[^>]*class=["\']rich_media_content["\'][^>]*>(.*?)</div>',
        ]

        for pattern in patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                content = match.group(1)
                # 检查内容长度，过滤掉太短的结果
                text_length = len(re.sub(r'<[^>]+>', '', content))
                if text_length > config.extraction.min_content_length:
                    print(f"[EXTRACT] 通用规则提取成功，长度: {len(content)}")
                    return content

        # 如果都找不到，返回 body 内容（清理后）
        body_match = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL | re.IGNORECASE)
        if body_match:
            print(f"[EXTRACT] 回退到 body 提取，长度: {len(body_match.group(1))}")
            return body_match.group(1)

        # 最后的回退
        print("[EXTRACT] 使用原始 HTML")
        return html

    def _extract_metadata(self, html: str, site_type: Optional[str]) -> Dict[str, str]:
        """提取元数据（作者、发布时间等）"""
        metadata = {}

        # 提取作者
        author_patterns = [
            r'<meta[^>]*name=["\']author["\'][^>]*content=["\']([^"\']+)["\']',
            r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']author["\']',
            r'<span[^>]*class=["\'][^"\']*author[^"\']*["\'][^>]*>(.*?)</span>',
            r'<a[^>]*class=["\'][^"\']*author[^"\']*["\'][^>]*>(.*?)</a>',
        ]

        for pattern in author_patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                author = self._clean_html_tags(match.group(1))
                if author and len(author) < 100:  # 过滤过长的匹配
                    metadata['author'] = author
                    break

        # 提取发布时间
        date_patterns = [
            r'<meta[^>]*name=["\']publish_time["\'][^>]*content=["\']([^"\']+)["\']',
            r'<meta[^>]*property=["\']article:published_time["\'][^>]*content=["\']([^"\']+)["\']',
            r'<time[^>]*datetime=["\']([^"\']+)["\']',
            r'<span[^>]*class=["\'][^"\']*time[^"\']*["\'][^>]*>(.*?)</span>',
        ]

        for pattern in date_patterns:
            match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
            if match:
                date = self._clean_html_tags(match.group(1))
                if date:
                    metadata['date'] = date
                    break

        return metadata

    def _clean_html_tags(self, text: str) -> str:
        """移除 HTML 标签"""
        text = re.sub(r'<[^>]+>', '', text)
        text = self._clean_html_entities(text)
        return text.strip()

    def _clean_html_entities(self, text: str) -> str:
        """清理 HTML 实体"""
        entities = {
            '&quot;': '"',
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&nbsp;': ' ',
            '&#39;': "'",
            '&ldquo;': '"',
            '&rdquo;': '"',
            '&hellip;': '...',
            '&mdash;': '—',
            '&ndash;': '–',
        }
        for entity, char in entities.items():
            text = text.replace(entity, char)
        # 处理数字实体
        text = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), text)
        return text.strip()

    def extract_images(self, base_url: str) -> List[dict]:
        """
        提取页面中的所有图片 URL
        返回格式与 Playwright 版本保持一致
        """
        # 这里只是接口兼容，实际图片提取需要配合 fetch 使用
        # 因为 requests 返回的是原始 HTML，图片提取在调用方处理
        print("[IMAGES] requests fetcher 不直接支持图片提取")
        return []

    def _get_referer(self, url: str) -> str:
        """获取 Referer 头"""
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/"


class RequestsImageDownloader:
    """
    图片下载器 - 使用 requests
    复用 WebFetcher.extract_images() 的思路
    """

    def __init__(self, base_url: str, output_dir: Path):
        self.base_url = base_url
        self.output_dir = output_dir
        self.images_dir = config.images.base_dir
        self.images_dir.mkdir(parents=True, exist_ok=True)

        # 使用 trust_env=False 绕过系统代理
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({
            'User-Agent': config.fetch.user_agent,
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        })

    def download_image(self, url: str, idx: int, referer: str = None) -> Optional[Path]:
        """
        下载单张图片

        Args:
            url: 图片 URL
            idx: 序号（用于生成文件名）
            referer: Referer 头（微信图片需要）

        Returns:
            本地文件路径，失败返回 None
        """
        try:
            # 补全相对 URL
            if url.startswith('//'):
                url = 'https:' + url
            elif url.startswith('/'):
                url = urljoin(self.base_url, url)

            print(f"[IMAGES] 下载: {url[:60]}...")

            # 设置请求头
            headers = {'User-Agent': config.fetch.user_agent}
            if referer:
                headers['Referer'] = referer
            else:
                # 使用来源网站作为 Referer
                headers['Referer'] = self._get_referer(self.base_url)

            # 下载
            response = self.session.get(url, headers=headers, timeout=30)
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
            import hashlib
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

        return '.png'

    def _get_referer(self, url: str) -> str:
        """获取 Referer 头"""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/"
