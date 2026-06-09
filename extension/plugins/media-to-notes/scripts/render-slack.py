#!/usr/bin/env python3
"""
独立 CLI 工具：从最终笔记渲染 Slack Block Kit。

逻辑从 template_renderer.py 的 render_report_blocks() 和 summarize_note_content() 搬迁。

用法:
    python3 render-slack.py \
      --note-file /path/to/note.md \
      --source-url URL \
      --title "标题" \
      --content-type article|video|github \
      --platform "平台" \
      --author "作者" \
      --status generated|failed

stdout: JSON {"text": "纯文本播报", "blocks": [...Slack Block Kit...]}
"""

from __future__ import annotations

import argparse
import json
import re
import sys


# ---------------------------------------------------------------------------
# 辅助函数（从 template_renderer 搬迁）
# ---------------------------------------------------------------------------

def _content_type_emoji(content_type: str) -> str:
    return {
        "article": "\U0001f4f0",
        "video": "\U0001f3ac",
        "github": "\U0001f9e9",
    }.get(content_type, "\U0001f4ce")


def _content_type_processing_label(content_type: str) -> str:
    return {
        "article": "文章",
        "video": "视频",
        "github": "GitHub",
    }.get(content_type, "链接")


def _content_type_result_label(content_type: str) -> str:
    """解析结果标签（用于 header）。"""
    return {
        "article": "文章解析",
        "video": "视频解析",
        "github": "GitHub 解析",
    }.get(content_type, "链接解析")


# ---------------------------------------------------------------------------
# summarize_note_content（完整搬迁）
# ---------------------------------------------------------------------------

def summarize_note_content(note_content: str) -> dict:
    """从最终笔记中提取 TL;DR 与资源，作为 Slack 播报唯一正文来源。"""
    tldr_lines: list[str] = []
    resources: list[dict] = []
    section = ""

    for raw_line in note_content.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()

        # 更宽松的 TL;DR 检测（支持各种格式变体）
        if stripped.startswith("> **TL;DR**") or stripped.startswith("> **TL;DR**:"):
            section = "tldr"
            # 检查同一行是否有内容（如 "> **TL;DR**: 内容"）
            if ":" in stripped:
                content_after_colon = stripped.split(":", 1)[1].strip()
                if content_after_colon:
                    tldr_lines.append(content_after_colon)
            continue
        if stripped.startswith("## "):
            title = stripped[3:].strip()
            if title == "延展补充与溯源":
                section = "enrichment"
            elif title.startswith("详细笔记"):
                section = "detail"
            else:
                section = ""
            continue
        if stripped == "### 相关资源":
            section = "resources"
            continue
        if not stripped:
            # 空行可能表示 TL;DR 结束，但继续检查下一行
            if section == "tldr" and tldr_lines:
                section = ""
            continue

        # TL;DR 内容：支持 "> - 内容"、"> 内容" 或 "- 内容"
        if section == "tldr":
            if line.startswith("> - "):
                tldr_lines.append(line[4:].strip())
            elif line.startswith("> ") and not line.startswith("> *"):
                # 引用块中的普通文本（排除其他标记如 > **原文链接**）
                tldr_lines.append(line[2:].strip())
            continue
        if section == "resources" and stripped.startswith("- "):
            match = re.match(r"- \[(.+?)\]\((.+?)\)", stripped)
            if match:
                resources.append({"title": match.group(1), "url": match.group(2)})

    return {
        "tldr_lines": [line for line in tldr_lines if line][:3],
        "resources": resources[:4],
    }


# ---------------------------------------------------------------------------
# fields / archive blocks 构建（从 template_renderer 搬迁）
# ---------------------------------------------------------------------------

def _build_generated_fields(
    platform: str,
    content_type: str,
    intent_label: str,
    author: str,
    published_at: str,
    processed_at: str,
    status: str,
) -> list[dict]:
    fields = [
        {"type": "mrkdwn", "text": f"*平台:*\n{platform}"},
        {
            "type": "mrkdwn",
            "text": f"*类型:*\n{'处理失败' if status == 'failed' else intent_label}",
        },
    ]
    if author:
        fields.append({"type": "mrkdwn", "text": f"*作者:*\n{author}"})
    if published_at:
        fields.append({"type": "mrkdwn", "text": f"*发布时间:*\n{published_at}"})
    else:
        fields.append({"type": "mrkdwn", "text": f"*处理时间:*\n{processed_at}"})
    return fields[:4]


def _build_generated_archive_blocks(source_url: str) -> list[dict]:
    blocks = [{"type": "divider"}]
    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": f"原始链接：<{source_url}|打开来源>",
            },
        ],
    })
    return blocks


