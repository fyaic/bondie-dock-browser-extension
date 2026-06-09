"""
统一链接处理 pipeline。
"""

import sys
from datetime import datetime
from pathlib import Path

from analyzer import analyze_asset
from enrichment import enrich_asset
from formatter import MarkdownFormatter
from generation_payload import build_generation_payload
from github_fetcher import fetch_github_asset
from llm_writer import rewrite_analysis_with_llm
from main import fetch_article_content
from models import AnalysisResult, ContentAsset, PipelineResult
from polish_agent import polish_note, is_polish_enabled
from router import detect_link_type, detect_platform
from template_renderer import render_note, render_report, render_report_blocks
from title_utils import pick_best_title
from video_pipeline import fetch_video_asset


def run_link_pipeline(
    url: str,
    output_dir: Path,
    download_images: bool = True,
    delivery_context: dict | None = None,
) -> PipelineResult:
    """根据链接类型执行统一终态 pipeline。"""
    link_type = detect_link_type(url)

    if link_type == "article":
        return _run_article_like_pipeline(
            url=url,
            output_dir=output_dir,
            download_images=download_images,
            content_type="article",
            delivery_context=delivery_context,
        )
    if link_type == "video":
        return _run_video_pipeline(
            url=url,
            output_dir=output_dir,
            delivery_context=delivery_context,
        )
    if link_type == "github":
        return _run_github_pipeline(
            url=url,
            output_dir=output_dir,
            delivery_context=delivery_context,
        )
    return _run_article_like_pipeline(
        url=url,
        output_dir=output_dir,
        download_images=download_images,
        content_type="article",
        delivery_context=delivery_context,
    )


def _run_article_like_pipeline(
    url: str,
    output_dir: Path,
    download_images: bool,
    content_type: str,
    delivery_context: dict | None,
) -> PipelineResult:
    article_data = fetch_article_content(
        url=url,
        output_dir=output_dir,
        download_images=download_images,
    )
    fetch_result = article_data["fetch_result"]

    asset = ContentAsset(
        source_url=url,
        resolved_url=fetch_result["url"],
        content_type=content_type,
        source_platform=detect_platform(fetch_result["url"], content_type),
        title=fetch_result["title"],
        author=fetch_result.get("metadata", {}).get("author", ""),
        published_at=fetch_result.get("metadata", {}).get("date", ""),
        body_markdown=article_data["content_markdown"],
        raw_html=fetch_result.get("html", ""),
        metadata=fetch_result.get("metadata", {}),
        source_kind=content_type,
        summary_source="body_markdown",
    )

    return _finalize_asset_pipeline(
        asset=asset,
        output_dir=output_dir,
        delivery_context=delivery_context,
        extra={
            "fetcher_type": article_data["fetcher_type"],
            "word_count": article_data["formatter"].stats["word_count"],
            "images_count": article_data["formatter"].stats["image_count"],
            "warnings": article_data.get("warnings", []),
            "image_status": article_data.get("image_status", ""),
        },
    )


def _run_video_pipeline(
    url: str,
    output_dir: Path,
    delivery_context: dict | None,
) -> PipelineResult:
    try:
        asset, extra = fetch_video_asset(url=url, output_dir=output_dir)
    except Exception as exc:
        platform = detect_platform(url, "video")
        title = pick_best_title(
            f"{platform} 视频转写失败 {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            url,
        )
        transcript = f"视频链路未完成处理：{exc}"
        asset = ContentAsset(
            source_url=url,
            resolved_url=url,
            content_type="video",
            source_platform=platform,
            title=title,
            transcript=transcript,
            source_kind="video",
            summary_source="transcript",
            extra_context={"processing_status": "failed"},
        )
        extra = {
            "fetcher_type": "video-fallback",
            "word_count": len(transcript),
            "images_count": 0,
            "warnings": [str(exc)],
            "image_status": "not_supported",
        }
        return _build_failed_pipeline_result(
            asset=asset,
            output_dir=output_dir,
            delivery_context=delivery_context,
            extra=extra,
        )

    return _finalize_asset_pipeline(
        asset=asset,
        output_dir=output_dir,
        delivery_context=delivery_context,
        extra=extra,
    )


def _run_github_pipeline(
    url: str,
    output_dir: Path,
    delivery_context: dict | None,
) -> PipelineResult:
    try:
        asset, extra = fetch_github_asset(url)
    except Exception as exc:
        article_data = fetch_article_content(
            url=url,
            output_dir=output_dir,
            download_images=False,
        )
        fetch_result = article_data["fetch_result"]
        asset = ContentAsset(
            source_url=url,
            resolved_url=fetch_result["url"],
            content_type="github",
            source_platform=detect_platform(fetch_result["url"], "github"),
            title=fetch_result["title"],
            author=fetch_result.get("metadata", {}).get("author", ""),
            published_at=fetch_result.get("metadata", {}).get("date", ""),
            body_markdown=article_data["content_markdown"],
            raw_html=fetch_result.get("html", ""),
            metadata=fetch_result.get("metadata", {}),
            source_kind="github-page",
            summary_source="body_markdown",
            extra_context={"processing_status": "fallback"},
        )
        extra = {
            "fetcher_type": "github-page-fallback",
            "word_count": article_data["formatter"].stats["word_count"],
            "images_count": article_data["formatter"].stats["image_count"],
            "warnings": [f"GitHub API 抓取失败，已回退到网页抓取：{exc}"],
            "image_status": article_data.get("image_status", ""),
        }

    return _finalize_asset_pipeline(
        asset=asset,
        output_dir=output_dir,
        delivery_context=delivery_context,
        extra=extra,
    )


