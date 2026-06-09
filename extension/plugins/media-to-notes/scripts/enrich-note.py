#!/usr/bin/env python3
"""
独立 CLI 工具：从 stdin 读取分析结果 JSON，结合原始 Markdown 文本进行延展补充，
输出 EnrichmentResult JSON 到 stdout。

用法：
    cat analysis.json | python3 enrich-note.py --source-file /path/to/original.md \
        --title "标题" [--source-url URL]

stdin:  分析结果 JSON（来自 analyze-note.py 或 rewrite-note.py 的输出）
        需包含 tldr, key_points 字段
stdout: JSON {summary, entities, resources:[{title, url, category, source}]}
stderr: 错误信息
"""

import re
from html import unescape
from typing import Iterable
from urllib.parse import quote, urlparse

import requests


# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

SEARCH_TIMEOUT = 4
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)
BLOCKED_HOST_MARKERS = {
    "w3.org",
    "www.w3.org",
}
BLOCKED_URL_PATTERNS = [
    "w3.org/2000/svg",
    "w3.org/1999/xlink",
    "xmlns",
    "xlink",
    ".svg",
    "data:image/svg",
]


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def enrich(title: str, source_url: str, body_text: str, analysis: dict) -> dict:
    """
    为内容补充相关资源与溯源。

    参数:
        title: 内容标题
        source_url: 来源 URL（用于排除源 URL）
        body_text: 原始 Markdown 正文
        analysis: 分析结果 JSON，需包含 tldr, key_points
    """
    tldr = analysis.get("tldr", "")
    key_points = analysis.get("key_points", [])

    entities = _extract_entities(title, tldr, key_points, body_text)
    resources: list[dict] = []

    resources.extend(_extract_resources_from_text(body_text, source_url, source_url))

    if _looks_like_paper(title, body_text):
        resources.extend(_collect_paper_resources(body_text, source_url))
    elif _need_external_search(resources):
        for entity in entities[:1]:
            resources.extend(_search_product_resources(entity))

    deduped = _dedupe_resources(resources)
    summary = _build_summary(entities, deduped)

    return {
        "summary": summary,
        "entities": entities,
        "resources": deduped[:8],
    }


# ---------------------------------------------------------------------------
# 实体提取
# ---------------------------------------------------------------------------

def _extract_entities(title: str, tldr: str, key_points: list, body_text: str) -> list[str]:
    text = " ".join(
        [
            title,
            tldr,
            " ".join(key_points),
            body_text[:3000],
        ]
    )

    patterns = [
        r'《([^》]{2,80})》',
        r'"([^"]{2,80})"',
        r"'([^']{2,80})'",
        r"\b([A-Z][A-Za-z0-9]+(?:[ \-][A-Z][A-Za-z0-9]+){0,3})\b",
    ]

    candidates: list[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, text):
            value = match.strip()
            if _is_good_entity(value):
                candidates.append(value)

    if _is_good_entity(title):
        candidates.insert(0, title.strip())

    normalized: list[str] = []
    seen = set()
    for item in candidates:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(item)
        if len(normalized) == 5:
            break
    return normalized


def _is_good_entity(value: str) -> bool:
    value = value.strip()
    if len(value) < 2:
        return False
    bad = {"TLDR", "GitHub", "YouTube", "Bilibili", "X", "Medium", "Substack", "article"}
    if value in bad:
        return False
    if value.startswith("http"):
        return False
    return True


# ---------------------------------------------------------------------------
# 资源提取（从正文中提取 URL）
# ---------------------------------------------------------------------------

def _extract_resources_from_text(body_text: str, source_url: str, resolved_url: str) -> list[dict]:
    text = body_text[:20000]
    urls = re.findall(r"https?://[^\s)>\"]+", text)
    resources: list[dict] = []
    skipped_urls = {
        source_url.rstrip("/").lower(),
        resolved_url.rstrip("/").lower(),
    }
    for url in urls:
        normalized_url = url.rstrip("/").lower()
        if normalized_url in skipped_urls:
            continue
        if _is_blocked_resource_url(url):
            continue
        category = _categorize_url(url)
        if not category:
            continue
        resources.append(
            {
                "title": _title_from_url(url),
                "url": url,
                "category": category,
                "source": "source-content",
            }
        )
    return resources


# ---------------------------------------------------------------------------
# 论文识别与论文资源收集
# ---------------------------------------------------------------------------

def _looks_like_paper(title: str, body_text: str) -> bool:
    text = " ".join([title, body_text[:2000]])
    lowered = text.lower()
    return "arxiv" in lowered or "doi.org" in lowered or "论文" in text or "paper" in lowered


def _collect_paper_resources(body_text: str, source_url: str) -> list[dict]:
    text = "\n".join([body_text, source_url])
    resources: list[dict] = []
    arxiv_ids = set(re.findall(r"(?:arxiv\.org/(?:abs|pdf)/|arXiv:)(\d{4}\.\d{4,5})(?:v\d+)?", text, flags=re.IGNORECASE))
    for arxiv_id in arxiv_ids:
        resources.append(
            {
                "title": f"arXiv {arxiv_id}",
                "url": f"https://arxiv.org/abs/{arxiv_id}",
                "category": "paper",
                "source": "detected-arxiv",
            }
        )
    return resources


