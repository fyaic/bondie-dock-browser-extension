"""
保留字段兼容，但不再向上层暴露可继续生成的草稿上下文。
"""

from pathlib import Path

from models import AnalysisResult, ContentAsset, EnrichmentResult


def build_generation_payload(
    asset: ContentAsset,
    analysis: AnalysisResult,
    enrichment: EnrichmentResult,
    note_path: Path,
    delivery_context: dict | None = None,
    fetch_context: dict | None = None,
) -> dict:
    """构建只读的 pipeline 元数据，避免上层接管后半程。"""
    return {
        "mode": "pipeline_managed",
        "final_note_path": str(note_path),
        "canonical_report_ready": True,
        "content_type": asset.content_type,
        "platform": asset.source_platform,
        "title": asset.title,
        "source_url": asset.resolved_url,
        "tldr_lines": list(analysis.key_points[:3]),
        "resource_count": len(enrichment.resources),
        "delivery": delivery_context or {},
        "fetch_context": fetch_context or {},
    }
