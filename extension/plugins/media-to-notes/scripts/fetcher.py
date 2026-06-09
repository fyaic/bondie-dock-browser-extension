"""
网页抓取核心 - 使用 Playwright
"""

import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse
from typing import Optional, Dict, Any

from config import config
from title_utils import pick_best_title


class WebFetcher:
    """网页抓取器 - 使用 Playwright 渲染 JS 页面"""

    def __init__(self):
        self.browser = None
        self.context = None
        self.page = None
        self.p = None  # playwright 实例

    def __enter__(self):
        """上下文管理器入口"""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            print("[ERROR] Playwright 未安装，请运行: pip install playwright", file=sys.stderr)
            print("[ERROR] 然后安装浏览器: playwright install chromium", file=sys.stderr)
            raise

        # 修复：使用 start() 而不是 __enter__()
        self.p = sync_playwright().start()
        self.browser = self.p.chromium.launch(headless=True)
        self.context = self.browser.new_context(
            user_agent=config.fetch.user_agent,
            viewport={'width': 1920, 'height': 1080}
        )
        self.page = self.context.new_page()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器退出"""
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        # 修复：使用 stop() 而不是 __exit__()
        if self.p:
            self.p.stop()

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
        print(f"[FETCH] 正在打开: {url}")

        # 访问页面
        self.page.goto(url, wait_until='networkidle', timeout=config.fetch.timeout * 1000)

        # 等待 JS 渲染
        if config.fetch.wait_time > 0:
            print(f"[FETCH] 等待 {config.fetch.wait_time}s 让页面完全加载...")
            time.sleep(config.fetch.wait_time)

        # 获取基础信息
        page_title = self.page.title()
        final_url = self.page.url

        print(f"[FETCH] 页面标题: {page_title}")
        print(f"[FETCH] 最终 URL: {final_url}")

        # 获取完整 HTML
        full_html = self.page.content()

        # 检测网站类型并提取正文
        site_type = config.detect_site(final_url)
        content_html = self._extract_content(final_url, site_type)

        # 获取元数据
        metadata = self._extract_metadata(final_url, site_type)
        content_title = self._extract_content_title()
        meta_title = self._extract_meta_title()
        title = pick_best_title(content_title, meta_title, page_title)
        print(f"[FETCH] 最终标题: {title}")

        return {
            'url': final_url,
            'original_url': url,
            'title': title,
            'html': full_html,
            'content_html': content_html,
            'site_type': site_type,
            'metadata': metadata,
        }

    def _extract_content_title(self) -> str:
        """优先提取正文中的一级标题。"""
        return self.page.evaluate('''() => {
            const selectors = ['article h1', 'main h1', 'h1'];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText && el.innerText.trim().length > 0) {
                    return el.innerText.trim();
                }
            }
            return '';
        }''')

    def _extract_meta_title(self) -> str:
        """从 meta 中提取更稳定的标题。"""
        return self.page.evaluate('''() => {
            const selectors = [
                'meta[property="og:title"]',
                'meta[name="twitter:title"]',
                'meta[name="title"]'
            ];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                const value = el ? (el.getAttribute('content') || '').trim() : '';
                if (value) {
                    return value;
                }
            }
            return '';
        }''')

    def _extract_content(self, url: str, site_type: Optional[str]) -> str:
        """提取正文内容"""

        # 尝试网站特定选择器
        if site_type and site_type in config.sites:
            selector = config.sites[site_type]['content']
            print(f"[EXTRACT] 使用 {site_type} 特定选择器: {selector}")

            content_html = self.page.evaluate(f'''() => {{
                const el = document.querySelector('{selector}');
                return el ? el.innerHTML : '';
            }}''')

            if content_html and len(content_html) > config.extraction.min_content_length:
                print(f"[EXTRACT] 提取成功，长度: {len(content_html)}")
                return content_html
            else:
                print(f"[EXTRACT] 特定选择器提取失败，回退到通用方法")

        # 回退到通用方法：尝试常见内容区域
        content_html = self.page.evaluate('''() => {
            // 常见内容区域选择器，按优先级排序
            const selectors = [
                'article',
                '[role="main"]',
                'main',
                '.post-content',
                '.entry-content',
                '.content',
                '#content',
                '.article-body',
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText.length > 200) {
                    return el.innerHTML;
                }
            }

            // 如果都找不到，返回 body
            return document.body.innerHTML;
        }''')

        print(f"[EXTRACT] 通用方法提取，长度: {len(content_html)}")
        return content_html

    def _extract_metadata(self, url: str, site_type: Optional[str]) -> Dict[str, str]:
        """提取元数据（作者、发布时间等）"""
        metadata = {}

        if site_type and site_type in config.sites:
            site_config = config.sites[site_type]

            # 提取作者
            if 'author' in site_config:
                author = self.page.evaluate(f'''() => {{
                    const el = document.querySelector('{site_config['author']}');
                    return el ? el.innerText.trim() : '';
                }}''')
                if author:
                    metadata['author'] = author

            # 提取发布时间
            if 'date' in site_config:
                date = self.page.evaluate(f'''() => {{
                    const el = document.querySelector('{site_config['date']}');
                    return el ? el.innerText.trim() : '';
                }}''')
                if date:
                    metadata['date'] = date

        # 通用：从 meta 标签提取
        meta_author = self.page.evaluate('''() => {
            const meta = document.querySelector('meta[name="author"]');
            return meta ? meta.getAttribute('content') : '';
        }''')
        if meta_author and 'author' not in metadata:
            metadata['author'] = meta_author

        return metadata

    def extract_images(self) -> list:
        """提取页面中的所有图片 URL"""
        images = self.page.evaluate('''() => {
            const imgs = document.querySelectorAll('img');
            return Array.from(imgs).map(img => ({
                src: img.src,
                dataSrc: img.getAttribute('data-src'),
                dataOriginal: img.getAttribute('data-original'),
                alt: img.alt || '',
                width: img.naturalWidth,
                height: img.naturalHeight,
            })).filter(img => {
                // 过滤掉小图标和 data URI
                const hasSrc = img.src || img.dataSrc || img.dataOriginal;
                const isDataUri = img.src && img.src.startsWith('data:');
                const isLarge = img.width > 100 && img.height > 100;
                return hasSrc && !isDataUri && isLarge;
            });
        }''')

        print(f"[IMAGES] 找到 {len(images)} 张候选图片")
        return images
