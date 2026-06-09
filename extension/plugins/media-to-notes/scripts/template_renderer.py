"""
统一模板渲染。
"""

from datetime import datetime
from pathlib import Path
import re

from config import config
from models import AnalysisResult, ContentAsset, EnrichmentResult
from obsidian_utils import build_obsidian_open_url


def build_note_view_model(
    asset: ContentAsset,
    analysis: AnalysisResult,
    enrichment: EnrichmentResult,
    note_path: Path | None = None,
) -> dict:
    """构建笔记与播报共用的数据视图。"""
    return {
        "title": asset.title.strip() or asset.resolved_url,
        "source_url": asset.resolved_url,
        "content_type": asset.content_type,
        "platform": asset.source_platform,
        "intent": analysis.intent,
        "intent_label": analysis.intent_label,
        "why_it_matters": analysis.why_it_matters.strip(),
        "author": asset.author,
        "published_at": asset.published_at,
        "processed_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "tldr_lines": _build_tldr_lines(analysis),
        "transcript": asset.transcript.strip(),
        "detail_sections": analysis.sections,
        "enrichment_summary": enrichment.summary,
        "entities": enrichment.entities,
        "resources": enrichment.resources,
        "obsidian_url": build_obsidian_open_url(
            note_path,
            vault_root=config.output.vault_root,
        ) if note_path else "",
        "note_name": note_path.name if note_path else "",
    }


def render_note(
    asset: ContentAsset,
    analysis: AnalysisResult,
    enrichment: EnrichmentResult,
    note_path: Path | None = None,
    status: str = "generated",
) -> str:
    """渲染最终笔记或失败笔记。"""
    view = build_note_view_model(asset, analysis, enrichment, note_path=note_path)
    lines = [f"# {view['title']}", ""]

    if status == "failed":
        lines.extend([
            "> 当前链路处理失败，本笔记仅记录失败原因与已获取到的上下文。",
            "",
        ])

    lines.append("> **TL;DR**:")
    lines.extend([f"> - {line}" for line in view["tldr_lines"]])
    lines.extend([
        ">",
        f"> **原文链接**: {view['source_url']}",
    ])

    if view["obsidian_url"]:
        lines.extend([
            ">",
            f"> **Obsidian**: [{view['note_name']}]({view['obsidian_url']})",
        ])

    lines.extend([
        "",
        f"- 类型：{view['content_type']}",
        f"- 平台：{view['platform']}",
    ])
    if view["author"]:
        lines.append(f"- 作者：{view['author']}")
    if view["published_at"]:
        lines.append(f"- 发布时间：{view['published_at']}")
    lines.append(f"- 处理时间：{view['processed_at']}")

    lines.extend([
        "",
        f"## 详细笔记（{view['intent_label']}）",
        "",
    ])
    for section in view["detail_sections"]:
        lines.append(f"### {section['title']}")
        lines.append("")
        for bullet in section["bullets"]:
            lines.append(f"- {bullet}")
        lines.append("")

    if view["transcript"] and status == "failed":
        lines.extend([
            "## 已获取上下文",
            "",
            view["transcript"],
            "",
        ])

    lines.extend([
        "## 延展补充与溯源",
        "",
        view["enrichment_summary"],
    ])

    if view["resources"]:
        lines.extend([
            "",
            "### 相关资源",
            "",
        ])
        for resource in view["resources"]:
            lines.append(f"- [{resource.title}]({resource.url})")

    return "\n".join(lines).strip() + "\n"


def render_report(
    asset: ContentAsset,
    analysis: AnalysisResult,
    enrichment: EnrichmentResult,
    note_path: Path | None = None,
    status: str = "generated",
    note_content: str = "",
) -> str:
    """从最终笔记反推 Slack 文本播报。"""
    view = build_note_view_model(asset, analysis, enrichment, note_path=note_path)
    note_summary = summarize_note_content(note_content or "")
    # 优先使用从 note_content 提取的内容；只有当 note_content 为空时才回退到旧内容
    tldr_lines = note_summary["tldr_lines"] if note_content else view["tldr_lines"]
    # 如果提取失败且 note_content 有内容，尝试使用旧的 view 作为后备
    if not tldr_lines and note_content:
        tldr_lines = view["tldr_lines"]
    resources = note_summary["resources"] if note_content else [
        {"title": item.title, "url": item.url} for item in view["resources"][:3]
    ]

    if status == "failed":
        lines = [
            f"链接处理失败：{view['title']}",
            "",
            "失败原因:",
        ]
        for point in tldr_lines:
            lines.append(f"- {point}")
    else:
        lines = [
            f"知识沉淀完成：{view['title']}",
            "",
            "TL;DR:",
        ]
        for point in tldr_lines:
            lines.append(f"- {point}")
        if resources:
            lines.extend(["", "延展资源:"])
            for resource in resources[:3]:
                lines.append(f"- {resource['title']}: {resource['url']}")

    if view["obsidian_url"]:
        lines.extend(["", f"Obsidian：{view['obsidian_url']}"])
    return "\n".join(lines)


