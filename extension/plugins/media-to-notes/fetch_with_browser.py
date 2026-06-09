#!/usr/bin/env python3
"""
使用 Playwright 抓取网页（支持 JavaScript 渲染）
适合反爬严格的网站（微信公众号、SPA 应用等）
"""

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse


def fetch_with_playwright(url: str, output_dir: Path, wait_time: int = 3):
    """使用 Playwright 抓取网页"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("错误: 请先安装 Playwright: pip install playwright", file=sys.stderr)
        print("然后安装浏览器: playwright install chromium", file=sys.stderr)
        sys.exit(1)

    with sync_playwright() as p:
        # 启动无头浏览器
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = context.new_page()

        print(f"正在打开: {url}")
        page.goto(url, wait_until='networkidle')

        # 额外等待，让懒加载图片加载
        print(f"等待 {wait_time} 秒让页面完全加载...")
        page.wait_for_timeout(wait_time * 1000)

        # 获取标题
        title = page.title()
        print(f"标题: {title}")

        # 提取正文（使用 readability 或自定义逻辑）
        # 对于微信公众号，可以尝试直接提取 #js_content
        content_html = page.evaluate('''() => {
            // 尝试提取主要内容区域
            const content = document.querySelector('#js_content') ||  // 微信公众号
                             document.querySelector('article') ||
                             document.querySelector('.post-content') ||
                             document.querySelector('main') ||
                             document.body;
            return content ? content.innerHTML : document.body.innerHTML;
        }''')

        # 下载图片
        images = page.evaluate('''() => {
            const imgs = document.querySelectorAll('img');
            return Array.from(imgs).map(img => ({
                src: img.src,
                alt: img.alt || '图片'
            })).filter(img => img.src && !img.src.startsWith('data:'));
        }''')

        print(f"找到 {len(images)} 张图片")

        # 创建输出目录
        output_dir.mkdir(parents=True, exist_ok=True)
        images_dir = output_dir / "images"
        images_dir.mkdir(exist_ok=True)

        # 下载图片
        image_map = {}
        for i, img in enumerate(images):
            try:
                img_url = img['src']
                ext = '.png'
                if '.jpg' in img_url or '.jpeg' in img_url:
                    ext = '.jpg'
                elif '.gif' in img_url:
                    ext = '.gif'
                elif '.webp' in img_url:
                    ext = '.webp'

                img_filename = f"image-{i+1:03d}{ext}"
                img_path = images_dir / img_filename

                # 使用 Playwright 下载图片
                img_page = context.new_page()
                response = img_page.request.get(img_url)
                if response.status == 200:
                    with open(img_path, 'wb') as f:
                        f.write(response.body())
                    image_map[img_url] = f"./images/{img_filename}"
                    print(f"下载图片: {img_filename}")
                img_page.close()
            except Exception as e:
                print(f"下载图片失败: {e}", file=sys.stderr)

        browser.close()

        # 转换为 Markdown
        from markdownify import markdownify as md
        markdown = md(content_html, heading_style='ATX')

        # 替换图片路径
        for old_url, new_path in image_map.items():
            markdown = markdown.replace(old_url, new_path)

        # 清理：移除 frontmatter 和标题
        markdown = re.sub(r'^---\s*\n.*?---\s*\n', '', markdown, flags=re.DOTALL)
        lines = markdown.split('\n')
        if lines and lines[0].startswith('# '):
            lines = lines[1:]
        while lines and lines[0].strip() == '':
            lines = lines[1:]
        markdown = '\n'.join(lines).strip()

        # 生成文件名
        safe_title = re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '-')[:50]
        safe_title = re.sub(r'-+', '-', safe_title)
        if not safe_title:
            safe_title = 'article'

        # 保存文件
        output_path = output_dir / f"{safe_title}.md"
        with open(output_path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(markdown)

        print(f"已保存: {output_path}")
        return {
            'title': title,
            'filename': safe_title,
            'output_path': str(output_path),
            'image_count': len(image_map)
        }


def main():
    parser = argparse.ArgumentParser(description='使用 Playwright 抓取网页')
    parser.add_argument('url', help='要抓取的网页 URL')
    parser.add_argument('--output-dir', '-o', required=True, help='输出目录')
    parser.add_argument('--wait', '-w', type=int, default=3, help='等待页面加载的秒数')

    args = parser.parse_args()

    result = fetch_with_playwright(args.url, Path(args.output_dir), args.wait)
    print(result)


if __name__ == '__main__':
    main()