# ---------------------------------------------------------------------------
# DuckDuckGo 外部搜索
# ---------------------------------------------------------------------------

def _search_product_resources(entity: str) -> list[dict]:
    resources: list[dict] = []

    search_specs = [
        ("official", f"{entity} official site"),
        ("github", f"{entity} github"),
        ("docs", f"{entity} documentation"),
    ]

    for category, query in search_specs:
        result = _search_duckduckgo(query, entity=entity, category=category)
        if result:
            resources.append(result)

    return resources


def _search_duckduckgo(query: str, entity: str, category: str) -> dict | None:
    url = f"https://duckduckgo.com/html/?q={quote(query)}"
    try:
        response = requests.get(
            url,
            timeout=SEARCH_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
        )
        response.raise_for_status()
    except Exception:
        return None

    html = response.text
    matches = re.findall(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for href, title_html in matches:
        clean_url = unescape(href)
        parsed = urlparse(clean_url)
        if not parsed.scheme.startswith("http"):
            continue
        if not _is_url_match(clean_url, category):
            continue
        title = _clean_html_title(title_html) or f"{entity} {category}"
        return {
            "title": title,
            "url": clean_url,
            "category": category,
            "source": "duckduckgo",
        }
    return None


def _is_url_match(url: str, category: str) -> bool:
    host = urlparse(url).netloc.lower()
    if _is_blocked_resource_url(url):
        return False
    if category == "github":
        return "github.com" in host
    if category == "docs":
        return "docs." in host or "/docs" in url.lower() or "documentation" in url.lower()
    if category == "blog":
        return "blog." in host or "/blog" in url.lower()
    if category == "news":
        return any(marker in host for marker in ["news", "techcrunch", "theverge", "venturebeat", "36kr", "huxiu"])
    if category == "official":
        return "github.com" not in host and "twitter.com" not in host and "x.com" not in host
    return True


def _clean_html_title(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return unescape(value).strip()


# ---------------------------------------------------------------------------
# URL 分类与过滤
# ---------------------------------------------------------------------------

def _categorize_url(url: str) -> str | None:
    lowered = url.lower()
    host = urlparse(url).netloc.lower()
    if _is_blocked_resource_url(url):
        return None
    if any(marker in host for marker in ["mp.weixin.qq.com", "x.com", "twitter.com", "youtube.com", "youtu.be", "bilibili.com", "b23.tv", "tiktok.com", "douyin.com", "instagram.com"]):
        return None
    if "arxiv.org" in host:
        return "paper"
    if "github.com" in host:
        return "github"
    if "docs." in host or "/docs" in lowered or "documentation" in lowered:
        return "docs"
    if "blog." in host or "/blog" in lowered:
        return "blog"
    if any(marker in host for marker in ["techcrunch", "theverge", "venturebeat", "36kr", "huxiu", "news"]):
        return "news"
    if host:
        return "official"
    return None


def _title_from_url(url: str) -> str:
    host = urlparse(url).netloc.replace("www.", "")
    return host or url


def _is_blocked_resource_url(url: str) -> bool:
    lowered = url.lower()
    host = urlparse(lowered).netloc
    if host in BLOCKED_HOST_MARKERS:
        return True
    if any(pattern in lowered for pattern in BLOCKED_URL_PATTERNS):
        return True
    return False


# ---------------------------------------------------------------------------
# 去重
# ---------------------------------------------------------------------------

def _dedupe_resources(resources: Iterable[dict]) -> list[dict]:
    seen = set()
    result: list[dict] = []
    for item in resources:
        key = item["url"].rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


# ---------------------------------------------------------------------------
# Summary 构建
# ---------------------------------------------------------------------------

def _build_summary(entities: list[str], resources: list[dict]) -> str:
    if resources:
        categories = sorted({item["category"] for item in resources})
        return f"已补充 {len(resources)} 条延展资源，覆盖：{' / '.join(categories)}。"
    if entities:
        return f"已执行延展检索，当前围绕 {entities[0]} 暂未拿到高置信外部资源。"
    return f"已执行延展检索，当前未识别到明确的产品、论文或可追踪实体。"


# ---------------------------------------------------------------------------
# 外部搜索判断
# ---------------------------------------------------------------------------

def _need_external_search(resources: list[dict]) -> bool:
    categories = {item["category"] for item in resources}
    if "official" not in categories:
        return True
    if "github" not in categories and "docs" not in categories:
        return True
    return len(resources) < 2


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import json
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="从 stdin 读取分析结果 JSON，结合原始 Markdown 进行延展补充。",
    )
    parser.add_argument(
        "--source-file",
        required=True,
        help="原始 Markdown 文件路径",
    )
    parser.add_argument(
        "--title",
        required=True,
        help="内容标题",
    )
    parser.add_argument(
        "--source-url",
        default="",
        help="来源 URL（可选，用于排除源 URL）",
    )
    args = parser.parse_args()

    try:
        analysis = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"错误: stdin 不是有效的 JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        source_text = Path(args.source_file).read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"错误: 文件不存在: {args.source_file}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"错误: 无法读取文件 {args.source_file}: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        result = enrich(args.title, args.source_url, source_text, analysis)
    except Exception as exc:
        print(f"延展补充失败: {exc}", file=sys.stderr)
        sys.exit(1)

    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()
