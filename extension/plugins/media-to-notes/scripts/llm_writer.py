"""
可选的 LLM 笔记写作器。
"""

import json
import re
from typing import Any

import requests

from config import config
from models import AnalysisResult, ContentAsset


INTENT_LABELS = {
    "product_analysis": "产品分析",
    "tech_news": "技术新闻",
    "paper": "论文研究",
    "discussion": "现象讨论",
}


def rewrite_analysis_with_llm(asset: ContentAsset, draft: AnalysisResult) -> AnalysisResult | None:
    """使用可选的 LLM 将规则草稿重写为更像人工整理的笔记。"""
    if not config.llm.enabled or not config.llm.api_key:
        return None

    prompt = _build_prompt(asset, draft)
    payload = {
        "model": config.llm.model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": prompt},
        ],
    }

    try:
        response = requests.post(
            f"{config.llm.base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {config.llm.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=config.llm.timeout,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        parsed = _load_json_object(content)
        return _normalize_result(parsed, fallback=draft)
    except Exception:
        return None


def _system_prompt() -> str:
    return (
        "你是资深研究助理。你的任务不是摘要原文，而是把链接内容重写成可沉淀的知识笔记。"
        "必须去掉推文和自媒体的营销味，判断用户发这条内容是为了什么，再围绕那个目的重写。"
        "输出必须是 JSON 对象本身，不要额外解释，不要 Markdown 代码块，不要前后缀。"
    )


def _build_prompt(asset: ContentAsset, draft: AnalysisResult) -> str:
    source_text = (asset.transcript or asset.body_markdown).strip()
    source_text = source_text[: config.llm.max_input_chars]
    draft_json = {
        "intent": draft.intent,
        "intent_label": draft.intent_label,
        "tldr_lines": draft.key_points,
        "sections": draft.sections,
    }
    return (
        "请根据以下内容重写知识笔记。\n\n"
        "要求：\n"
        "1. 先判断用户转发这条内容的真正目的：产品分析 / 技术新闻 / 论文研究 / 现象讨论。\n"
        "2. 去掉营销味、话术和平台包装，只保留真正有信息密度的事实与判断。\n"
        "3. TL;DR 输出 2-3 条，每条一句话，像研究助理写给团队看的结论，不要贴链接。\n"
        "4. detailed_sections 要按意图重组，不要照抄原文结构；每个 section 2-3 条 bullet。\n"
        "5. bullet 必须是消化后的判断或事实，不要出现“欢迎关注”“点击查看”之类话术。\n"
        "6. 如果信息不完整，允许保留一节“需要确认”或“后续观察”。\n"
        "7. 不要输出 Markdown，只输出 JSON。\n\n"
        "错误示例：先解释再给 JSON。\n"
        "正确示例：\n"
        "{\"intent\":\"product_analysis\",\"intent_label\":\"产品分析\",\"tldr_lines\":[\"示例结论一。\",\"示例结论二。\"],\"detailed_sections\":[{\"title\":\"这是什么\",\"bullets\":[\"示例要点一。\",\"示例要点二。\"]}]}\n\n"
        "JSON schema:\n"
        "{\n"
        '  "intent": "product_analysis|tech_news|paper|discussion",\n'
        '  "intent_label": "中文标签",\n'
        '  "tldr_lines": ["...", "..."],\n'
        '  "detailed_sections": [\n'
        '    {"title": "...", "bullets": ["...", "..."]}\n'
        "  ]\n"
        "}\n\n"
        f"基础信息：\n标题：{asset.title}\n"
        f"平台：{asset.source_platform}\n"
        f"内容类型：{asset.content_type}\n"
        f"链接：{asset.resolved_url}\n\n"
        f"规则草稿（仅供参考，可重写）：\n{json.dumps(draft_json, ensure_ascii=False)}\n\n"
        f"原始内容：\n{source_text}\n"
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


def _normalize_result(payload: dict[str, Any], fallback: AnalysisResult) -> AnalysisResult:
    intent = str(payload.get("intent") or fallback.intent).strip()
    if intent not in INTENT_LABELS:
        intent = fallback.intent

    tldr_lines = [
        _clean_line(item)
        for item in payload.get("tldr_lines", [])
        if _clean_line(item)
    ][:3]
    if not tldr_lines:
        tldr_lines = fallback.key_points[:3]

    sections = []
    for item in payload.get("detailed_sections", []):
        title = _clean_line(item.get("title", ""))
        bullets = [_clean_line(bullet) for bullet in item.get("bullets", []) if _clean_line(bullet)]
        if title and bullets:
            sections.append({"title": title, "bullets": bullets[:3]})
    if not sections:
        sections = fallback.sections

    return AnalysisResult(
        tldr=tldr_lines[0],
        key_points=tldr_lines,
        why_it_matters="",
        sections=sections[:4],
        intent=intent,
        intent_label=str(payload.get("intent_label") or INTENT_LABELS.get(intent, fallback.intent_label)).strip(),
    )


def _clean_line(value: Any) -> str:
    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"https?://\S+", "", text)
    text = text.strip(" -•\t，,；;。")
    if len(text) < 4:
        return ""
    return text + ("。" if text[-1] not in "。！？!?" else "")
