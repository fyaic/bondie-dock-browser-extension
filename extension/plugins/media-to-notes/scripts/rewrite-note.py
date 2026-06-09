#!/usr/bin/env python3
"""
独立 CLI 工具：从 stdin 读取分析结果 JSON，通过 LLM 重写后输出到 stdout。

用法：
    analyze-note.py ... | python3 rewrite-note.py --source-file /path/to/original.md \
        --title "标题" --content-type article --platform weixin --source-url https://...

stdin:  分析结果 JSON（来自 analyze-note.py 的输出）
stdout: 重写后的 JSON（同输入格式）
stderr: 错误 / HANDOFF 信息
"""

import json
import re
from typing import Any

import requests

INTENT_LABELS = {
    "product_analysis": "产品分析",
    "tech_news": "技术新闻",
    "paper": "论文研究",
    "discussion": "现象讨论",
}


def rewrite(input_json: dict, source_text: str, args) -> dict | None:
    """使用 LLM 将规则草稿重写为更像人工整理的笔记。返回重写后的 dict 或 None。"""
    try:
        from config import llm_config
    except ImportError:
        return None

    api_key = args.api_key or llm_config.api_key
    base_url = args.base_url or llm_config.base_url
    model = args.model or llm_config.model

    if not api_key:
        return None

    prompt = _build_prompt(source_text, input_json, args, max_input_chars=llm_config.max_input_chars)
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": prompt},
        ],
    }

    try:
        response = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=llm_config.timeout,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        parsed = _load_json_object(content)
        return _normalize_result(parsed, fallback=input_json)
    except Exception:
        return None


def _system_prompt() -> str:
    return (
        "你是资深研究助理。你的任务是把原始内容完整解析、重组为结构化的知识笔记——不是摘要，不是压缩，而是完整的知识沉淀。"
        "必须去掉推文和自媒体的营销味，判断用户发这条内容是为了什么，再围绕那个目的组织笔记。"
        "核心原则：保留原文所有有价值的事实、数据、产品名称、技术细节、具体判断。宁可多留细节，也不要把几千字压成几句空话。"
        "你的目标是让读者只看笔记就能获得原文的全部关键信息，不需要再回去看原文。"
        "你必须输出一个 content_markdown 字段，这是一篇完整的 Markdown 格式知识笔记，包含多级标题、段落、列表，覆盖原文所有重要信息。"
        "输出必须是 JSON 对象本身，不要额外解释，不要 Markdown 代码块包裹整个 JSON，不要前后缀。"
    )


def _build_prompt(source_text: str, draft_json: dict, args, *, max_input_chars: int = 20000) -> str:
    source_text = source_text.strip()[:max_input_chars]
    return (
        "请根据以下原始内容解析生成知识笔记。注意：这是知识沉淀，不是摘要压缩。\n\n"
        "要求：\n"
        "1. 先判断用户转发这条内容的真正目的：产品分析 / 技术新闻 / 论文研究 / 现象讨论。\n"
        "2. 去掉营销味、话术和平台包装，但保留所有有信息密度的事实与判断。\n"
        "3. TL;DR 输出 3-5 条，每条一句话概括核心结论。\n"
        "4. detailed_sections 按意图重组原文信息，每个 section 4-6 条 bullet。\n"
        "5. 每个 bullet 必须包含具体事实：产品名称、数据指标、技术方案、核心观点都要保留。不要写成空洞的概括。\n"
        "6. 原文提到的每个产品/工具/方案/功能点，都要有对应的 bullet。不要把多个不同事物合并成一条。\n"
        "7. 允许保留一节\"后续观察\"或\"需要确认\"记录不确定信息。\n"
        "8. **最重要**：content_markdown 字段输出一篇完整的 Markdown 格式知识笔记，用多级标题、段落、列表覆盖原文所有重要信息。这是主要交付物，必须详尽。detailed_sections 作为摘要补充。\n\n"
        "错误示例（过度压缩）：\"Impeccable 是一个设计工具。\"\n"
        "正确示例（保留细节）：\"Impeccable 提供 21 条设计指令（/typeset、/polish、/distill 等），通过 MCP Server 集成到 Cursor、Claude Code、Codex 等编辑器。\"\n\n"
        "JSON schema:\n"
        "{\n"
        '  "intent": "product_analysis|tech_news|paper|discussion",\n'
        '  "intent_label": "中文标签",\n'
        '  "tldr_lines": ["...", "..."],\n'
        '  "detailed_sections": [\n'
        '    {"title": "...", "bullets": ["...", "..."]}\n'
        '  ],\n'
        '  "content_markdown": "## 标题1\\n完整段落...\\n\\n## 标题2\\n- 要点1\\n- 要点2\\n..."\n'
        "}\n\n"
        f"基础信息：\n标题：{args.title}\n"
        f"平台：{args.platform}\n"
        f"内容类型：{args.content_type}\n"
        f"链接：{args.source_url}\n\n"
        f"规则草稿（仅供参考，可重写）：\n{json.dumps(draft_json, ensure_ascii=False)}\n\n"
        f"原始内容（以原文为准，完整解析）：\n{source_text}\n"
    )


