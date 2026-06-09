"""
遗留兼容模块。

当前 web-fetch 已改为 pipeline 自己产出终态结果，
不再允许上层通过 finalizer 回填内容。
"""

import json
from pathlib import Path
from typing import Any

from cli_contract import validate_cli_payload


def finalize_generated_output(
    prepared_payload: dict[str, Any],
    note_content: str,
    report_text: str,
    report_blocks: list[dict],
) -> dict[str, Any]:
    """禁止旧回填路径继续生效。"""
    raise RuntimeError("finalizer.py 已废弃：web-fetch 现在由 pipeline 直接生成终态内容")
    note_path = Path(prepared_payload["path"])
    note_path.parent.mkdir(parents=True, exist_ok=True)
    note_path.write_text(note_content, encoding="utf-8", newline="\n")

    final_payload = dict(prepared_payload)
    final_payload["status"] = "generated"
    final_payload["report"] = report_text
    final_payload["report_blocks"] = report_blocks
    final_report_payload = dict(prepared_payload.get("report_payload", {}))
    final_report_payload.update({
        "text": report_text,
        "blocks": report_blocks,
    })
    final_payload["report_payload"] = final_report_payload
    final_payload["note_content"] = note_content
    final_payload.setdefault("warnings", prepared_payload.get("warnings", []))
    final_payload.setdefault("image_status", prepared_payload.get("image_status", ""))

    tldr_lines = _extract_tldr_lines(note_content)
    final_payload["tldr"] = tldr_lines[0] if tldr_lines else ""

    return validate_cli_payload(final_payload)


def _extract_tldr_lines(note_content: str) -> list[str]:
    lines = []
    capture = False
    for raw_line in note_content.splitlines():
        line = raw_line.rstrip()
        if line.strip() == "> **TL;DR**:":
            capture = True
            continue
        if capture:
            if not line.startswith(">"):
                break
            stripped = line.lstrip("> ").strip()
            if stripped.startswith("- "):
                lines.append(stripped[2:].strip())
    return lines


def dump_final_payload(payload: dict[str, Any]) -> str:
    """输出 JSON 字符串。"""
    return json.dumps(payload, ensure_ascii=False, indent=2)