# ---------------------------------------------------------------------------
# render_report_blocks（从 template_renderer.render_report_blocks 搬迁）
# ---------------------------------------------------------------------------

def render_report_blocks(
    *,
    note_content: str,
    source_url: str,
    title: str,
    content_type: str,
    platform: str,
    author: str,
    published_at: str,
    intent_label: str,
    why_it_matters: str,
    status: str,
) -> list[dict]:
    """从最终笔记反推终态 Slack Block Kit。"""
    from datetime import datetime

    note_summary = summarize_note_content(note_content)
    tldr_lines = note_summary["tldr_lines"]
    resources = note_summary["resources"]

    content_type_label = _content_type_result_label(content_type)
    emoji = _content_type_emoji(content_type)
    processed_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    header_text = (
        f"\u26a0\ufe0f {content_type_label}失败"
        if status == "failed"
        else f"{emoji} {content_type_label}完成"
    )
    summary_text = (
        "本次没有拿到可用正文，未进入成功沉淀。"
        if status == "failed"
        else (why_it_matters or (tldr_lines[0] if tldr_lines else ""))
    )

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": header_text,
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*{title}*\n{summary_text}",
            },
        },
        {
            "type": "section",
            "fields": _build_generated_fields(
                platform=platform,
                content_type=content_type,
                intent_label=intent_label,
                author=author,
                published_at=published_at,
                processed_at=processed_at,
                status=status,
            ),
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": ("*失败原因*\n" if status == "failed" else "*TL;DR*\n")
                + "\n".join(f"\u2022 {point}" for point in tldr_lines),
            },
        },
    ]

    if resources and status != "failed":
        resource_lines = [f"\u2022 <{item['url']}|{item['title']}>" for item in resources[:4]]
        blocks.extend([
            {"type": "divider"},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "*延展资源*\n" + "\n".join(resource_lines),
                },
            },
        ])

    blocks.extend(_build_generated_archive_blocks(source_url))
    return blocks


# ---------------------------------------------------------------------------
# render_report（纯文本版播报，从 template_renderer.render_report 搬迁）
# ---------------------------------------------------------------------------

def render_report(
    *,
    note_content: str,
    source_url: str,
    title: str,
    content_type: str,
    platform: str,
    author: str,
    intent_label: str,
    status: str,
) -> str:
    """从最终笔记反推 Slack 文本播报（纯文本 fallback）。"""
    note_summary = summarize_note_content(note_content)
    tldr_lines = note_summary["tldr_lines"]
    resources = note_summary["resources"]

    if status == "failed":
        lines = [
            f"链接处理失败：{title}",
            "",
            "失败原因:",
        ]
        for point in tldr_lines:
            lines.append(f"- {point}")
    else:
        lines = [
            f"知识沉淀完成：{title}",
            "",
            "TL;DR:",
        ]
        for point in tldr_lines:
            lines.append(f"- {point}")
        if resources:
            lines.extend(["", "延展资源:"])
            for resource in resources[:3]:
                lines.append(f"- {resource['title']}: {resource['url']}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="从最终笔记渲染 Slack Block Kit",
    )
    parser.add_argument(
        "--note-file", required=True,
        help="最终笔记 Markdown 文件路径",
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
    parser.add_argument("--status", default="generated",
                        choices=["generated", "failed"],
                        help="处理状态")

    # 可选：来自 analysis JSON 的元信息（用于 richer blocks）
    parser.add_argument("--intent-label", default="", help="意图标签")
    parser.add_argument("--why-it-matters", default="", help="为什么重要")
    parser.add_argument("--published-at", default="", help="发布日期")

    args = parser.parse_args()

    # 读取笔记文件
    try:
        with open(args.note_file, "r", encoding="utf-8") as f:
            note_content = f.read()
    except Exception as exc:
        print(f"[render-slack] 无法读取笔记文件: {exc}", file=sys.stderr)
        sys.exit(1)

    # 渲染
    blocks = render_report_blocks(
        note_content=note_content,
        source_url=args.source_url,
        title=args.title,
        content_type=args.content_type,
        platform=args.platform,
        author=args.author,
        published_at=args.published_at,
        intent_label=args.intent_label,
        why_it_matters=args.why_it_matters,
        status=args.status,
    )

    text = render_report(
        note_content=note_content,
        source_url=args.source_url,
        title=args.title,
        content_type=args.content_type,
        platform=args.platform,
        author=args.author,
        intent_label=args.intent_label,
        status=args.status,
    )

    # 输出 JSON
    output = {"text": text, "blocks": blocks}
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
