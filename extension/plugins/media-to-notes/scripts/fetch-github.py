#!/usr/bin/env python3
"""
fetch-github.py - 独立 CLI 工具，通过 GitHub API 获取 repo 信息。

Usage:
    python3 fetch-github.py --url https://github.com/owner/repo

stdout: JSON {"title", "content_markdown", "description", "stars", "language",
              "topics", "content_type", "url", ...}
stderr: 进度/错误信息
"""

import argparse
import base64
import json
import os
import re
import sys
from typing import Any, Optional
from urllib.parse import urlparse


# ---------------------------------------------------------------------------
# GitHub API 客户端（纯 requests，无项目内依赖）
# ---------------------------------------------------------------------------

GITHUB_API_BASE = "https://api.github.com"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _create_session() -> "requests.Session":
    import requests

    session = requests.Session()
    session.trust_env = False
    session.headers.update({
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    })
    # 支持 token 认证（可选）
    token = os.getenv("GH_TOKEN", "")
    if token:
        session.headers["Authorization"] = f"Bearer {token}"
    return session


def _parse_repo_url(url: str) -> dict[str, str]:
    """从 GitHub URL 提取 owner 和 repo。"""
    parsed = urlparse(url)
    netloc = parsed.netloc.lower()
    if netloc not in {"github.com", "www.github.com"}:
        raise ValueError(f"不是 GitHub 链接: {url}")

    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        raise ValueError(f"无法识别 GitHub 路径: {url}")

    owner, repo = parts[0], parts[1]
    # 去掉可能的 .git 后缀
    if repo.endswith(".git"):
        repo = repo[:-4]

    return {
        "owner": owner,
        "repo": repo,
        "url": f"https://github.com/{owner}/{repo}",
    }


def _api_get(session: "requests.Session", path: str, timeout: int = 30) -> dict[str, Any]:
    """调用 GitHub API GET 请求。"""
    url = f"{GITHUB_API_BASE}{path}"
    print(f"[GITHUB] GET {url}", file=sys.stderr)
    response = session.get(url, timeout=timeout)
    if response.status_code == 403:
        # Rate limit 或 token 无效
        reset = response.headers.get("X-RateLimit-Reset", "?")
        print(f"[GITHUB] API 限流，重置时间: {reset}", file=sys.stderr)
    response.raise_for_status()
    return response.json()


def _safe_api_get(session: "requests.Session", path: str, timeout: int = 30) -> Optional[dict[str, Any]]:
    """调用 GitHub API GET 请求，失败返回 None。"""
    try:
        return _api_get(session, path, timeout)
    except Exception:
        return None


def _decode_readme(readme_data: Optional[dict[str, Any]]) -> str:
    """解码 README 的 base64 内容。"""
    if not readme_data:
        return ""
    encoded = readme_data.get("content", "")
    if not encoded:
        return ""
    return base64.b64decode(encoded).decode("utf-8", errors="replace")


def _render_repo_markdown(repo: dict[str, Any], readme_text: str) -> str:
    """将 repo 信息 + README 组装为 Markdown。"""
    description = repo.get("description") or "暂无仓库描述。"
    full_name = repo.get("full_name", "unknown")
    language = repo.get("language") or "未知"
    stars = repo.get("stargazers_count", 0)
    forks = repo.get("forks_count", 0)
    topics = repo.get("topics", [])
    homepage = repo.get("homepage") or "无"
    license_info = (repo.get("license") or {}).get("spdx_id", "")

    summary = (
        f"{full_name} 是一个 GitHub 仓库，主要语言为 {language}，"
        f"当前有 {stars} 个 stars 和 {forks} 个 forks。"
    )

    lines = [
        f"# {full_name}",
        "",
        "## 仓库摘要",
        "",
        summary,
        "",
        f"仓库描述：{description}",
        "",
        "## 仓库概览",
        "",
        f"- Stars: {stars}",
        f"- Forks: {forks}",
        f"- 主语言: {language}",
        f"- Topics: {', '.join(topics) or '无'}",
        f"- Homepage: {homepage}",
    ]

    if license_info:
        lines.append(f"- License: {license_info}")
    if repo.get("open_issues_count") is not None:
        lines.append(f"- Open Issues: {repo['open_issues_count']}")
    if repo.get("default_branch"):
        lines.append(f"- Default Branch: {repo['default_branch']}")

    lines.append("")

    if readme_text.strip():
        lines.extend(["## README", "", readme_text.strip()])

    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def fetch_github(url: str) -> dict:
    """
    抓取 GitHub repo 信息。

    Returns:
        dict with keys: title, content_markdown, description, stars, language,
                        topics, content_type, url, author, forks
    """
    import requests  # noqa: F401

    parsed = _parse_repo_url(url)
    print(f"[GITHUB] 目标: {parsed['owner']}/{parsed['repo']}", file=sys.stderr)

    session = _create_session()

    # 获取 repo 元数据
    repo_api = _api_get(session, f"/repos/{parsed['owner']}/{parsed['repo']}")
    print(f"[GITHUB] repo 元数据获取成功: {repo_api.get('full_name')}", file=sys.stderr)

    # 获取 README（允许失败）
    readme_api = _safe_api_get(session, f"/repos/{parsed['owner']}/{parsed['repo']}/readme")
    readme_text = _decode_readme(readme_api)
    if readme_text:
        print(f"[GITHUB] README 获取成功，长度: {len(readme_text)}", file=sys.stderr)
    else:
        print("[GITHUB] README 未获取到，跳过", file=sys.stderr)

    # 组装 Markdown
    content_md = _render_repo_markdown(repo_api, readme_text)

    owner_login = (repo_api.get("owner") or {}).get("login", "")

    return {
        "title": repo_api.get("full_name", ""),
        "content_markdown": content_md,
        "description": repo_api.get("description", ""),
        "stars": repo_api.get("stargazers_count", 0),
        "language": repo_api.get("language", ""),
        "topics": repo_api.get("topics", []),
        "forks": repo_api.get("forks_count", 0),
        "open_issues": repo_api.get("open_issues_count", 0),
        "content_type": "github",
        "url": repo_api.get("html_url", parsed["url"]),
        "author": owner_login,
    }


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="fetch-github - 通过 GitHub API 获取 repo 信息")
    parser.add_argument("--url", required=True, help="GitHub repo URL (如 https://github.com/owner/repo)")
    args = parser.parse_args()

    try:
        result = fetch_github(url=args.url)
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    except Exception as e:
        # GitHub 抓取失败时，回退到 WEB_ARTICLE（用通用网页抓取处理）
        print(f"HANDOFF: WEB_ARTICLE", file=sys.stderr)
        print(f"URL: {args.url}", file=sys.stderr)
        print(f"REASON: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
