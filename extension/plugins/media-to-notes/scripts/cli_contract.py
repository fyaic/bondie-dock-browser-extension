"""
CLI 输出契约校验。
"""

from typing import Any, Dict


REQUIRED_FIELDS = {
    "success": bool,
    "status": str,
    "path": str,
    "title": str,
    "url": str,
    "content_type": str,
    "tldr": str,
    "word_count": int,
    "images_count": int,
    "fetcher_type": str,
    "warnings": list,
    "image_status": str,
    "report": str,
    "enrichment_summary": str,
    "related_resources": list,
    "generation_payload": dict,
    "report_blocks": list,
    "report_payload": dict,
}


def validate_cli_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """校验 CLI 输出结构，确保只暴露终态结果。"""
    for field_name, field_type in REQUIRED_FIELDS.items():
        if field_name not in payload:
            raise ValueError(f"CLI 输出缺少字段: {field_name}")
        if not isinstance(payload[field_name], field_type):
            raise TypeError(
                f"CLI 字段类型错误: {field_name}, 期望 {field_type.__name__}, 实际 {type(payload[field_name]).__name__}"
            )

    if payload["content_type"] not in {"article", "video", "github"}:
        raise ValueError(f"未知 content_type: {payload['content_type']}")
    if payload["status"] not in {"generated", "failed"}:
        raise ValueError(f"未知 status: {payload['status']}")
    if not payload["path"].strip():
        raise ValueError("CLI 输出 path 不能为空")
    if not payload["generation_payload"]:
        raise ValueError("CLI 输出 generation_payload 不能为空")
    if not payload["report"].strip():
        raise ValueError("终态 report 不能为空")
    if not payload["report_blocks"]:
        raise ValueError("终态 report_blocks 不能为空")
    if not payload["report_payload"].get("blocks"):
        raise ValueError("终态 report_payload.blocks 不能为空")
    if payload["status"] == "generated" and not payload["tldr"].strip():
        raise ValueError("generated 状态下 tldr 不能为空")

    return payload
