"""
输出格式化模块
"""

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any

from config import config


class MarkdownFormatter:
    """Markdown 格式化器"""

    def __init__(self):
        self.stats = {
            'word_count': 0,
            'image_count': 0,
            'heading_count': 0,
        }

    def build_content_markdown(self, fetch_result: Dict[str, Any], url_map: Dict[str, str]) -> str:
        """生成清洗后的正文 Markdown。"""
        content_md = self._html_to_markdown(fetch_result['content_html'])

        if url_map:
            from image_processor import ImageProcessor
            processor = ImageProcessor(fetch_result['url'], Path('.'))
            content_md = processor.replace_image_urls(content_md, url_map)
            self.stats['image_count'] = len(url_map)
        else:
            self.stats['image_count'] = 0

        return self._clean_markdown(content_md)

    def _html_to_markdown(self, html: str) -> str:
        """将 HTML 转换为 Markdown"""
        try:
            from markdownify import markdownify as md

            # 使用 markdownify 转换
            markdown = md(
                html,
                heading_style='ATX',  # # 风格的标题
                bullets='-',  # 使用 - 作为列表符号
                strip=['script', 'style', 'nav', 'footer', 'header', 'aside'],
            )

            return markdown
        except ImportError:
            print("[WARN] markdownify 未安装，使用基础转换", file=sys.stderr)
            # 基础 HTML 标签替换
            return self._basic_html_to_markdown(html)

    def _basic_html_to_markdown(self, html: str) -> str:
        """基础的 HTML 到 Markdown 转换（备选方案）"""
        import re

        # 移除 script 和 style
        html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)

        # 转换常见标签
        html = re.sub(r'<h1[^>]*>(.*?)</h1>', r'# \1', html, flags=re.IGNORECASE)
        html = re.sub(r'<h2[^>]*>(.*?)</h2>', r'## \1', html, flags=re.IGNORECASE)
        html = re.sub(r'<h3[^>]*>(.*?)</h3>', r'### \1', html, flags=re.IGNORECASE)
        html = re.sub(r'<h4[^>]*>(.*?)</h4>', r'#### \1', html, flags=re.IGNORECASE)
        html = re.sub(r'<h5[^>]*>(.*?)</h5>', r'##### \1', html, flags=re.IGNORECASE)
        html = re.sub(r'<h6[^>]*>(.*?)</h6>', r'###### \1', html, flags=re.IGNORECASE)

        html = re.sub(r'<strong[^>]*>(.*?)</strong>', r'**\1**', html, flags=re.IGNORECASE)
        html = re.sub(r'<b[^>]*>(.*?)</b>', r'**\1**', html, flags=re.IGNORECASE)
        html = re.sub(r'<em[^>]*>(.*?)</em>', r'*\1*', html, flags=re.IGNORECASE)
        html = re.sub(r'<i[^>]*>(.*?)</i>', r'*\1*', html, flags=re.IGNORECASE)

        html = re.sub(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', r'[\2](\1)', html, flags=re.IGNORECASE)
        html = re.sub(r'<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*/>', r'![\2](\1)', html, flags=re.IGNORECASE)
        html = re.sub(r'<img[^>]+alt="([^"]*)"[^>]+src="([^"]+)"[^>]*/>', r'![\1](\2)', html, flags=re.IGNORECASE)

        html = re.sub(r'<br\s*/?>', '\n', html, flags=re.IGNORECASE)
        html = re.sub(r'<p[^>]*>(.*?)</p>', r'\1\n\n', html, flags=re.IGNORECASE)
        html = re.sub(r'<li[^>]*>(.*?)</li>', r'- \1\n', html, flags=re.IGNORECASE)

        # 移除其他标签
        html = re.sub(r'<[^>]+>', '', html)

        # 解码 HTML 实体
        import html
        html = html.unescape(html)

        return html.strip()

    def _clean_markdown(self, markdown: str) -> str:
        """清理 Markdown 格式"""
        # 移除 frontmatter（如果存在）
        markdown = re.sub(r'^---\s*\n.*?---\s*\n', '', markdown, flags=re.DOTALL)
        markdown = re.sub(r'!\[\]\(\s*\)', '', markdown)
        markdown = re.sub(r'!\[[^\]]*\]\([^)]+\.svg(?:\?[^)]*)?\)', '', markdown, flags=re.IGNORECASE)
        markdown = re.sub(r'!\[\[[^\]]+\.svg\]\]', '', markdown, flags=re.IGNORECASE)
        markdown = re.sub(r'(?is)<svg[\s\S]*?</svg>', '', markdown)

        # 移除文档开头的标题（因为我们会在前面加结构化内容）
        lines = markdown.split('\n')
        while lines and lines[0].strip().startswith('# '):
            lines = lines[1:]

        # 移除开头的空行
        while lines and not lines[0].strip():
            lines = lines[1:]

        # 清理连续空行
        result = []
        prev_empty = False
        for line in lines:
            is_empty = not line.strip()
            if is_empty and prev_empty:
                continue
            result.append(line)
            prev_empty = is_empty

        markdown = '\n'.join(result)
        markdown = re.sub(r'\n{3,}', '\n\n', markdown)

        # 统计字数
        self.stats['word_count'] = len(markdown.replace(' ', '').replace('\n', ''))

        return markdown.strip()

    def _generate_note(self, fetch_result: Dict[str, Any], content_md: str) -> str:
        """生成结构化笔记"""
        title = fetch_result['title']
        url = fetch_result['url']
        metadata = fetch_result.get('metadata', {})
        site_type = fetch_result.get('site_type', 'unknown')

        # 生成安全文件名
        safe_title = self._sanitize_filename(title)

        lines = []

        # 标题（使用 ## 而不是 #，因为无头格式要求）
        lines.append(f"## {title}")
        lines.append("")

        # 元信息
        lines.append(f"- 来源：{url}")
        if 'author' in metadata:
            lines.append(f"- 作者：{metadata['author']}")
        if 'date' in metadata:
            lines.append(f"- 时间：{metadata['date']}")
        lines.append(f"- 抓取：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
        lines.append("")

        # 正文内容
        lines.append(content_md)

        return '\n'.join(lines)

    def _sanitize_filename(self, title: str) -> str:
        """生成安全的文件名"""
        # 移除特殊字符
        safe = re.sub(r'[^\w\s-]', '', title)
        # 替换空格为连字符
        safe = safe.replace(' ', '-')
        # 合并多个连字符
        safe = re.sub(r'-+', '-', safe)
        # 截断长度
        safe = safe[:50].strip('-')

        if not safe:
            safe = 'article'

        return safe
