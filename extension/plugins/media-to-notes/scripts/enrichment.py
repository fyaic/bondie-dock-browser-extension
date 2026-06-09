"""
延展补充与溯源
"""

import json
import re
from html import unescape
from typing import Iterable
from urllib.parse import quote, urlparse

import requests

from models import AnalysisResult, ContentAsset, EnrichmentResult, RelatedResource


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


def enrich_asset(asset: ContentAsset, analysis: AnalysisResult) -> EnrichmentResult:
    """为内容补充相关资源与溯源。"""
    entities = _extract_entities(asset, analysis)
    resources: list[RelatedResource] = []

    resources.extend(_extract_resources_from_text(asset))

    if _looks_like_paper(asset):
        resources.extend(_collect_paper_resources(asset))
    elif _need_external_search(resources):
        for entity in entities[:1]:
            resources.extend(_search_product_resources(entity))

    deduped = _dedupe_resources(resources)
    summary = _build_summary(asset, entities, deduped)
    return EnrichmentResult(summary=summary, entities=entities, resources=deduped[:8])


def _extract_entities(asset: ContentAsset, analysis: AnalysisResult) -> list[str]:
    text = " ".join(
        [
            asset.title,
            analysis.tldr,
            " ".join(analysis.key_points),
            asset.body_markdown[:3000],
            asset.transcript[:3000],
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

    if _is_good_entity(asset.title):
        candidates.insert(0, asset.title.strip())

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


def _extract_resources_from_text(asset: ContentAsset) -> list[RelatedResource]:
    text = "\n".join([asset.body_markdown, asset.raw_html, asset.transcript])[:20000]
    urls = re.findall(r"https?://[^\s)>\"]+", text)
    resources: list[RelatedResource] = []
    skipped_urls = {
        asset.source_url.rstrip("/").lower(),
        asset.resolved_url.rstrip("/").lower(),
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
            RelatedResource(
                title=_title_from_url(url),
                url=url,
                category=category,
                source="source-content",
            )
        )
    return resources


def _looks_like_paper(asset: ContentAsset) -> bool:
    text = " ".join([asset.title, asset.body_markdown[:2000], asset.raw_html[:2000]])
    lowered = text.lower()
    return "arxiv" in lowered or "doi.org" in lowered or "论文" in text or "paper" in lowered


def _collect_paper_resources(asset: ContentAsset) -> list[RelatedResource]:
    text = "\n".join([asset.body_markdown, asset.raw_html, asset.transcript, asset.resolved_url])
    resources: list[RelatedResource] = []
    arxiv_ids = set(re.findall(r"(?:arxiv\.org/(?:abs|pdf)/|arXiv:)(\d{4}\.\d{4,5})(?:v\d+)?", text, flags=re.IGNORECASE))
    for arxiv_id in arxiv_ids:
        resources.append(
            RelatedResource(
                title=f"arXiv {arxiv_id}",
                url=f"https://arxiv.org/abs/{arxiv_id}",
                category="paper",
                source="detected-arxiv",
            )
        )
    return resources


def _search_product_resources(entity: str) -> list[RelatedResource]:
    resources: list[RelatedResource] = []

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


def _search_duckduckgo(query: str, entity: str, category: str) -> RelatedResource | None:
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
        return RelatedResource(
            title=title,
            url=clean_url,
            category=category,
            source="duckduckgo",
        )
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


def _dedupe_resources(resources: Iterable[RelatedResource]) -> list[RelatedResource]:
    seen = set()
    result: list[RelatedResource] = []
    for item in resources:
        key = item.url.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _build_summary(asset: ContentAsset, entities: list[str], resources: list[RelatedResource]) -> str:
    if resources:
        categories = sorted({item.category for item in resources})
        return f"已补充 {len(resources)} 条延展资源，覆盖：{' / '.join(categories)}。"
    if entities:
        return f"已执行延展检索，当前围绕 {entities[0]} 暂未拿到高置信外部资源。"
    return f"已执行延展检索，当前未识别到明确的产品、论文或可追踪实体。"


def _need_external_search(resources: list[RelatedResource]) -> bool:
    categories = {item.category for item in resources}
    if "official" not in categories:
        return True
    if "github" not in categories and "docs" not in categories:
        return True
    return len(resources) < 2