def render_report_blocks(
    asset: ContentAsset,
    analysis: AnalysisResult,
    enrichment: EnrichmentResult,
    note_path: Path | None = None,
    status: str = "generated",
    note_content: str = "",
) -> list[dict]:
    """从最终笔记反推终态 Slack Block Kit。"""
    view = build_note_view_model(asset, analysis, enrichment, note_path=note_path)
    note_summary = summarize_note_content(note_content or "")
    # 优先使用从 note_content 提取的内容；只有当 note_content 为空时才回退到旧内容
    tldr_lines = note_summary["tldr_lines"] if note_content else view["tldr_lines"]
    # 如果提取失败且 note_content 有内容，尝试使用旧的 view 作为后备
    if not tldr_lines and note_content:
        tldr_lines = view["tldr_lines"]
    resources = note_summary["resources"] if note_content else [
        {"title": item.title, "url": item.url} for item in view["resources"][:4]
    ]

    content_type_label = {
        "article": "文章解析",
        "video": "视频解析",
        "github": "GitHub 解析",
    }.get(asset.content_type, "链接解析")

    header_text = (
        f"⚠️ {content_type_label}失败"
        if status == "failed"
        else f"{_content_type_emoji(asset.content_type)} {content_type_label}完成"
    )
    summary_text = (
        "本次没有拿到可用正文，未进入成功沉淀。"
        if status == "failed"
        else (view["why_it_matters"] or (tldr_lines[0] if tldr_lines else ""))
    )

    blocks = [
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
                "text": f"*{view['title']}*\n{summary_text}",
            },
        },
        {
            "type": "section",
            "fields": _build_generated_fields(view, status=status),
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": ("*失败原因*\n" if status == "failed" else "*TL;DR*\n")
                + "\n".join(f"• {point}" for point in tldr_lines),
            },
        },
    ]

    if resources and status != "failed":
        resource_lines = [f"• <{item['url']}|{item['title']}>" for item in resources[:4]]
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

    blocks.extend(_build_generated_archive_blocks(view))
    return blocks


def render_processing_report(
    url: str,
    content_type: str,
    platform: str,
) -> str:
    """渲染处理中 Slack 文本。"""
    return (
        f"已进入知识沉淀流程：{platform} { _content_type_processing_label(content_type) }\n\n"
        "正在解析内容、生成 Obsidian 笔记，并整理最终 Slack 汇报。"
    )


def render_processing_report_blocks(
    url: str,
    content_type: str,
    platform: str,
) -> list[dict]:
    """渲染处理中 Slack Block Kit。"""
    content_label = _content_type_processing_label(content_type)
    stage_text = {
        "video": "正在抽取元数据、画面与正文",
        "github": "正在识别仓库定位并整理笔记",
        "article": "正在抓取正文并整理笔记",
    }.get(content_type, "正在执行知识沉淀流程")
    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "⏳ 已进入知识沉淀流程",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"正在处理这条 *{platform}* {content_label}，结果会自动回到当前线程。",
            },
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*类型:*\n{content_label}"},
                {"type": "mrkdwn", "text": f"*平台:*\n{platform}"},
                {"type": "mrkdwn", "text": f"*状态:*\n处理中"},
                {"type": "mrkdwn", "text": f"*阶段:*\n{stage_text}"},
            ],
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"原始链接：<{url}|打开来源>",
                }
            ],
        },
    ]


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


def _build_tldr_lines(analysis: AnalysisResult) -> list[str]:
    lines = []
    seen = set()
    for point in analysis.key_points:
        value = point.strip()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        lines.append(value)
        if len(lines) == 3:
            break
    if not lines and analysis.tldr.strip():
        lines.append(analysis.tldr.strip())
    if not lines:
        lines.append("未提取到有效结论。")
    return lines


def _content_type_emoji(content_type: str) -> str:
    return {
        "article": "📰",
        "video": "🎬",
        "github": "🧩",
    }.get(content_type, "📎")


def _content_type_processing_label(content_type: str) -> str:
    return {
        "article": "文章",
        "video": "视频",
        "github": "GitHub",
    }.get(content_type, "链接")


def _build_generated_fields(view: dict, status: str) -> list[dict]:
    fields = [
        {"type": "mrkdwn", "text": f"*平台:*\n{view['platform']}"},
        {
            "type": "mrkdwn",
            "text": f"*类型:*\n{'处理失败' if status == 'failed' else view['intent_label']}",
        },
    ]
    if view["author"]:
        fields.append({"type": "mrkdwn", "text": f"*作者:*\n{view['author']}"})
    if view["published_at"]:
        fields.append({"type": "mrkdwn", "text": f"*发布时间:*\n{view['published_at']}"})
    else:
        fields.append({"type": "mrkdwn", "text": f"*处理时间:*\n{view['processed_at']}"})
    return fields[:4]


def _build_generated_archive_blocks(view: dict) -> list[dict]:
    blocks = [{"type": "divider"}]
    if view["obsidian_url"]:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*笔记归档*\n<{view['obsidian_url']}|在 Obsidian 中打开>",
            },
        })
    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": f"原始链接：<{view['source_url']}|打开来源>",
            },
        ],
    })
    return blocks
