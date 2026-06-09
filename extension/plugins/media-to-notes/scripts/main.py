#!/usr/bin/env python3
"""
Web-Fetch v2 - 生产级网页抓取工具
支持 Playwright（优先）和 requests（fallback）

Usage:
    python main.py <url> [--output-dir DIR] [--no-images]

Example:
    python main.py "https://mp.weixin.qq.com/s/xxx"
    python main.py "https://zhuanlan.zhihu.com/p/xxx" -o ~/Documents/Readings
"""

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# 确保脚本目录在路径中
sys.path.insert(0, str(Path(__file__).parent))

from config import config
from fetcher import WebFetcher
from fetcher_requests import RequestsFetcher, RequestsImageDownloader
from image_processor import ImageProcessor
from formatter import MarkdownFormatter


def extract_images_from_html(html: str, base_url: str) -> list:
    """
    从 HTML 中提取图片信息
    返回格式与 Playwright 的 extract_images() 保持一致
    """
    images = []

    # 匹配 img 标签
    img_pattern = r'<img[^>]*>'
    img_tags = re.findall(img_pattern, html, re.IGNORECASE)

    for img_tag in img_tags:
        img_info = {}

        # 提取 src
        src_match = re.search(r'src=["\']([^"\']+)["\']', img_tag, re.IGNORECASE)
        if src_match:
            img_info['src'] = src_match.group(1)

        # 提取 data-src
        data_src_match = re.search(r'data-src=["\']([^"\']+)["\']', img_tag, re.IGNORECASE)
        if data_src_match:
            img_info['dataSrc'] = data_src_match.group(1)

        # 提取 data-original
        data_original_match = re.search(r'data-original=["\']([^"\']+)["\']', img_tag, re.IGNORECASE)
        if data_original_match:
            img_info['dataOriginal'] = data_original_match.group(1)

        # 提取 alt
        alt_match = re.search(r'alt=["\']([^"\']*)["\']', img_tag, re.IGNORECASE)
        img_info['alt'] = alt_match.group(1) if alt_match else ''

        # 检查是否是有效图片（排除 data URI 和图标）
        src = img_info.get('src', '')
        if src and not src.startswith('data:'):
            # 简单判断：假设大于一定尺寸的是有效图片
            # 由于无法获取实际尺寸，这里默认保留
            img_info['width'] = 200
            img_info['height'] = 200
            images.append(img_info)

    return images


def process_images_with_requests(base_url: str, content_html: str, output_dir: Path) -> dict:
    """
    使用 requests 下载图片
    从 content_html 中提取图片 URL 并下载
    """
    from urllib.parse import urljoin

    url_map = {}
    images = extract_images_from_html(content_html, base_url)

    if not images:
        print("[IMAGES] 未找到图片")
        return url_map

    print(f"[IMAGES] 找到 {len(images)} 张候选图片")

    # 创建图片下载器
    downloader = RequestsImageDownloader(base_url, output_dir)

    # 获取 Referer（微信图片需要）
    referer = downloader._get_referer(base_url)

    # 去重
    seen_urls = set()
    idx = 0

    for img_info in images:
        # 获取有效的图片 URL（处理懒加载）
        for attr in ['dataSrc', 'dataOriginal', 'src']:
            url = img_info.get(attr)
            if url and not url.startswith('data:'):
                break
        else:
            continue

        # 补全相对 URL
        if url.startswith('//'):
            url = 'https:' + url
        elif url.startswith('/'):
            url = urljoin(base_url, url)

        # 去重
        if url in seen_urls:
            continue
        seen_urls.add(url)

        # 下载图片
        local_path = downloader.download_image(url, idx, referer=referer)
        if local_path:
            relative_path = build_note_image_path(output_dir, local_path)
            url_map[url] = relative_path
            idx += 1

    print(f"[IMAGES] 成功下载 {len(url_map)} 张图片")
    return url_map


def build_note_image_path(output_dir: Path, image_path: Path) -> str:
    """生成从笔记目录到图片文件的相对路径。"""
    import os

    return Path(os.path.relpath(image_path, start=output_dir)).as_posix()


def fetch_with_playwright(url: str) -> dict:
    """
    使用 Playwright 抓取网页

    Returns:
        fetch_result dict
    """
    with WebFetcher() as fetcher:
        return fetcher.fetch(url)


def fetch_with_requests(url: str) -> dict:
    """
    使用 requests 抓取网页

    Returns:
        fetch_result dict
    """
    with RequestsFetcher() as fetcher:
        return fetcher.fetch(url)


