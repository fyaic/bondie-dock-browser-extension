"""
Code-Agent 润色模块。

在笔记生成后、落盘前，调用外部 code-agent 对内容进行润色，
确保输出质量符合 Obsidian 知识库标准。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Literal

from config import config


def polish_note(
    note_content: str,
    source_url: str,
    agent_type: Literal["kimi", "claude", "custom"] | None = None,
) -> str:
    """
    调用 code-agent 润色笔记内容。

    Args:
        note_content: 原始生成的笔记内容
        source_url: 原始来源 URL（用于 context）
        agent_type: 指定 agent 类型，None 则自动从配置读取

    Returns:
        润色后的笔记内容（如果润色失败则返回原始内容）
    """
    agent = agent_type or os.getenv("WEB_FETCH_POLISH_AGENT", "kimi").lower()

    # 检查是否禁用润色
    if os.getenv("WEB_FETCH_DISABLE_POLISH", "").lower() in ("1", "true", "yes"):
        return note_content

    # 构建 fallback 链：主 agent 失败时依次尝试后续 agent
    fallback_chain = {
        "kimi": ["claude"],
        "claude": ["kimi"],
        "custom": [],
    }
    candidates = [agent] + fallback_chain.get(agent, [])

    for candidate in candidates:
        try:
            if candidate == "kimi":
                result = _polish_with_kimi(note_content, source_url)
            elif candidate == "claude":
                result = _polish_with_claude(note_content, source_url)
            elif candidate == "custom":
                result = _polish_with_custom(note_content, source_url)
            else:
                continue

            # 如果润色成功且验证通过，直接返回
            if result != note_content:
                if candidate != agent:
                    print(f"[polish_agent] {agent} 失败，fallback 到 {candidate} 成功", file=sys.stderr)
                return result
            # 返回了原始内容（验证失败等），尝试下一个
            print(f"[polish_agent] {candidate} 返回原始内容，尝试 fallback", file=sys.stderr)
        except Exception as exc:
            print(f"[polish_agent] {candidate} 润色失败: {exc}", file=sys.stderr)
            continue

    # 所有 agent 都失败，返回原始内容
    print(f"[polish_agent] 所有润色 agent 均失败，使用原始内容", file=sys.stderr)
    return note_content


def _polish_with_kimi(note_content: str, source_url: str) -> str:
    """使用 Kimi Code CLI 润色笔记。"""
    kimi_cmd = os.getenv("KIMI_CLI_PATH", "kimi")

    # 构建润色 prompt
    polish_prompt = _build_polish_prompt(note_content, source_url)

    # 根据笔记长度动态计算超时
    # 经验值：每1000字约8秒处理时间，最少60秒，最多300秒
    word_count = len(note_content)
    timeout = max(60, min(300, word_count // 1000 * 8 + 30))

    # Windows 下需要设置环境变量强制 UTF-8
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    try:
        # 调用 Kimi CLI
        # --print: 非交互模式，自动 --yolo（跳过确认）
        # --final-message-only: 只输出最终回复，过滤掉中间步骤噪声
        # -p: 直接传递 prompt（不通过文件，避免文件 IO 延迟）
        result = subprocess.run(
            [kimi_cmd, "--print", "--final-message-only", "-p", polish_prompt],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )

        if result.returncode != 0:
            stderr_text = (result.stderr or "").strip()
            raise RuntimeError(f"Kimi CLI 返回错误: {stderr_text}")

        polished = result.stdout.strip()

        # 验证输出质量：确保返回了有效的 Markdown 内容
        if not _validate_polished_output(polished, note_content):
            print("[polish_agent] Kimi 输出验证失败，使用原始内容", file=sys.stderr)
            return note_content

        return polished
    except subprocess.TimeoutExpired:
        print(f"[polish_agent] Kimi CLI 超时（{timeout}s），使用原始内容")
        return note_content


def _polish_with_claude(note_content: str, source_url: str) -> str:
    """使用 Claude CLI 润色笔记。"""
    claude_cmd = os.getenv("CLAUDE_CLI_PATH", "claude")

    polish_prompt = _build_polish_prompt(note_content, source_url)

    # 根据笔记长度动态计算超时（纯本地编辑，无需网络请求）
    # 经验值：每1000字约5秒处理时间，最少15秒，最多60秒
    word_count = len(note_content)
    timeout = max(15, min(60, word_count // 1000 * 5 + 10))

    result = subprocess.run(
        [claude_cmd, "--print", "--permission-mode", "bypassPermissions", "-p", polish_prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )

    if result.returncode != 0:
        raise RuntimeError(f"Claude CLI 返回错误: {result.stderr}")

    polished = result.stdout.strip()

    if not _validate_polished_output(polished, note_content):
        return note_content

    return polished


def _polish_with_custom(note_content: str, source_url: str) -> str:
    """使用自定义命令润色笔记。"""
    custom_cmd = os.getenv("WEB_FETCH_CUSTOM_POLISH_CMD", "").strip()
    if not custom_cmd:
        raise ValueError("WEB_FETCH_CUSTOM_POLISH_CMD 未配置")

    polish_prompt = _build_polish_prompt(note_content, source_url)

    # 使用 shell 执行自定义命令
    result = subprocess.run(
        custom_cmd,
        input=polish_prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=int(os.getenv("WEB_FETCH_CUSTOM_POLISH_TIMEOUT", "120")),
    )

    if result.returncode != 0:
        raise RuntimeError(f"自定义润色命令返回错误: {result.stderr}")

    polished = result.stdout.strip()

    if not _validate_polished_output(polished, note_content):
        return note_content

    return polished


def _build_polish_prompt(note_content: str, source_url: str) -> str:
    """构建润色 prompt。

    ⚠️ 重要：不要给 Kimi 任何 URL，否则它会去抓取，导致超时。
    润色只基于已有的 note_content 进行本地编辑。
    """
    return f"""你是一位专业的技术文档编辑，负责润色 Obsidian 知识库笔记。

