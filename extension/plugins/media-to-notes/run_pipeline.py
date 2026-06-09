#!/usr/bin/env python3
"""
内部/调试入口包装器。
"""

import json
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from cli_contract import validate_cli_payload
from config import config
from delivery import load_delivery_context
from pipeline import run_link_pipeline


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法: python run_pipeline.py <url> [output_dir]")

    url = sys.argv[1]
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else config.output.base_dir
    delivery_context = load_delivery_context()
    _guard_direct_pipeline_usage(delivery_context)

    result = run_link_pipeline(
        url=url,
        output_dir=output_dir,
        download_images=True,
        delivery_context=delivery_context,
    )

    payload = validate_cli_payload({
        "success": result.status != "failed",
        "status": result.status,
        "path": str(result.note_path),
        "title": result.asset.title,
        "url": result.asset.resolved_url,
        "content_type": result.asset.content_type,
        "tldr": result.analysis.tldr,
        "word_count": result.extra["word_count"],
        "images_count": result.extra["images_count"],
        "fetcher_type": result.extra["fetcher_type"],
        "warnings": result.extra.get("warnings", []),
        "image_status": result.extra.get("image_status", ""),
        "report": result.report_content,
        "enrichment_summary": result.enrichment.summary,
        "related_resources": [
            {
                "title": item.title,
                "url": item.url,
                "category": item.category,
                "source": item.source,
                "note": item.note,
            }
            for item in result.enrichment.resources
        ],
        "generation_payload": result.generation_payload,
        "report_blocks": result.report_blocks,
        "report_payload": {
            "text": result.report_content,
            "blocks": result.report_blocks,
            "delivery": delivery_context,
        },
    })
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _guard_direct_pipeline_usage(delivery_context: dict) -> None:
    has_delivery_target = bool(str(delivery_context.get("channel", "")).strip())
    if not has_delivery_target:
        return
    if os.getenv("WEB_FETCH_INTERNAL_CALL", "").strip() == "1":
        return
    raise SystemExit(
        "检测到 Slack delivery context。`run_pipeline.py` 是内部/调试入口，"
        "带投递上下文时必须改用 `python run_and_send.py <url>`。"
    )


if __name__ == "__main__":
    main()
