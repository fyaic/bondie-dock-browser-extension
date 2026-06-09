#!/usr/bin/env python3
"""
抓取网页内容并生成 Obsidian 笔记
特点：无头格式（无 frontmatter、无标题）、下载图片非截图
"""

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from readability import Document


def fetch_webpage(url: str) -> tuple[str, str]:
    """抓取网页，返回 (正文html, 标题)"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    # 微信公众号等特殊处理
    if 'mp.weixin.qq.com' in url:
        response.encoding = 'utf-8'
    else:
        response.encoding = response.apparent_encoding or 'utf-8'

    doc = Document(response.text)
    return doc.summary(), doc.title()


def download_image(img_url: str, output_dir: Path, index: int) -> str:
    """下载图片，返回相对路径"""
    try:
        response = requests.get(img_url, timeout=30)
        response.raise_for_status()

        # 确定文件扩展名
        content_type = response.headers.get('content-type', '')
        ext = '.png'
        if 'jpeg' in content_type or 'jpg' in content_type:
            ext = '.jpg'
        elif 'png' in content_type:
            ext = '.png'
        elif 'gif' in content_type:
            ext = '.gif'
        elif 'webp' in content_type:
            ext = '.webp'

        # 保存图片
        img_filename = f"image-{index:03d}{ext}"
        img_path = output_dir / "images" / img_filename
        img_path.parent.mkdir(parents=True, exist_ok=True)

        with open(img_path, 'wb') as f:
            f.write(response.content)

        return f"./images/{img_filename}"
    except Exception as e:
        print(f"下载图片失败 {img_url}: {e}", file=sys.stderr)
        return None


def html_to_markdown(html: str, base_url: str, output_dir: Path) -> str:
    """将 HTML 转换为 Markdown，下载图片"""
    from markdownify import markdownify as md

    # 简单提取图片并下载
    import re

    # 微信公众号使用 data-src，先替换为 src
    html = re.sub(r'data-src=["\']([^"\']+)["\']', r'src="\1"', html)

    img_pattern = r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>'

    def replace_img(match):
        img_url = match.group(1)
        if img_url.startswith('data:'):
            return ''  # 跳过 base64 图片

        # 转换为绝对 URL
        if img_url.startswith('//'):
            img_url = 'https:' + img_url
        elif img_url.startswith('/'):
            parsed = urlparse(base_url)
            img_url = f"{parsed.scheme}://{parsed.netloc}{img_url}"
        elif not img_url.startswith('http'):
            img_url = urljoin(base_url, img_url)

        # 下载图片
        nonlocal img_counter
        img_counter += 1
        local_path = download_image(img_url, output_dir, img_counter)

        if local_path:
            # 提取 alt 文本
            alt_match = re.search(r'alt=["\']([^"\']*)["\']', match.group(0))
            alt = alt_match.group(1) if alt_match else "图片"
            return f"![{alt}]({local_path})"
        else:
            return ''

    img_counter = 0
    html_with_local_images = re.sub(img_pattern, replace_img, html)

    # 转换为 markdown
    markdown = md(html_with_local_images, heading_style='ATX')

    return markdown


def clean_markdown(markdown: str, title: str) -> str:
    """清理 markdown，生成无头格式"""
    # 移除可能的 frontmatter
    markdown = re.sub(r'^---\s*\n.*?---\s*\n', '', markdown, flags=re.DOTALL)

    # 移除标题行（如果第一行是 # 标题）
    lines = markdown.split('\n')
    if lines and lines[0].startswith('# '):
        lines = lines[1:]

    # 清理空行
    while lines and lines[0].strip() == '':
        lines = lines[1:]

    return '\n'.join(lines).strip()


def main():
    parser = argparse.ArgumentParser(description='抓取网页并生成 Obsidian 笔记')
    parser.add_argument('url', help='要抓取的网页 URL')
    parser.add_argument('--output-dir', '-o', required=True, help='输出目录')
    parser.add_argument('--filename', '-f', help='输出文件名（不含扩展名）')
    parser.add_argument('--no-images', action='store_true', help='不下载图片')

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"正在抓取: {args.url}")

    # 抓取网页
    html, title = fetch_webpage(args.url)
    print(f"标题: {title}")

    # 生成文件名
    if args.filename:
        filename = args.filename
    else:
        # 从标题生成文件名
        filename = re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '-')
        filename = re.sub(r'-+', '-', filename)[:50]  # 限制长度

    # 转换 markdown
    if args.no_images:
        markdown = clean_markdown(html_to_markdown(html, args.url, output_dir), title)
    else:
        markdown = clean_markdown(html_to_markdown(html, args.url, output_dir), title)

    # 保存文件
    output_path = output_dir / f"{filename}.md"
    with open(output_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(markdown)

    print(f"已保存: {output_path}")

    # 返回信息
    result = {
        'title': title,
        'filename': filename,
        'output_path': str(output_path),
        'url': args.url
    }
    print(result)


if __name__ == '__main__':
    main()