def _finalize_asset_pipeline(
    asset: ContentAsset,
    output_dir: Path,
    delivery_context: dict | None,
    extra: dict,
) -> PipelineResult:
    analysis = analyze_asset(asset)
    rewritten = rewrite_analysis_with_llm(asset, analysis)
    if rewritten:
        analysis = rewritten
    analysis = _ensure_analysis_summary(asset, analysis)
    enrichment = enrich_asset(asset, analysis)
    note_path = _build_note_path(output_dir, asset.title)
    generation_payload = build_generation_payload(
        asset,
        analysis,
        enrichment,
        note_path,
        delivery_context=delivery_context,
        fetch_context={
            "fetcher_type": extra.get("fetcher_type", ""),
            "image_status": extra.get("image_status", ""),
            "warnings": extra.get("warnings", []),
        },
    )
    note_content = render_note(
        asset,
        analysis,
        enrichment=enrichment,
        note_path=note_path,
        status="generated",
    )

    # 调用 code-agent 润色笔记（如果启用）
    if is_polish_enabled():
        print("[pipeline] 正在调用 code-agent 润色笔记...", file=sys.stderr)
        note_content = polish_note(
            note_content=note_content,
            source_url=asset.resolved_url,
        )
        print("[pipeline] 润色完成", file=sys.stderr)

    note_path = _write_note(note_path, note_content)
    report_content = render_report(
        asset,
        analysis,
        enrichment=enrichment,
        note_path=note_path,
        status="generated",
        note_content=note_content,
    )
    report_blocks = render_report_blocks(
        asset,
        analysis,
        enrichment=enrichment,
        note_path=note_path,
        status="generated",
        note_content=note_content,
    )

    return PipelineResult(
        asset=asset,
        analysis=analysis,
        enrichment=enrichment,
        note_content=note_content,
        report_content=report_content,
        generation_payload=generation_payload,
        report_blocks=report_blocks,
        note_path=note_path,
        extra=extra,
        status="generated",
    )


def _build_failed_pipeline_result(
    asset: ContentAsset,
    output_dir: Path,
    delivery_context: dict | None,
    extra: dict,
) -> PipelineResult:
    reason = extra.get("warnings", ["链接处理失败"])[0]
    analysis = AnalysisResult(
        tldr=reason,
        key_points=[reason],
        why_it_matters="",
        sections=[
            {
                "title": "失败原因",
                "bullets": [reason],
            }
        ],
        intent="tech_news",
        intent_label="处理失败",
    )
    enrichment = enrich_asset(asset, analysis)
    note_path = _build_note_path(output_dir, asset.title)
    generation_payload = build_generation_payload(
        asset,
        analysis,
        enrichment,
        note_path,
        delivery_context=delivery_context,
        fetch_context={
            "fetcher_type": extra.get("fetcher_type", ""),
            "image_status": extra.get("image_status", ""),
            "warnings": extra.get("warnings", []),
            "processing_status": "failed",
        },
    )
    note_content = render_note(
        asset,
        analysis,
        enrichment=enrichment,
        note_path=note_path,
        status="failed",
    )
    note_path = _write_note(note_path, note_content)
    report_content = render_report(
        asset,
        analysis,
        enrichment=enrichment,
        note_path=note_path,
        status="failed",
        note_content=note_content,
    )
    report_blocks = render_report_blocks(
        asset,
        analysis,
        enrichment=enrichment,
        note_path=note_path,
        status="failed",
        note_content=note_content,
    )
    return PipelineResult(
        asset=asset,
        analysis=analysis,
        enrichment=enrichment,
        note_content=note_content,
        report_content=report_content,
        generation_payload=generation_payload,
        report_blocks=report_blocks,
        note_path=note_path,
        extra=extra,
        status="failed",
    )


def _ensure_analysis_summary(asset: ContentAsset, analysis: AnalysisResult) -> AnalysisResult:
    """为终态结果补足稳定 TL;DR，避免出现空结论。"""
    if analysis.key_points and analysis.tldr.strip():
        return analysis

    fallback_points = [point.strip() for point in analysis.key_points if point.strip()]
    if not fallback_points:
        for section in analysis.sections:
            title = str(section.get("title", "")).strip()
            bullets = [str(item).strip() for item in section.get("bullets", []) if str(item).strip()]
            if not bullets:
                continue
            if title:
                fallback_points.append(f"{title}：{bullets[0]}")
            else:
                fallback_points.append(bullets[0])
            if len(fallback_points) == 3:
                break
    if not fallback_points:
        fallback_points = [f"{asset.title} 已完成解析，可查看 Obsidian 笔记获取详情。"]

    return AnalysisResult(
        tldr=analysis.tldr.strip() or fallback_points[0],
        key_points=fallback_points[:3],
        why_it_matters=analysis.why_it_matters,
        sections=analysis.sections,
        intent=analysis.intent,
        intent_label=analysis.intent_label,
    )


def _build_note_path(output_dir: Path, title: str) -> Path:
    formatter = MarkdownFormatter()
    safe_title = formatter._sanitize_filename(title)
    return output_dir / f"{safe_title}.md"


def _write_note(note_path: Path, note_content: str) -> Path:
    note_path.parent.mkdir(parents=True, exist_ok=True)
    with open(note_path, "w", encoding="utf-8", newline="\n") as file_obj:
        file_obj.write(note_content)
    return note_path
