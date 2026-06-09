#!/usr/bin/env python3
"""
独立 CLI 工具：将分析结果 + 延展结果渲染为 Obsidian Markdown 笔记。

逻辑从 template_renderer.py 的 render_note() 函数搬迁。
不依赖 ContentAsset，所有数据通过 CLI 参数和 JSON 文件传入。

用法:
    python3 render-note.py \
      --analysis-file /path/to/analysis.json \
      --enrichment-file /path/to/enrichment.json \
      --source-url URL \
      --title "标题" \
      --content-type article|video|github \
      --platform "平台" \
      --author "作者" \
      --published-at "日期" \
      --status generated|failed

stdout: 完整的 Obsidian Markdown 笔记
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime


# ---------------------------------------------------------------------------
# TL;DR 构建（从 template_renderer._build_tldr_lines 搬迁）
# ---------------------------------------------------------------------------

def _build_tldr_lines(analysis: dict) -> list[str]:
    """从 analysis JSON 构建 TL;DR 行，去重，最多 3 条。

    优先级：key_points -> tldr 字段 -> fallback
    """
    lines: list[str] = []
    seen: set[str] = set()

    for point in analysis.get("key_points", []):
        value = point.strip() if isinstance(point, str) else str(point).strip()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        lines.append(value)
        if len(lines) == 3:
            break

    if not lines:
        tldr = analysis.get("tldr", "").strip()
        if tldr:
            lines.append(tldr)

    if not lines:
        lines.append("未提取到有效结论。")

    return lines


# ---------------------------------------------------------------------------
# 主渲染逻辑（从 template_renderer.render_note 搬迁）
# ---------------------------------------------------------------------------

def render_note(
    analysis: dict,
    enrichment: dict,
    *,
    source_url: str,
    title: str,
    content_type: str,
    platform: str,
    author: str = "",
    published_at: str = "",
    status: str = "generated",
) -> str:
    """渲染 Obsidian Markdown 笔记。"""
    tldr_lines = _build_tldr_lines(analysis)
    processed_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    intent_label = analysis.get("intent_label", "")
    sections = analysis.get("sections", [])
    enrichment_summary = enrichment.get("summary", "")
    resources = enrichment.get("resources", [])

    lines: list[str] = [f"# {title}", ""]

    # 失败标记
    if status == "failed":
        lines.extend([
            "> 当前链路处理失败，本笔记仅记录失败原因与已获取到的上下文。",
            "",
        ])

    # TL;DR
    lines.append("> **TL;DR**:")
    lines.extend([f"> - {line}" for line in tldr_lines])
    lines.extend([
        ">",
        f"> **原文链接**: {source_url}",
    ])

    # 元信息
    lines.extend([
        "",
        f"- 类型：{content_type}",
        f"- 平台：{platform}",
    ])
    if author:
        lines.append(f"- 作者：{author}")
    if published_at:
        lines.append(f"- 发布时间：{published_at}")
    lines.append(f"- 处理时间：{processed_at}")

    # 详细笔记
    content_md = analysis.get("content_markdown", "").strip()
    lines.extend([
        "",
        f"## 详细笔记（{intent_label}）",
        "",
    ])
    if content_md:
        # 优先使用完整的 Markdown 正文
        lines.append(content_md)
        lines.append("")
    else:
        # 回退到 bullet sections 渲染
        for section in sections:
            section_title = section.get("title", "")
            bullets = section.get("bullets", [])
            lines.append(f"### {section_title}")
            lines.append("")
            for bullet in bullets:
                lines.append(f"- {bullet}")
            lines.append("")

    # 延展补充与溯源
    lines.extend([
        "## 延展补充与溯源",
        "",
        enrichment_summary,
    ])

    if resources:
        lines.extend([
            "",
            "### 相关资源",
            "",
        ])
        for resource in resources:
            res_title = resource.get("title", resource.get("url", ""))
            res_url = resource.get("url", "")
            lines.append(f"- [{res_title}]({res_url})")

    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="将分析结果 + 延展结果渲染为 Obsidian Markdown 笔记",
    )
    parser.add_argument(
        "--analysis-file", required=True,
        help="分析结果 JSON 文件路径",
    )
    parser.add_argument(
        "--enrichment-file", required=True,
        help="延展结果 JSON 文件路径",
    )
    parser.add_argument("--source-url", required=True, help="原始来源 URL")
    parser.add_argument("--title", required=True, help="笔记标题")
    parser.add_argument(
        "--content-type", required=True,
        choices=["article", "video", "github"],
        help="内容类型",
    )
    parser.add_argument("--platform", required=True, help="来源平台")
    parser.add_argument("--author", default="", help="作者")
    parser.add_argument("--published-at", default="", help="发布日期")
    parser.add_argument(
        "--status", default="generated",
        choices=["generated", "failed"],
        help="处理状态",
    )

    args = parser.parse_args()

    # 读取 JSON 文件
    try:
        with open(args.analysis_file, "r", encoding="utf-8") as f:
            analysis = json.load(f)
    except Exception as exc:
        print(f"[render-note] 无法读取 analysis 文件: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(args.enrichment_file, "r", encoding="utf-8") as f:
            enrichment = json.load(f)
    except Exception as exc:
        print(f"[render-note] 无法读取 enrichment 文件: {exc}", file=sys.stderr)
        sys.exit(1)

    # 渲染并输出到 stdout
    note = render_note(
        analysis,
        enrichment,
        source_url=args.source_url,
        title=args.title,
        content_type=args.content_type,
        platform=args.platform,
        author=args.author,
        published_at=args.published_at,
        status=args.status,
    )
    sys.stdout.write(note)


if __name__ == "__main__":
    main()