def _load_json_object(content: str) -> dict[str, Any]:
    if isinstance(content, dict):
        return content
    text = content.strip()
    fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
    if fenced_match:
        text = fenced_match.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        object_match = re.search(r"(\{.*\})", text, flags=re.DOTALL)
        if not object_match:
            raise
        return json.loads(object_match.group(1))


def _normalize_result(payload: dict[str, Any], fallback: dict) -> dict:
    intent = str(payload.get("intent") or fallback.get("intent", "tech_news")).strip()
    if intent not in INTENT_LABELS:
        intent = fallback.get("intent", "tech_news")

    tldr_lines = [
        _clean_line(item)
        for item in payload.get("tldr_lines", [])
        if _clean_line(item)
    ][:5]
    if not tldr_lines:
        tldr_lines = [
            _clean_line(p) for p in fallback.get("key_points", [])
            if _clean_line(p)
        ][:3]

    # 完整 Markdown 正文（优先）
    content_markdown = payload.get("content_markdown", "").strip()

    sections = []
    for item in payload.get("detailed_sections", []):
        title = _clean_line(item.get("title", ""))
        bullets = [_clean_line(bullet) for bullet in item.get("bullets", []) if _clean_line(bullet)]
        if title and bullets:
            sections.append({"title": title, "bullets": bullets[:5]})
    if not sections:
        sections = fallback.get("sections", [])

    return {
        "intent": intent,
        "intent_label": str(
            payload.get("intent_label") or INTENT_LABELS.get(intent, fallback.get("intent_label", ""))
        ).strip(),
        "key_points": tldr_lines,
        "sections": sections[:6],
        "content_markdown": content_markdown,
    }


def _clean_line(value: Any) -> str:
    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"https?://\S+", "", text)
    text = text.strip(" -•\t，,；;。")
    if len(text) < 4:
        return ""
    return text + ("。" if text[-1] not in "。！？!?" else "")


if __name__ == "__main__":
    import argparse
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="LLM 重写分析结果笔记")
    parser.add_argument("--source-file", required=True, help="原始 Markdown 文件路径")
    parser.add_argument("--title", default="", help="内容标题")
    parser.add_argument("--content-type", default="article", help="内容类型")
    parser.add_argument("--platform", default="", help="来源平台")
    parser.add_argument("--source-url", default="", help="原始链接")
    parser.add_argument("--api-key", default="", help="LLM API Key（覆盖配置）")
    parser.add_argument("--base-url", default="", help="LLM API Base URL（覆盖配置）")
    parser.add_argument("--model", default="", help="LLM 模型名（覆盖配置）")
    args = parser.parse_args()

    # 读取 stdin JSON
    input_json = json.load(sys.stdin)

    # 检查 LLM 是否可用
    from config import llm_config

    if not llm_config.enabled and not args.api_key:
        print("HANDOFF: LLM_REWRITE_FALLBACK", file=sys.stderr)
        print("REASON: LLM API not configured", file=sys.stderr)
        json.dump(input_json, sys.stdout, ensure_ascii=False, indent=2)
        sys.exit(0)

    # 读取原始 Markdown
    source_text = Path(args.source_file).read_text(encoding="utf-8")

    # 调用 LLM 重写
    result = rewrite(input_json, source_text, args)

    if result is None:
        print("HANDOFF: LLM_REWRITE_FALLBACK", file=sys.stderr)
        json.dump(input_json, sys.stdout, ensure_ascii=False, indent=2)
        sys.exit(0)

    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
