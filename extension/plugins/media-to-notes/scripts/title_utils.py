"""
标题提取与清洗
"""

import re
from typing import Optional


BAD_TITLES = {
    "",
    "未命名",
    "article",
    "Article",
    "文章",
    "网页",
    "document",
    "Document",
}


def clean_title(title: str) -> str:
    """清洗标题文本。"""
    value = _strip_html(title or "")
    value = re.sub(r"\s+", " ", value).strip()
    value = value.strip("-_| ")
    return value


def is_bad_title(title: str) -> bool:
    """判断标题是否不可用。"""
    value = clean_title(title)
    if value in BAD_TITLES:
        return True
    if len(value) < 3:
        return True
    return False


def pick_best_title(*candidates: Optional[str]) -> str:
    """从多个候选中选最合适的标题。"""
    for candidate in candidates:
        value = clean_title(candidate or "")
        if not is_bad_title(value):
            return value
    return "未命名内容"


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("&nbsp;", " ").replace("&amp;", "&").strip()