def fetch_article(url: str, output_dir: Path, download_images: bool = True) -> dict:
    """
    抓取文章并生成笔记
    优先使用 Playwright，失败时 fallback 到 requests

    Args:
        url: 文章 URL
        output_dir: 输出目录
        download_images: 是否下载图片

    Returns:
        {
            'note_path': Path,
            'images_count': int,
            'word_count': int,
            'title': str,
        }
    """
    print(f"\n{'='*60}")
    print(f"Web-Fetch v2 - 网页抓取")
    print(f"{'='*60}")
    print(f"URL: {url}")
    print(f"输出: {output_dir}")
    print(f"下载图片: {download_images}")
    print(f"{'='*60}\n")

    # 创建输出目录
    output_dir.mkdir(parents=True, exist_ok=True)

    article_data = fetch_article_content(
        url=url,
        output_dir=output_dir,
        download_images=download_images,
    )
    fetch_result = article_data['fetch_result']
    formatter = article_data['formatter']
    formatted = {
        'note_content': article_data['content_markdown'],
    }
    fetcher_type = article_data['fetcher_type']

    # 4. 保存文件
    safe_title = formatter._sanitize_filename(fetch_result['title'])
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')

    # 笔记文件
    note_path = output_dir / f"{safe_title}.md"
    note_content = formatted['note_content']

    with open(note_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(note_content)

    print(f"\n{'='*60}")
    print(f"✓ 笔记已保存: {note_path}")
    print(f"  标题: {fetch_result['title']}")
    print(f"  字数: {formatter.stats['word_count']}")
    print(f"  图片: {formatter.stats['image_count']}")
    print(f"  抓取器: {fetcher_type}")
    print(f"{'='*60}\n")

    return {
        'note_path': note_path,
        'images_count': formatter.stats['image_count'],
        'word_count': formatter.stats['word_count'],
        'title': fetch_result['title'],
        'url': fetch_result['url'],
        'fetcher_type': fetcher_type,
    }


def fetch_article_content(url: str, output_dir: Path, download_images: bool = True) -> dict:
    """
    抓取文章并返回统一的中间结构，供 pipeline 复用。
    """
    fetch_result = None
    fetcher_type = None
    warnings = []

    print("[MAIN] 尝试使用 Playwright 抓取...")
    try:
        fetch_result = fetch_with_playwright(url)
        fetcher_type = 'playwright'
        print("[MAIN] Playwright 抓取成功")
    except Exception as e:
        error_message = f"Playwright 抓取失败，已回退到 requests：{e}"
        warnings.append(error_message)
        print(f"[MAIN] {error_message}")
        print("[MAIN] 回退到 requests...")

    if fetch_result is None:
        try:
            fetch_result = fetch_with_requests(url)
            fetcher_type = 'requests'
            print("[MAIN] requests 抓取成功")
        except Exception as e:
            print(f"[MAIN] requests 也失败: {e}")
            raise RuntimeError(f"抓取失败（Playwright 和 requests 均不可用）: {e}")

    print(f"[MAIN] 使用抓取器: {fetcher_type}")

    url_map = {}
    image_status = "skipped" if not download_images else "not_attempted"
    if download_images:
        try:
            if fetcher_type == 'playwright':
                with WebFetcher() as fetcher:
                    print("[IMAGES] Playwright 模式：提取图片...")
                    fetcher.page.goto(fetch_result['url'], wait_until='networkidle', timeout=config.fetch.timeout * 1000)
                    if config.fetch.wait_time > 0:
                        time.sleep(config.fetch.wait_time)
                    images = fetcher.extract_images()
                    if images:
                        processor = ImageProcessor(fetch_result['url'], output_dir)
                        url_map = processor.process_images(images)
            else:
                print("[IMAGES] requests 模式：提取图片...")
                url_map = process_images_with_requests(
                    fetch_result['url'],
                    fetch_result['content_html'],
                    output_dir
                )
            image_status = "downloaded" if url_map else "not_found"
        except Exception as e:
            image_status = "failed"
            error_message = f"图片抓取失败，已跳过图片继续流程：{e}"
            warnings.append(error_message)
            print(f"[IMAGES] {error_message}")

    formatter = MarkdownFormatter()
    content_markdown = formatter.build_content_markdown(fetch_result, url_map)
    return {
        'fetch_result': fetch_result,
        'fetcher_type': fetcher_type,
        'url_map': url_map,
        'formatter': formatter,
        'content_markdown': content_markdown,
        'warnings': warnings,
        'image_status': image_status,
    }


def main():
    parser = argparse.ArgumentParser(
        description='Web-Fetch v2 - 抓取网页并生成 Obsidian 笔记',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  python main.py "https://mp.weixin.qq.com/s/xxx"
  python main.py "https://zhuanlan.zhihu.com/p/xxx" -o ~/Documents/Readings
  python main.py "https://example.com/article" --no-images
        '''
    )

    parser.add_argument('url', help='要抓取的网页 URL')
    parser.add_argument(
        '-o', '--output-dir',
        type=Path,
        default=config.output.base_dir,
        help=f'输出目录 (默认: {config.output.base_dir})'
    )
    parser.add_argument(
        '--no-images',
        action='store_true',
        help='不下载图片'
    )
    parser.add_argument(
        '--wait',
        type=int,
        default=config.fetch.wait_time,
        help=f'页面加载等待时间，秒 (默认: {config.fetch.wait_time})'
    )

    args = parser.parse_args()

    # 更新配置
    config.fetch.wait_time = args.wait

    try:
        from pipeline import run_link_pipeline

        result = run_link_pipeline(
            url=args.url,
            output_dir=args.output_dir,
            download_images=not args.no_images
        )

        # 输出 JSON 格式结果（供其他工具调用）
        import json
        print(json.dumps({
            'success': result.status != 'failed',
            'status': result.status,
            'path': str(result.note_path),
            'title': result.asset.title,
            'url': result.asset.resolved_url,
            'content_type': result.asset.content_type,
            'tldr': result.analysis.tldr,
            'word_count': result.extra['word_count'],
            'images_count': result.extra['images_count'],
            'fetcher_type': result.extra['fetcher_type'],
            'warnings': result.extra.get('warnings', []),
            'image_status': result.extra.get('image_status', ''),
            'report': result.report_content,
            'enrichment_summary': result.enrichment.summary,
            'related_resources': [
                {
                    'title': item.title,
                    'url': item.url,
                    'category': item.category,
                    'source': item.source,
                    'note': item.note,
                }
                for item in result.enrichment.resources
            ],
            'generation_payload': result.generation_payload,
            'report_blocks': result.report_blocks,
            'report_payload': {
                'text': result.report_content,
                'blocks': result.report_blocks,
            },
        }, ensure_ascii=False, indent=2))

    except Exception as e:
        print(f"\n[ERROR] 抓取失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


# 导入 time 模块（用于 Playwright 图片提取时的 sleep）
import time


if __name__ == '__main__':
    main()
