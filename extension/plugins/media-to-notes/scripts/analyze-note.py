#!/usr/bin/env python3
"""
独立 CLI 分析工具 - 从 stdin 读取 Markdown，通过规则引擎分析后输出 JSON 到 stdout。

用法:
    echo "# My Article\n..." | python3 analyze-note.py --title "标题" --content-type article --source-url https://example.com

输出:
    JSON {intent, intent_label, tldr, key_points, sections:[{title, bullets}]}
"""

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List


# ---------------------------------------------------------------------------
# 数据结构（内联，不依赖 models.py）
# ---------------------------------------------------------------------------

@dataclass
class AnalysisResult:
    """分析结果。"""
    tldr: str
    key_points: List[str]
    why_it_matters: str
    sections: List[Dict[str, Any]] = field(default_factory=list)
    intent: str = "tech_news"
    intent_label: str = "技术新闻"


# ---------------------------------------------------------------------------
# 常量 - 规则引擎
# ---------------------------------------------------------------------------

INTENT_LABELS = {
    "product_analysis": "产品分析",
    "tech_news": "技术新闻",
    "paper": "论文研究",
    "discussion": "现象讨论",
    "video_analysis": "视频解析",
}

INTENT_SECTION_SPECS = {
    "product_analysis": [
        ("这是什么", ["产品", "平台", "工具", "方案", "服务", "应用", "接入", "推出", "用于"]),
        ("核心能力", ["支持", "实现", "自动", "集成", "生成", "处理", "协作", "工作流", "模型", "接口"]),
        ("适用场景", ["场景", "用户", "开发者", "企业", "业务", "效率", "成本", "批量", "运营"]),
        ("需要确认", ["限制", "风险", "仍然", "暂未", "后续", "计划", "依赖", "问题"]),
    ],
    "tech_news": [
        ("发生了什么", ["发布", "上线", "推出", "宣布", "更新", "开源", "接入"]),
        ("核心变化", ["支持", "新增", "集成", "升级", "改进", "能力", "模型", "功能"]),
        ("行业意义", ["影响", "竞争", "生态", "行业", "市场", "效率", "成本"]),
        ("后续观察", ["接下来", "后续", "观察", "验证", "落地", "采用", "风险"]),
    ],
    "paper": [
        ("研究问题", ["问题", "挑战", "目标", "任务", "背景", "研究"]),
        ("方法与创新", ["方法", "框架", "架构", "算法", "训练", "推理", "提出"]),
        ("实验与结果", ["实验", "结果", "基准", "benchmark", "指标", "提升", "降低", "数据集"]),
        ("局限与启发", ["局限", "限制", "未来", "启发", "适用", "代价"]),
    ],
    "discussion": [
        ("讨论焦点", ["讨论", "观点", "现象", "争议", "趋势", "问题"]),
        ("主要判断", ["认为", "本质", "说明", "意味着", "反映", "提示"]),
        ("涉及主体", ["产品", "公司", "团队", "平台", "模型", "生态"]),
        ("后续跟进", ["观察", "验证", "后续", "落地", "信号", "动作"]),
    ],
}

HOOK_PATTERNS = [
    "欢迎",
    "点击",
    "关注",
    "点赞",
    "转发",
    "订阅",
    "你用上了吗",
    "一起看看",
    "太棒了",
    "赶紧",
    "respect",
]

WEAK_LEADING_PATTERNS = [
    "支持",
    "提供",
    "处理",
    "实现",
    "包括",
    "例如",
    "比如",
    "其中",
    "以及",
    "并且",
    "也",
    "还",
    "对中文的支持",
]


# ---------------------------------------------------------------------------
# 平台推断
# ---------------------------------------------------------------------------

