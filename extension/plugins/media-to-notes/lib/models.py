"""组件化数据模型"""

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class AnalysisResult:
    """分析结果"""

    tldr: str
    key_points: List[str]
    why_it_matters: str
    sections: List[Dict[str, Any]] = field(default_factory=list)
    intent: str = "tech_news"
    intent_label: str = "技术新闻"


@dataclass
class RelatedResource:
    """延展资源"""

    title: str
    url: str
    category: str
    source: str = ""
    note: str = ""


@dataclass
class EnrichmentResult:
    """延展补充结果"""

    summary: str
    entities: List[str] = field(default_factory=list)
    resources: List[RelatedResource] = field(default_factory=list)
