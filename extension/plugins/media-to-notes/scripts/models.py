"""
统一内容模型
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ContentAsset:
    """统一的链接内容模型。"""

    source_url: str
    resolved_url: str
    content_type: str
    source_platform: str
    title: str
    author: str = ""
    published_at: str = ""
    body_markdown: str = ""
    raw_html: str = ""
    transcript: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    canonical_id: str = ""
    source_kind: str = ""
    summary_source: str = ""
    attachments: List[Dict[str, Any]] = field(default_factory=list)
    extra_context: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AnalysisResult:
    """统一分析结果。"""

    tldr: str
    key_points: List[str]
    why_it_matters: str
    sections: List[Dict[str, Any]] = field(default_factory=list)
    intent: str = "tech_news"
    intent_label: str = "技术新闻"


@dataclass
class RelatedResource:
    """延展资源。"""

    title: str
    url: str
    category: str
    source: str = ""
    note: str = ""


@dataclass
class EnrichmentResult:
    """延展补充结果。"""

    summary: str
    entities: List[str] = field(default_factory=list)
    resources: List[RelatedResource] = field(default_factory=list)


@dataclass
class PipelineResult:
    """统一 pipeline 输出。"""

    asset: ContentAsset
    analysis: AnalysisResult
    enrichment: EnrichmentResult
    note_content: str
    report_content: str
    generation_payload: Dict[str, Any] = field(default_factory=dict)
    report_blocks: List[Dict[str, Any]] = field(default_factory=list)
    note_path: Optional[Path] = None
    extra: Dict[str, Any] = field(default_factory=dict)
    status: str = "generated"