def _infer_source_platform(url: str) -> str:
    """从 URL 推断来源平台。"""
    url_lower = url.lower()
    if "github.com" in url_lower:
        return "GitHub"
    if "youtube.com" in url_lower or "youtu.be" in url_lower:
        return "YouTube"
    if "bilibili.com" in url_lower:
        return "Bilibili"
    if "twitter.com" in url_lower or "x.com" in url_lower:
        return "Twitter"
    if "mp.weixin.qq.com" in url_lower:
        return "WeChat"
    if "zhihu.com" in url_lower:
        return "知乎"
    if "juejin.cn" in url_lower:
        return "掘金"
    if "sspai.com" in url_lower:
        return "少数派"
    if "medium.com" in url_lower:
        return "Medium"
    if "arxiv.org" in url_lower:
        return "arXiv"
    # 兜底：取域名
    match = re.search(r"://([^/]+)", url_lower)
    if match:
        return match.group(1)
    return "unknown"


# ---------------------------------------------------------------------------
# Markdown -> 纯文本
# ---------------------------------------------------------------------------

def _markdown_to_text(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r'!\[\[(.*?)\]\]', ' ', text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^[#>\-\*\s]+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\|", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ---------------------------------------------------------------------------
# 句子处理
# ---------------------------------------------------------------------------

def _split_sentences(text: str) -> list[str]:
    raw_sentences = re.split(r"(?<=[。！？!?\.])\s+|\n+", text)
    results = []
    for item in raw_sentences:
        normalized = _normalize_sentence(item)
        if len(normalized) >= 12:
            results.append(normalized)
    return results


def _normalize_sentence(sentence: str) -> str:
    sentence = sentence.strip(" -•\t")
    sentence = re.sub(r"\s+", " ", sentence)
    sentence = re.sub(r"https?://\S+", "", sentence)
    sentence = re.sub(r"^(原标题|原文|来源|作者|编辑)[:：]\s*", "", sentence)
    sentence = re.sub(r"^(官网|GitHub|Github|文档|Docs)[:：]\s*", "", sentence, flags=re.IGNORECASE)
    sentence = re.sub(r"(关注我们|欢迎留言|欢迎交流|点赞收藏转发).*?$", "", sentence, flags=re.IGNORECASE)
    sentence = sentence.replace("我们认为", "文中认为")
    sentence = sentence.replace("我们看到", "文中提到")
    sentence = sentence.replace("你可以", "可")
    sentence = sentence.replace("大家可以", "可")
    sentence = re.sub(r"^(其实|另外|同时|此外|总之|所以|但是|不过)[，,\s]*", "", sentence)
    return sentence.strip("，,；;。 ")


# ---------------------------------------------------------------------------
# 意图检测
# ---------------------------------------------------------------------------

def _detect_intent(title: str, content_type: str, source_url: str, plain_text: str, sentences: list[str]) -> str:
    combined = " ".join([title, plain_text[:5000], " ".join(sentences[:8])]).lower()
    if _looks_like_paper(source_url, combined):
        return "paper"

    scores = {
        "product_analysis": 0,
        "tech_news": 0,
        "discussion": 0,
    }

    for token in ["产品", "平台", "工具", "服务", "应用", "github", "官网", "文档", "定价", "工作流"]:
        if token in combined:
            scores["product_analysis"] += 2
    for token in ["发布", "上线", "推出", "宣布", "更新", "开源", "接入", "融资", "新闻", "快讯"]:
        if token in combined:
            scores["tech_news"] += 2
    for token in ["讨论", "观点", "争议", "趋势", "现象", "为什么", "看法", "thread", "舆情"]:
        if token in combined:
            scores["discussion"] += 2

    if content_type == "video":
        scores["product_analysis"] += 1
    if content_type == "github":
        scores["product_analysis"] += 2
    if any("github.com" in sentence.lower() for sentence in sentences[:6]):
        scores["product_analysis"] += 2

    best_intent = max(scores, key=scores.get)
    if scores[best_intent] <= 1:
        return "tech_news"
    return best_intent


def _looks_like_paper(source_url: str, combined: str) -> bool:
    if "arxiv.org" in combined or "doi.org" in combined:
        return True
    if any(token in combined for token in ["论文", "paper", "abstract", "benchmark", "dataset", "实验设置"]):
        return True
    return "arxiv" in source_url.lower()


# ---------------------------------------------------------------------------
# 句子打分与排序
# ---------------------------------------------------------------------------

def _rank_sentences(sentences: list[str], intent: str) -> list[str]:
    scored = []
    for idx, sentence in enumerate(sentences):
        if _is_noise_sentence(sentence):
            continue
        score = 0
        if re.search(r"\d", sentence):
            score += 2
        if 18 <= len(sentence) <= 88:
            score += 2
        if _looks_like_complete_fact(sentence):
            score += 3
        else:
            score -= 4
        if any(token in sentence for token in ["支持", "发布", "推出", "实现", "降低", "提升", "集成", "开源", "实验", "结果", "问题"]):
            score += 2
        if intent == "product_analysis" and any(token in sentence for token in ["产品", "平台", "工作流", "团队", "开发者", "企业"]):
            score += 2
        if intent == "tech_news" and any(token in sentence for token in ["发布", "上线", "宣布", "更新", "接入"]):
            score += 2
        if intent == "paper" and any(token in sentence.lower() for token in ["benchmark", "dataset", "method", "experiment"]):
            score += 3
        if intent == "discussion" and any(token in sentence for token in ["趋势", "现象", "争议", "本质", "意味着"]):
            score += 2
        if sentence.endswith(("？", "?")):
            score -= 3
        scored.append((score, idx, sentence))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in scored]


# ---------------------------------------------------------------------------
# Section 构建
# ---------------------------------------------------------------------------

def _build_intent_sections(title: str, source_platform: str, ranked_sentences: list[str], intent: str) -> list[dict]:
    specs = INTENT_SECTION_SPECS[intent]
    sections = []
    subject = _pick_subject(title, source_platform, ranked_sentences)
    strict_titles = {"需要确认", "后续观察", "局限与启发", "后续跟进"}

    for section_title, keywords in specs:
        candidates = _select_sentences(ranked_sentences, keywords, limit=5)
        if section_title in strict_titles and not _has_keyword_match(candidates, keywords):
            candidates = []
        bullets = _compose_bullets(subject, candidates, section_title, intent)
        if bullets:
            sections.append({"title": section_title, "bullets": bullets})

    if not sections:
        fallback_bullets = _compose_bullets(subject, ranked_sentences[:3], "核心内容", intent)
        if fallback_bullets:
            sections.append({"title": "核心内容", "bullets": fallback_bullets})

    return sections[:6]


def _pick_subject(title: str, source_platform: str, ranked_sentences: list[str]) -> str:
    cleaned = re.sub(r"[|｜\-—:：].*$", "", title).strip()
    cleaned = re.sub(r'[\u300a\u300b\u201c\u201d"\']', '', cleaned)
    cleaned = re.sub(r"https?://\S+", "", cleaned)
    if 2 <= len(cleaned) <= 40 and not cleaned.lower().startswith("http"):
        return cleaned
    for sentence in ranked_sentences[:5]:
        match = re.search(r"\b([A-Z][A-Za-z0-9]+(?:[ \-][A-Z][A-Za-z0-9]+){0,3})\b", sentence)
        if match:
            return match.group(1)
    return source_platform


def _select_sentences(
    ranked_sentences: list[str],
    keywords: Iterable[str],
    limit: int = 5,
) -> list[str]:
    scored_matches = []
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for idx, sentence in enumerate(ranked_sentences):
        hits = sum(1 for keyword in lowered_keywords if keyword in sentence.lower())
        if hits > 0:
            scored_matches.append((hits, idx, sentence))
    if scored_matches:
        scored_matches.sort(key=lambda item: (-item[0], item[1]))
        return [item[2] for item in scored_matches[:limit]]

    matches = []
    for sentence in ranked_sentences:
        matches.append(sentence)
        if len(matches) == limit:
            break
    return matches


def _has_keyword_match(sentences: list[str], keywords: Iterable[str]) -> bool:
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for sentence in sentences:
        if any(keyword in sentence.lower() for keyword in lowered_keywords):
            return True
    return False


# ---------------------------------------------------------------------------
# Bullet 生成
# ---------------------------------------------------------------------------

def _compose_bullets(subject: str, sentences: list[str], section_title: str, intent: str) -> list[str]:
    clauses = []
    for sentence in sentences:
        clauses.extend(_extract_clauses(sentence))

    unique_clauses = []
    seen = set()
    for clause in clauses:
        key = clause.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_clauses.append(clause)

    if not unique_clauses:
        return _fallback_section_bullets(subject, section_title, intent)

    bullets = []
    primary = unique_clauses[0]
    bullets.append(_render_section_bullet(subject, section_title, primary, primary=True))
    if len(unique_clauses) > 1:
        merged = "；".join(unique_clauses[1:3])
        bullets.append(_render_section_bullet(subject, section_title, merged, primary=False))
    return bullets[:4]


def _extract_clauses(sentence: str) -> list[str]:
    parts = re.split(r"[，；：:]", sentence)
    clauses = []
    for part in parts:
        cleaned = _compress_sentence(part)
        if "http" in cleaned.lower():
            continue
        if _is_fragment_clause(cleaned):
            continue
        if 8 <= len(cleaned) <= 80:
            clauses.append(cleaned)
    if not clauses:
        fallback = _compress_sentence(sentence)
        if fallback and not _is_fragment_clause(fallback) and _looks_like_complete_fact(fallback):
            clauses.append(fallback)
    return clauses[:3]


def _compress_sentence(sentence: str) -> str:
    sentence = _normalize_sentence(sentence)
    sentence = re.sub(r"^(文中提到|文中认为|作者认为|作者提到)", "", sentence)
    sentence = re.sub(r"(这意味着|这说明|可以看到)", "", sentence)
    sentence = re.sub(r"(非常|尤其|明显|确实|已经|正在)", "", sentence)
    sentence = re.sub(r"\b([A-Za-z][A-Za-z0-9_-]*)\s+\1\b", r"\1", sentence)
    sentence = re.sub(r"\s+", " ", sentence)
    return sentence.strip("，,；;。 ")


def _looks_like_complete_fact(sentence: str) -> bool:
    normalized = sentence.strip()
    if len(normalized) < 14:
        return False
    if re.search(r"https?://|www\.|\.svg|xmlns", normalized, flags=re.IGNORECASE):
        return False
    if normalized.endswith((":", "：", "、", "/", "-", "—")):
        return False
    if re.match(r"^(支持|提供|处理|实现|包括|例如|比如|其中|以及|并且|对于|关于|由于|如果)", normalized):
        return False
    if any(pattern in normalized for pattern in WEAK_LEADING_PATTERNS) and len(normalized) < 24:
        return False
    if not re.search(r"[，。；]|是|为|把|将|让|可|能|用于|面向|通过|成为|意味着", normalized):
        return False
    return True


def _is_fragment_clause(clause: str) -> bool:
    if not clause:
        return True
    if re.search(r"https?://|www\.|\.svg|xmlns", clause, flags=re.IGNORECASE):
        return True
    if re.match(r"^(支持|提供|处理|实现|包括|例如|比如|其中|以及|并且|对中文的支持)", clause):
        return True
    if len(clause) < 10:
        return True
    return False


def _render_section_bullet(subject: str, section_title: str, clause: str, primary: bool) -> str:
    if section_title == "这是什么":
        if clause.startswith(subject):
            return f"{clause}。"
        return f"{subject} 的核心定位是 {clause}。"
    if section_title == "核心能力":
        return f"核心能力集中在 {clause}。"
    if section_title == "适用场景":
        return f"更适合的落地场景是 {clause}。"
    if section_title == "需要确认":
        return f"仍需继续确认 {clause}。"
    if section_title == "发生了什么":
        return f"本次动态的核心事件是 {clause}。"
    if section_title == "核心变化":
        return f"真正值得记住的变化是 {clause}。"
    if section_title == "行业意义":
        return f"对行业更有意义的信号是 {clause}。"
    if section_title == "后续观察":
        return f"后续应持续观察 {clause}。"
    if section_title == "研究问题":
        return f"论文要解决的核心问题是 {clause}。"
    if section_title == "方法与创新":
        return f"方法上的关键设计是 {clause}。"
    if section_title == "实验与结果":
        return f"实验真正说明了 {clause}。"
    if section_title == "局限与启发":
        return f"需要带着保留意见看待 {clause}。"
    if section_title == "讨论焦点":
        return f"这轮讨论真正围绕的是 {clause}。"
    if section_title == "主要判断":
        return f"可沉淀下来的判断是 {clause}。"
    if section_title == "涉及主体":
        return f"被卷入这件事的主体主要包括 {clause}。"
    if section_title == "后续跟进":
        return f"后续跟进时优先看 {clause}。"
    if primary:
        return f"{subject} 的关键信息是 {clause}。"
    return f"还需要结合 {clause} 一起理解。"


def _fallback_section_bullets(subject: str, section_title: str, intent: str) -> list[str]:
    fallback_map = {
        "product_analysis": {
            "需要确认": [f"仍需补充 {subject} 的真实使用门槛、定价与可复制性。"]},
        "tech_news": {
            "后续观察": [f"后续重点观察 {subject} 是否从发布走向真实采用。"]},
        "paper": {
            "局限与启发": [f"需要进一步确认 {subject} 的实验边界、代价和泛化能力。"]},
        "discussion": {
            "后续跟进": [f"后续应验证这轮讨论是否会沉淀成真实产品动作或行业变化。"]},
    }
    return fallback_map.get(intent, {}).get(section_title, [])


# ---------------------------------------------------------------------------
# 噪音过滤
# ---------------------------------------------------------------------------

def _is_noise_sentence(sentence: str) -> bool:
    lowered = sentence.lower()
    if sentence.endswith(("？", "?")):
        return True
    if not re.search(r"[\u4e00-\u9fffA-Za-z]", sentence):
        return True
    if re.search(r"https?://|www\.|\.svg|xmlns|xlink", sentence, flags=re.IGNORECASE):
        return True
    if sentence.count("/") >= 2 and len(sentence) < 50:
        return True
    if any(pattern in lowered for pattern in HOOK_PATTERNS):
        return True
    return bool(re.match(r"^(原标题|来源|作者|编辑|点击|扫码)", sentence))


# ---------------------------------------------------------------------------
# 主分析函数
# ---------------------------------------------------------------------------

def _extract_video_sections(text: str) -> tuple[str, list[str], list[str]]:
    """从视频 Gemini 分析输出中提取已有结构。

    Gemini 输出已经有清晰的标题和要点，直接提取而不是用规则引擎重组。
    返回: (tldr_text, key_points, section_bullets)
    """
    key_points: list[str] = []
    all_bullets: list[str] = []

    # 提取第一个段落作为 TL;DR 来源
    lines = text.splitlines()
    tldr_candidates = []

    for line in lines:
        stripped = line.strip()
        # 跳过标题行、空行、元数据
        if not stripped or stripped.startswith("#") or stripped.startswith(">"):
            continue
        # 跳过分隔线
        if stripped in ("---", "***", "___"):
            continue
        # 找到第一个有意义的句子/要点
        if stripped.startswith("- ") or stripped.startswith("* "):
            bullet = stripped[2:].strip()
            # 清理 markdown 粗体标记
            bullet = re.sub(r"^\*\*\s*", "", bullet)
            bullet = re.sub(r"\s*\*\*$", "", bullet)
            bullet = re.sub(r"^\*\*\s*", "", bullet)
            if len(bullet) >= 10 and len(bullet) <= 120:
                tldr_candidates.append(bullet)
        elif len(stripped) >= 15 and len(stripped) <= 120 and not stripped.startswith("|"):
            tldr_candidates.append(stripped)

        if len(tldr_candidates) >= 5:
            break

    # 从各节提取关键要点
    current_section = ""
    section_bullet_map: dict[str, list[str]] = {}

    for line in lines:
        stripped = line.strip()

        # 检测 section 标题
        heading_match = re.match(r"^#{1,3}\s+(.+)", stripped)
        if heading_match:
            title_text = heading_match.group(1).strip()
            # 跳过元数据标题
            if title_text in ("视频元数据", "视频解析", "视觉解析", "音频转写", "综合理解"):
                current_section = ""
                continue
            current_section = title_text
            if current_section not in section_bullet_map:
                section_bullet_map[current_section] = []
            continue

        # 提取要点
        if current_section and (stripped.startswith("- ") or stripped.startswith("* ")):
            bullet = stripped[2:].strip()
            # 清理 markdown 标记
            bullet = re.sub(r"^\*\*(.+?)\*\*\s*[：:]*\s*", r"\1：", bullet)
            if len(bullet) >= 8 and len(bullet) <= 150:
                section_bullet_map.setdefault(current_section, []).append(bullet)

    # 构建关键要点（从各个 section 中取最有价值的）
    for section_name, bullets in section_bullet_map.items():
        for bullet in bullets[:2]:
            cleaned = _normalize_sentence(bullet)
            if cleaned and len(cleaned) >= 10 and cleaned not in key_points:
                key_points.append(cleaned)
                all_bullets.append(bullet)
            if len(key_points) >= 10:
                break
        if len(key_points) >= 10:
            break

    # TL;DR 文本
    tldr_text = ""
    if tldr_candidates:
        tldr_text = tldr_candidates[0]

    return tldr_text, key_points[:5], all_bullets


def _build_video_sections(title: str, source_platform: str, all_bullets: list[str]) -> list[dict]:
    """从 Gemini 视频分析输出构建笔记 sections。"""
    sections = []

    if not all_bullets:
        return sections

    # 把 bullets 分成几个自然段
    chunk_size = max(3, len(all_bullets) // 4)
    section_titles = ["视频概览", "关键内容", "细节补充", "值得注意"]

    for i, section_title in enumerate(section_titles):
        start = i * chunk_size
        end = start + chunk_size
        bullets = all_bullets[start:end]
        if bullets:
            sections.append({"title": section_title, "bullets": bullets[:5]})

    return sections[:4]


def analyze(title: str, content_type: str, source_url: str, text: str) -> AnalysisResult:
    """
    规则引擎分析入口。

    参数:
        title: 内容标题
        content_type: article | video | github
        source_url: 来源 URL
        text: Markdown 原文（从 stdin 读取）

    返回:
        AnalysisResult
    """
    # 视频内容使用专用提取路径（保留 Gemini 已有结构）
    if content_type == "video":
        tldr_text, key_points, all_bullets = _extract_video_sections(text)
        source_platform = _infer_source_platform(source_url)
        section_facts = _build_video_sections(title, source_platform, all_bullets)

        if not tldr_text and key_points:
            tldr_text = key_points[0]

        return AnalysisResult(
            tldr=tldr_text,
            key_points=key_points,
            why_it_matters=tldr_text,
            sections=section_facts,
            intent="video_analysis",
            intent_label=INTENT_LABELS.get("video_analysis", "视频解析"),
        )

    # 文本内容使用规则引擎
    plain_text = _markdown_to_text(text)
    sentences = _split_sentences(plain_text)
    intent = _detect_intent(title, content_type, source_url, plain_text, sentences)
    ranked_sentences = _rank_sentences(sentences, intent)
    source_platform = _infer_source_platform(source_url)
    section_facts = _build_intent_sections(title, source_platform, ranked_sentences, intent)

    return AnalysisResult(
        tldr="",
        key_points=[],
        why_it_matters="",
        sections=section_facts,
        intent=intent,
        intent_label=INTENT_LABELS.get(intent, "链接解析"),
    )


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import json

    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="从 stdin 读取 Markdown，通过规则引擎分析后输出 JSON 到 stdout。",
    )
    parser.add_argument(
        "--title",
        required=True,
        help="内容标题",
    )
    parser.add_argument(
        "--content-type",
        required=True,
        choices=["article", "video", "github"],
        help="内容类型: article | video | github",
    )
    parser.add_argument(
        "--source-url",
        required=True,
        help="来源 URL",
    )

    args = parser.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        print("错误: stdin 为空，请通过管道传入 Markdown 文本。", file=sys.stderr)
        sys.exit(1)

    try:
        result = analyze(args.title, args.content_type, args.source_url, text)
    except Exception as exc:
        print(f"分析失败: {exc}", file=sys.stderr)
        sys.exit(1)

    output = {
        "intent": result.intent,
        "intent_label": result.intent_label,
        "tldr": result.tldr,
        "key_points": result.key_points,
        "sections": result.sections,
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    print()  # 末尾换行
