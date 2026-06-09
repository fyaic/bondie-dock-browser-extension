#!/usr/bin/env python3
"""
fetch-webpage.py - 独立 CLI 网页抓取工具
使用 requests + readability-lxml + markdownify 轻量实现，无需 Playwright。

Usage:
    python3 fetch-webpage.py --url URL [--output-dir DIR] [--download-images]

stdout: JSON {"title", "content_markdown", "author", "platform", "content_type", "url"}
stderr: 进度/错误信息
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse


# ---------------------------------------------------------------------------
# HTML 清洗 & 标题提取（内联实现，不依赖项目内其他模块）
# ---------------------------------------------------------------------------

BAD_TITLES = {"", "未命名", "article", "Article", "文章", "网页", "document", "Document"}


def clean_title(title: str) -> str:
    value = re.sub(r"<[^>]+>", "", title or "")
    value = re.sub(r"\s+", " ", value).strip().strip("-_| ")
    return value


def is_bad_title(title: str) -> bool:
    value = clean_title(title)
    return value in BAD_TITLES or len(value) < 3


def pick_best_title(*candidates: Optional[str]) -> str:
    for candidate in candidates:
        value = clean_title(candidate or "")
        if not is_bad_title(value):
            return value
    return "未命名内容"


# ---------------------------------------------------------------------------
# 平台检测
# ---------------------------------------------------------------------------

SITE_DOMAINS = {
    "mp.weixin.qq.com": "wechat",
    "zhuanlan.zhihu.com": "zhihu",
    "www.zhihu.com": "zhihu",
    "zhihu.com": "zhihu",
    "www.zhihu.com/question": "zhihu_answer",
    "juejin.cn": "juejin",
    "www.juejin.cn": "juejin",
    "www.bilibili.com": "bilibili",
    "bilibili.com": "bilibili",
}


def detect_platform(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    for domain, platform in SITE_DOMAINS.items():
        if host == domain or host.endswith("." + domain.split(".")[0] + "." + domain.split(".")[1] if "." in domain else domain):
            return platform
    host_parts = host.split(".")
    if len(host_parts) >= 2:
        return host_parts[-2]
    return "unknown"


# ---------------------------------------------------------------------------
# 网页抓取核心
# ---------------------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def _create_session() -> "requests.Session":
    import requests

    session = requests.Session()
    session.trust_env = False
    session.headers.update(HEADERS)
    return session


def _extract_meta_title(html: str) -> str:
    patterns = [
        r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']',
        r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:title["\']',
        r'<meta[^>]*name=["\']twitter:title["\'][^>]*content=["\']([^"\']+)["\']',
        r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']twitter:title["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return _strip_html(match.group(1))
    return ""


def _extract_content_title(html: str) -> str:
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.DOTALL | re.IGNORECASE)
    if match:
        return _strip_html(match.group(1))
    return ""


def _extract_page_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
    if match:
        return _clean_html_entities(match.group(1).strip())
    return ""


def _extract_author(html: str) -> str:
    patterns = [
        r'<meta[^>]*name=["\']author["\'][^>]*content=["\']([^"\']+)["\']',
        r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']author["\']',
        r'<span[^>]*class=["\'][^"\']*author[^"\']*["\'][^>]*>(.*?)</span>',
        r'<a[^>]*class=["\'][^"\']*author[^"\']*["\'][^>]*>(.*?)</a>',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            author = _strip_html(match.group(1))
            if author and len(author) < 100:
                return author
    return ""


# ---------------------------------------------------------------------------
# 内容提取（平台特定 + 通用回退）
# ---------------------------------------------------------------------------

def _extract_site_content(html: str, url: str, platform: str) -> str:
    """根据平台尝试特定提取规则，失败回退到 readability。"""
    extractor = {
        "wechat": _extract_wechat,
        "zhihu": _extract_zhihu,
        "juejin": _extract_juejin,
        "bilibili": _extract_bilibili,
    }.get(platform)

    content = ""
    if extractor:
        content = extractor(html)

    if not content or len(_strip_html(content)) < 200:
        # 回退到 readability
        content = _extract_with_readability(html)

    return content


def _extract_wechat(html: str) -> str:
    patterns = [
        r'<div[^>]*id=["\']js_content["\'][^>]*>(.*?)</div>\s*(?=<script|</body>|<!--)',
        r'<div[^>]*id=["\']js_content["\'][^>]*>(.*?)</div>\s*</div>\s*</div>',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1)
    return ""


def _extract_zhihu(html: str) -> str:
    patterns = [
        r'<div[^>]*class=["\'][^"\']*RichContent-inner[^"\']*["\'][^>]*>(.*?)</div>\s*</div>\s*</div>\s*</div>',
        r'<div[^>]*class=["\']RichContent-inner["\'][^>]*>(.*?)</div>',
        r'<article[^>]*>(.*?)</article>',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1)
    return ""


def _extract_juejin(html: str) -> str:
    match = re.search(
        r'<article[^>]*class=["\']article-content["\'][^>]*>(.*?)</article>',
        html, re.DOTALL | re.IGNORECASE,
    )
    return match.group(1) if match else ""


def _extract_bilibili(html: str) -> str:
    patterns = [
        r'<div[^>]*class=["\']article-content["\'][^>]*>(.*?)</div>\s*</div>\s*</div>',
        r'<div[^>]*id=["\']article-content["\'][^>]*>(.*?)</div>',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1)
    return ""


def _extract_with_readability(html: str) -> str:
    """使用 readability-lxml 提取正文 HTML。"""
    try:
        from readability import Document

        doc = Document(html)
        return doc.summary()
    except ImportError:
        print("[WARN] readability-lxml 未安装，使用通用正则回退", file=sys.stderr)
        return _extract_generic(html)


def _extract_generic(html: str) -> str:
    """通用正则内容提取。"""
    patterns = [
        r"<article[^>]*>(.*?)</article>",
        r"<main[^>]*>(.*?)</main>",
        r'<div[^>]*class=["\'][^"\']*(?:post-content|entry-content|article-content|content-main)[^"\']*["\'][^>]*>(.*?)</div>',
        r'<div[^>]*id=["\']content["\'][^>]*>(.*?)</div>',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            content = match.group(1)
            if len(_strip_html(content)) > 200:
                return content
    body_match = re.search(r"<body[^>]*>(.*?)</body>", html, re.DOTALL | re.IGNORECASE)
    if body_match:
        return body_match.group(1)
    return html


# ---------------------------------------------------------------------------
# HTML -> Markdown
# ---------------------------------------------------------------------------

def html_to_markdown(html: str) -> str:
    """将 HTML 转为 Markdown。优先使用 markdownify，否则正则回退。"""
    try:
        from markdownify import markdownify as md

        return md(
            html,
            heading_style="ATX",
            bullets="-",
            strip=["script", "style", "nav", "footer", "header", "aside"],
        )
    except ImportError:
        print("[WARN] markdownify 未安装，使用正则回退", file=sys.stderr)
        return _basic_html_to_markdown(html)


def _basic_html_to_markdown(html: str) -> str:
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<h1[^>]*>(.*?)</h1>", r"# \1", html, flags=re.IGNORECASE)
    html = re.sub(r"<h2[^>]*>(.*?)</h2>", r"## \1", html, flags=re.IGNORECASE)
    html = re.sub(r"<h3[^>]*>(.*?)</h3>", r"### \1", html, flags=re.IGNORECASE)
    html = re.sub(r"<h4[^>]*>(.*?)</h4>", r"#### \1", html, flags=re.IGNORECASE)
    html = re.sub(r"<strong[^>]*>(.*?)</strong>", r"**\1**", html, flags=re.IGNORECASE)
    html = re.sub(r"<b[^>]*>(.*?)</b>", r"**\1**", html, flags=re.IGNORECASE)
    html = re.sub(r"<em[^>]*>(.*?)</em>", r"*\1*", html, flags=re.IGNORECASE)
    html = re.sub(r"<i[^>]*>(.*?)</i>", r"*\1*", html, flags=re.IGNORECASE)
    html = re.sub(
        r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', r"[\2](\1)", html, flags=re.IGNORECASE
    )
    html = re.sub(
        r'<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*/>', r"![\2](\1)", html, flags=re.IGNORECASE
    )
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    html = re.sub(r"<p[^>]*>(.*?)</p>", r"\1\n\n", html, flags=re.IGNORECASE)
    html = re.sub(r"<li[^>]*>(.*?)</li>", r"- \1\n", html, flags=re.IGNORECASE)
    html = re.sub(r"<[^>]+>", "", html)
    import html as html_mod

    html = html_mod.unescape(html)
    return html.strip()


# ---------------------------------------------------------------------------
# 图片下载
# ---------------------------------------------------------------------------

def _extract_image_urls(html: str, base_url: str) -> list[str]:
    """从 HTML 中提取图片 URL。"""
    urls = []
    seen = set()
    for match in re.finditer(r"<img[^>]*>", html, re.IGNORECASE):
        tag = match.group(0)
        for attr in ("data-src", "data-original", "src"):
            attr_match = re.search(rf'{attr}=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if attr_match:
                url = attr_match.group(1)
                break
        else:
            continue
        if url.startswith("data:"):
            continue
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            url = urljoin(base_url, url)
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def download_images(
    html: str, base_url: str, output_dir: Path
) -> dict[str, str]:
    """下载图片到 output_dir/images/，返回 {原始URL: 本地相对路径}。"""
    import requests as req

    image_urls = _extract_image_urls(html, base_url)
    if not image_urls:
        print("[IMAGES] 未找到图片", file=sys.stderr)
        return {}

    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    url_map: dict[str, str] = {}
    session = req.Session()
    session.trust_env = False
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}/",
    })

    for idx, img_url in enumerate(image_urls):
        try:
            resp = session.get(img_url, timeout=30)
            resp.raise_for_status()
            content = resp.content

            # 大小限制 10MB
            if len(content) > 10 * 1024 * 1024:
                print(f"[IMAGES] 跳过过大图片: {len(content)/1024/1024:.1f}MB", file=sys.stderr)
                continue

            ext = _guess_extension(img_url, resp.headers.get("content-type", ""))
            url_hash = hashlib.md5(img_url.encode()).hexdigest()[:8]
            filename = f"img-{idx + 1:03d}-{url_hash}{ext}"
            filepath = images_dir / filename
            filepath.write_bytes(content)

            rel_path = f"images/{filename}"
            url_map[img_url] = rel_path
            print(f"[IMAGES] 下载: {filename} ({len(content)/1024:.1f}KB)", file=sys.stderr)
        except Exception as e:
            print(f"[IMAGES] 下载失败: {e}", file=sys.stderr)

    print(f"[IMAGES] 成功下载 {len(url_map)} 张图片", file=sys.stderr)
    return url_map


def _guess_extension(url: str, content_type: str) -> str:
    url_lower = url.lower()
    for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"):
        if ext in url_lower:
            return ext
    ct = content_type.lower()
    if "jpeg" in ct or "jpg" in ct:
        return ".jpg"
    if "png" in ct:
        return ".png"
    if "gif" in ct:
        return ".gif"
    if "webp" in ct:
        return ".webp"
    return ".png"


# ---------------------------------------------------------------------------
# 图片视觉分析（Gemini via 118api）
# ---------------------------------------------------------------------------

VISION_API_URL = "https://118api.cn/v1/chat/completions"
VISION_MODEL = "gemini-3-flash-preview"

VISION_PROMPT = """简要描述这张图片，要求：
- 如有文字，提取关键信息（跳过重复或装饰性文字）
- 如有数据/图表，列出核心数值
- 如是截图，概括界面内容和关键操作
- 整体用 2-3 句话概括图片传递的核心信息