## 任务
请对以下笔记进行润色，使其符合高质量知识沉淀标准。

## ⚠️ 重要约束
- **只基于下方提供的笔记内容进行润色**
- **不要去抓取任何网页或点击任何链接**
- **不要尝试访问外部资源**
- 所有需要的信息已经在笔记中

## 润色要求

1. **保留核心信息**
   - 不得删减原文的关键技术细节、数据、人名、产品名
   - 保持 TL;DR 和关键要点的准确性

2. **优化表达质量**
   - 修正不通顺的语句
   - 统一术语使用（如全文统一使用"函数"或"方法"）
   - 将口语化表达转为书面技术文档风格
   - 删除营销话术、情感渲染词

3. **增强结构化**
   - 确保 headings 层级清晰
   - 使用 bullets 替代大段散文
   - 适合表格的信息转为表格呈现

4. **格式规范**
   - 保持 Obsidian 兼容的 Markdown 格式
   - 确保链接格式正确
   - 不添加 YAML frontmatter
   - 不使用 emoji

5. **完整性检查**
   - 确保笔记有清晰的逻辑流：背景 → 核心内容 → 结论
   - 检查是否有明显的信息遗漏或断章取义

## 待润色笔记

```markdown
{note_content}
```

## 输出要求

- 直接输出润色后的完整 Markdown 笔记
- 不要添加任何解释性文字
- 不要包裹在代码块中（除非原文包含代码块）
- 保持与原文相同的语言（中文/英文）
- 不要尝试访问或抓取任何外部链接
"""


def _validate_polished_output(polished: str, original: str) -> bool:
    """验证润色输出的基本质量。"""
    if not polished or len(polished) < 100:
        return False

    # 检查是否保留了基本结构（TL;DR、原文链接等关键元素）
    required_markers = ["TL;DR", "原文链接"]
    for marker in required_markers:
        if marker in original and marker not in polished:
            # 如果原文有但润色后没有，可能是格式被破坏
            # 但允许一定程度的格式调整，这里只打印警告
            print(f"[polish_agent] 警告: 润色输出可能缺失 '{marker}'", file=sys.stderr)

    # 检查输出长度是否在合理范围内（原始长度的 50%-150%）
    orig_len = len(original)
    polish_len = len(polished)
    if polish_len < orig_len * 0.3 or polish_len > orig_len * 1.5:
        print(f"[polish_agent] 警告: 润色后长度异常 ({orig_len} -> {polish_len})", file=sys.stderr)
        # 长度异常不一定是错误，只是警告

    return True


def is_polish_enabled() -> bool:
    """检查是否启用了润色功能。"""
    if os.getenv("WEB_FETCH_DISABLE_POLISH", "").lower() in ("1", "true", "yes"):
        return False
    return os.getenv("WEB_FETCH_POLISH_AGENT", "kimi") != "none"
