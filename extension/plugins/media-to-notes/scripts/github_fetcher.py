"""
GitHub repo 产品识别采集。
"""

import base64
import os
from typing import Any
from urllib.parse import urlparse

import requests

from config import config
from models import ContentAsset


API_ACCEPT = "application/vnd.github+json"


def fetch_github_asset(url: str) -> tuple[ContentAsset, dict[str, Any]]:
    """抓取 GitHub repo 并转成统一资产。"""
    parsed = _parse_repo_url(url)
    session = _build_session()
    return _fetch_repo_asset(session, parsed)


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "Accept": API_ACCEPT,
        "User-Agent": config.fetch.user_agent,
    })
    token = config.github.token or os.getenv("GH_TOKEN", "")
    if token:
        session.headers["Authorization"] = f"Bearer {token}"
    return session


def _parse_repo_url(url: str) -> dict[str, str]:
    parsed = urlparse(url)
    if parsed.netloc.lower() not in {"github.com", "www.github.com"}:
        raise ValueError(f"不是 GitHub 链接: {url}")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ValueError(f"无法识别 GitHub 路径: {url}")

    owner, repo = parts[0], parts[1]
    return {
        "owner": owner,
        "repo": repo,
        "url": f"https://github.com/{owner}/{repo}",
    }


def _fetch_repo_asset(session: requests.Session, parsed: dict[str, str]) -> tuple[ContentAsset, dict[str, Any]]:
    repo_api = _api_get(session, f"/repos/{parsed['owner']}/{parsed['repo']}")
    readme_api = _safe_api_get(session, f"/repos/{parsed['owner']}/{parsed['repo']}/readme")
    readme_text = _decode_readme(readme_api) if readme_api else ""

    body_markdown = _render_repo_markdown(repo_api, readme_text)
    asset = ContentAsset(
        source_url=parsed["url"],
        resolved_url=repo_api["html_url"],
        content_type="github",
        source_platform="GitHub",
        title=repo_api["full_name"],
        author=(repo_api.get("owner") or {}).get("login", ""),
        published_at=repo_api.get("updated_at", ""),
        body_markdown=body_markdown,
        metadata={
            "stars": repo_api.get("stargazers_count", 0),
            "language": repo_api.get("language", ""),
            "topics": repo_api.get("topics", []),
            "forks": repo_api.get("forks_count", 0),
            "open_issues": repo_api.get("open_issues_count", 0),
        },
        canonical_id=str(repo_api.get("id", "")),
        source_kind="repo",
        summary_source="readme" if readme_text else "repo_metadata",
        extra_context={
            "repo_metadata": {
                "default_branch": repo_api.get("default_branch", ""),
                "homepage": repo_api.get("homepage", ""),
                "license": (repo_api.get("license") or {}).get("spdx_id", ""),
            }
        },
    )
    return asset, _default_extra("github-api", len(body_markdown), warnings=[])


def _api_get(session: requests.Session, path: str) -> dict[str, Any]:
    response = session.get(f"{config.github.api_base_url}{path}", timeout=config.github.timeout)
    response.raise_for_status()
    return response.json()


def _safe_api_get(session: requests.Session, path: str) -> dict[str, Any] | None:
    try:
        return _api_get(session, path)
    except Exception:
        return None


def _decode_readme(readme_api: dict[str, Any]) -> str:
    encoded = readme_api.get("content", "")
    if not encoded:
        return ""
    return base64.b64decode(encoded).decode("utf-8", errors="replace")


def _render_repo_markdown(repo_api: dict[str, Any], readme_text: str) -> str:
    description = repo_api.get("description", "暂无仓库描述。")
    summary = (
        f"{repo_api['full_name']} 是一个 GitHub 仓库，主要语言为 "
        f"{repo_api.get('language') or '未知'}，当前有 "
        f"{repo_api.get('stargazers_count', 0)} 个 stars 和 "
        f"{repo_api.get('forks_count', 0)} 个 forks。"
    )
    lines = [
        f"# {repo_api['full_name']}",
        "",
        "## 仓库摘要",
        "",
        summary,
        "",
        f"仓库描述：{description}",
        "",
        "## 仓库概览",
        "",
        f"- Stars: {repo_api.get('stargazers_count', 0)}",
        f"- Forks: {repo_api.get('forks_count', 0)}",
        f"- 主语言: {repo_api.get('language') or '未知'}",
        f"- Topics: {', '.join(repo_api.get('topics', [])) or '无'}",
        f"- Homepage: {repo_api.get('homepage') or '无'}",
        "",
    ]
    if readme_text.strip():
        lines.extend(["## README", "", readme_text.strip()])
    return "\n".join(lines).strip() + "\n"


def _default_extra(fetcher_type: str, word_count: int, warnings: list[str]) -> dict[str, Any]:
    return {
        "fetcher_type": fetcher_type,
        "word_count": word_count,
        "images_count": 0,
        "warnings": warnings,
        "image_status": "not_supported",
    }