用中文回答，控制在 150 字以内，只输出描述，不要输出标题或编号。"""


def analyze_image(image_path: Path, api_key: str) -> str:
    """调用 Gemini 视觉 API 分析单张图片，返回中文描述。"""
    import requests as req

    with open(image_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    ext = image_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}
    mime_type = mime_map.get(ext, "image/jpeg")

    payload = {
        "model": VISION_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": VISION_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}},
            ],
        }],
        "temperature": 0.3,
    }

    resp = req.post(
        VISION_API_URL,
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    if "choices" in data and data["choices"]:
        return data["choices"][0]["message"]["content"]
    raise ValueError(f"API 返回异常: {data.get('error', data)}")


def analyze_downloaded_images(output_dir: Path) -> dict[str, str]:
    """
    对 output_dir/images/ 下的所有图片执行视觉分析。
    返回 {相对路径: 描述文本}。
    """
    api_key = os.environ.get("MEDIA_API_KEY", "")
    if not api_key:
        print("[VISION] 未设置 MEDIA_API_KEY，跳过图片视觉分析", file=sys.stderr)
        return {}

    images_dir = output_dir / "images"
    if not images_dir.is_dir():
        return {}

    descriptions: dict[str, str] = {}
    image_files = sorted(images_dir.iterdir())
    image_files = [f for f in image_files if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".gif", ".webp")]

    if not image_files:
        return {}

    print(f"[VISION] 开始分析 {len(image_files)} 张图片...", file=sys.stderr)

    for img_file in image_files:
        rel_path = f"images/{img_file.name}"
        try:
            desc = analyze_image(img_file, api_key)
            descriptions[rel_path] = desc
            print(f"[VISION] ✅ {img_file.name}: {len(desc)} 字", file=sys.stderr)
        except Exception as e:
            print(f"[VISION] ⚠️ {img_file.name} 分析失败: {e}", file=sys.stderr)

    print(f"[VISION] 完成 {len(descriptions)}/{len(image_files)} 张", file=sys.stderr)
    return descriptions


def inject_image_descriptions(markdown: str, descriptions: dict[str, str]) -> str:
    """在 Markdown 图片引用下方注入精简的视觉描述。"""
    if not descriptions:
        return markdown

    for rel_path, desc in descriptions.items():
        # 单行紧凑描述
        pattern = rf"(!\[[^\]]*\]\({re.escape(rel_path)}\))"
        replacement = rf"\1  \n> 📷 {desc}"
        markdown = re.sub(pattern, replacement, markdown)

    return markdown


# ---------------------------------------------------------------------------
# Markdown 清洗
# ---------------------------------------------------------------------------

def clean_markdown(text: str) -> str:
    text = re.sub(r"^---\s*\n.*?---\s*\n", "", text, flags=re.DOTALL)
    text = re.sub(r"!\[\]\(\s*\)", "", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\.svg(?:\?[^)]*)?\)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?is)<svg[\s\S]*?</svg>", "", text)

    lines = text.split("\n")
    # 移除开头的 h1
    while lines and lines[0].strip().startswith("# "):
        lines = lines[1:]
    while lines and not lines[0].strip():
        lines = lines[1:]

    # 压缩连续空行
    result = []
    prev_empty = False
    for line in lines:
        is_empty = not line.strip()
        if is_empty and prev_empty:
            continue
        result.append(line)
        prev_empty = is_empty

    text = "\n".join(result)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def replace_image_urls(markdown: str, url_map: dict[str, str]) -> str:
    """将 Markdown 中的原始图片 URL 替换为本地路径。"""
    for original_url, local_path in url_map.items():
        # 转义 URL 中可能存在的正则特殊字符
        escaped = re.escape(original_url)
        markdown = re.sub(
            rf"!\[([^\]]*)\]\(\s*{escaped}\s*\)",
            rf"![\1]({local_path})",
            markdown,
        )
    return markdown


def fill_empty_image_refs(markdown: str, url_map: dict[str, str]) -> str:
    """
    将 Markdown 中的空图片引用 ![]() 按出现顺序替换为已下载的本地路径。
    处理微信等使用 data-src 懒加载的平台：markdownify 无法识别 data-src，
    产生空 ![]()，而图片已通过 _extract_image_urls() 下载到本地。
    """
    if not url_map:
        return markdown

    local_paths = list(url_map.values())
    path_idx = 0

    def replacer(match):
        nonlocal path_idx
        if path_idx < len(local_paths):
            path = local_paths[path_idx]
            path_idx += 1
            return f"![图片]({path})"
        return match.group(0)

    # 匹配空图片引用: ![]() 或 ![any]()
    return re.sub(r"!\[[^\]]*\]\(\s*\)", replacer, markdown)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    return _clean_html_entities(text).strip()


def _clean_html_entities(text: str) -> str:
    entities = {
        "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">",
        "&nbsp;": " ", "&#39;": "'", "&ldquo;": "\u201c", "&rdquo;": "\u201d",
        "&hellip;": "...", "&mdash;": "\u2014", "&ndash;": "\u2013",
    }
    for entity, char in entities.items():
        text = text.replace(entity, char)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    return text.strip()


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def fetch_webpage(url: str, output_dir: Optional[Path] = None, download_images_flag: bool = True, analyze_images_flag: bool = False) -> dict:
    """
    抓取网页并返回结构化结果。

    Returns:
        dict with keys: title, content_markdown, author, platform, content_type, url
    """
    import requests as req

    session = _create_session()
    print(f"[FETCH] 正在抓取: {url}", file=sys.stderr)

    response = session.get(url, timeout=30)
    response.raise_for_status()

    # 编码检测
    if response.encoding == "ISO-8859-1":
        response.encoding = response.apparent_encoding

    html = response.text
    final_url = response.url
    print(f"[FETCH] 状态码: {response.status_code}", file=sys.stderr)
    print(f"[FETCH] 内容长度: {len(html)} 字符", file=sys.stderr)

    platform = detect_platform(final_url)
    print(f"[FETCH] 平台: {platform}", file=sys.stderr)

    # 提取标题
    title = pick_best_title(
        _extract_content_title(html),
        _extract_meta_title(html),
        _extract_page_title(html),
    )
    print(f"[FETCH] 标题: {title}", file=sys.stderr)

    # 提取正文 HTML
    content_html = _extract_site_content(html, final_url, platform)
    print(f"[FETCH] 正文长度: {len(content_html)} 字符", file=sys.stderr)

    # 提取作者
    author = _extract_author(html)

    # HTML -> Markdown
    content_md = html_to_markdown(content_html)

    # 下载图片（可选）
    url_map: dict[str, str] = {}
    if download_images_flag and output_dir:
        try:
            url_map = download_images(content_html, final_url, output_dir)
        except Exception as e:
            print(f"[IMAGES] 图片下载失败，已跳过: {e}", file=sys.stderr)

    # 替换图片 URL
    if url_map:
        # 先填充 markdownify 产生的空 ![]()（如微信 data-src 懒加载图片）
        content_md = fill_empty_image_refs(content_md, url_map)
        # 再替换有完整 URL 的图片引用
        content_md = replace_image_urls(content_md, url_map)

    # 图片视觉分析（可选）
    if analyze_images_flag and output_dir and url_map:
        try:
            descriptions = analyze_downloaded_images(output_dir)
            if descriptions:
                content_md = inject_image_descriptions(content_md, descriptions)
        except Exception as e:
            print(f"[VISION] 图片视觉分析失败，已跳过: {e}", file=sys.stderr)

    # 清洗 Markdown
    content_md = clean_markdown(content_md)

    return {
        "title": title,
        "content_markdown": content_md,
        "author": author,
        "platform": platform,
        "content_type": "article",
        "url": final_url,
    }


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

def main():
    import requests  # noqa: F401 - 提前检测依赖

    parser = argparse.ArgumentParser(description="fetch-webpage - 抓取网页内容转为 Markdown")
    parser.add_argument("--url", required=True, help="要抓取的网页 URL")
    parser.add_argument("--output-dir", default="", help="输出目录（下载图片时需要）")
    parser.add_argument("--download-images", action="store_true", default=True, help="下载图片（默认开启）")
    parser.add_argument("--analyze-images", action="store_true", default=False, help="用 Gemini 视觉分析图片内容（需要 MEDIA_API_KEY）")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else None
    if args.download_images and not output_dir:
        args.download_images = False

    try:
        result = fetch_webpage(
            url=args.url,
            output_dir=output_dir,
            download_images_flag=args.download_images,
            analyze_images_flag=args.analyze_images,
        )
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    except Exception as e:
        print(f"HANDOFF: WEB_ARTICLE", file=sys.stderr)
        print(f"URL: {args.url}", file=sys.stderr)
        print(f"REASON: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
