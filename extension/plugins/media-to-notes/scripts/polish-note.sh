#!/usr/bin/env bash
# polish-note.sh — 调用 kimi/claude CLI 对笔记进行润色
#
# 逻辑从 polish_agent.py 的 Bash 重写。
#
# 用法:
#   polish-note.sh <input-file> [--agent kimi|claude|none]
#
# 输入：文件路径（Markdown 笔记）
# stdout：润色后的 Markdown
# stderr：进度/错误信息

set -euo pipefail

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------

INPUT_FILE=""
AGENT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --agent)
            AGENT="$2"
            shift 2
            ;;
        -*)
            echo "[polish-note] 未知参数: $1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$INPUT_FILE" ]]; then
                INPUT_FILE="$1"
            else
                echo "[polish-note] 多余参数: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$INPUT_FILE" ]]; then
    echo "用法: polish-note.sh <input-file> [--agent kimi|claude|none]" >&2
    exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
    echo "[polish-note] 文件不存在: $INPUT_FILE" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 清理临时文件
# ---------------------------------------------------------------------------

CLEANUP_FILES=()

cleanup() {
    for f in "${CLEANUP_FILES[@]}"; do
        if [[ -f "$f" ]]; then
            rm -f "$f"
        fi
    done
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 检查是否禁用润色
# ---------------------------------------------------------------------------

DISABLE_POLISH="${WEB_FETCH_DISABLE_POLISH:-}"
if [[ "$DISABLE_POLISH" =~ ^(|true|1|yes)$ ]] && [[ -n "$DISABLE_POLISH" ]]; then
    cat "$INPUT_FILE"
    exit 0
fi

# ---------------------------------------------------------------------------
# 读取原始内容
# ---------------------------------------------------------------------------

ORIGINAL=$(cat "$INPUT_FILE")
WORD_COUNT=${#ORIGINAL}

echo "[polish-note] 笔记长度: ${WORD_COUNT} 字符" >&2

# ---------------------------------------------------------------------------
# 确定 agent 优先级
# ---------------------------------------------------------------------------

if [[ -z "$AGENT" ]]; then
    AGENT="${WEB_FETCH_POLISH_AGENT:-kimi}"
fi

if [[ "$AGENT" == "none" ]]; then
    cat "$INPUT_FILE"
    exit 0
fi

# 构建 fallback 链
declare -a CANDIDATES=()
case "$AGENT" in
    kimi)
        CANDIDATES=(kimi claude)
        ;;
    claude)
        CANDIDATES=(claude kimi)
        ;;
    *)
        CANDIDATES=("$AGENT")
        ;;
esac

# ---------------------------------------------------------------------------
# 构建润色 prompt（使用 heredoc）
# ---------------------------------------------------------------------------

build_polish_prompt() {
    cat <<'PROMPT_EOF'
你是一位专业的技术文档编辑，负责润色 Obsidian 知识库笔记。

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
PROMPT_EOF
    # 嵌入笔记内容（不用 heredoc 避免冲突）
    echo "$ORIGINAL"
    cat <<'PROMPT_EOF'
```

## 输出要求

- 直接输出润色后的完整 Markdown 笔记
- 不要添加任何解释性文字
- 不要包裹在代码块中（除非原文包含代码块）
- 保持与原文相同的语言（中文/英文）
- 不要尝试访问或抓取任何外部链接
PROMPT_EOF
}

# ---------------------------------------------------------------------------
# 验证输出
# ---------------------------------------------------------------------------

validate_output() {
    local polished="$1"
    local original="$2"
    local polished_len=${#polished}

    # 最小长度检查
    if [[ $polished_len -lt 100 ]]; then
        echo "[polish-note] 输出过短 (${polished_len} < 100)，验证失败" >&2
        return 1
    fi

    # 检查关键标记是否保留
    for marker in "TL;DR" "原文链接"; do
        if echo "$original" | grep -q "$marker"; then
            if ! echo "$polished" | grep -q "$marker"; then
                echo "[polish-note] 警告: 润色输出可能缺失 '${marker}'" >&2
            fi
        fi
    done

    # 长度范围检查（30% ~ 150%）
    local orig_len=${#original}
    local lower=$((orig_len * 30 / 100))
    local upper=$((orig_len * 150 / 100))

    if [[ $polished_len -lt $lower || $polished_len -gt $upper ]]; then
        echo "[polish-note] 警告: 润色后长度异常 (${orig_len} -> ${polished_len})" >&2
        # 长度异常仅警告，不阻止
    fi

    return 0
}

# ---------------------------------------------------------------------------
# 调用 agent
# ---------------------------------------------------------------------------

call_kimi() {
    local prompt_file="$1"
    local timeout
    # 动态超时：word_count/1000 * 8 + 30，范围 60~300 秒
    timeout=$(( WORD_COUNT / 1000 * 8 + 30 ))
    if [[ $timeout -lt 60 ]]; then
        timeout=60
    fi
    if [[ $timeout -gt 300 ]]; then
        timeout=300
    fi

    local kimi_cmd="${KIMI_CLI_PATH:-kimi}"
    echo "[polish-note] 调用 Kimi (超时 ${timeout}s)..." >&2

    $kimi_cmd --print --final-message-only -p "$(cat "$prompt_file")" 2>/dev/null
}

call_claude() {
    local prompt_file="$1"
    local timeout
    # 动态超时：word_count/1000 * 5 + 10，范围 15~60 秒
    timeout=$(( WORD_COUNT / 1000 * 5 + 10 ))
    if [[ $timeout -lt 15 ]]; then
        timeout=15
    fi
    if [[ $timeout -gt 60 ]]; then
        timeout=60
    fi

    local claude_cmd="${CLAUDE_CLI_PATH:-claude}"
    echo "[polish-note] 调用 Claude (超时 ${timeout}s)..." >&2

    $claude_cmd --print --permission-mode bypassPermissions -p "$(cat "$prompt_file")" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 主循环：依次尝试 candidates
# ---------------------------------------------------------------------------

# 构建一次 prompt，写入临时文件
PROMPT_FILE=$(mktemp "${TMPDIR:-/tmp}/polish-prompt.XXXXXX.md")
CLEANUP_FILES+=("$PROMPT_FILE")
build_polish_prompt > "$PROMPT_FILE"

OUTPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/polish-output.XXXXXX.md")
CLEANUP_FILES+=("$OUTPUT_FILE")

for candidate in "${CANDIDATES[@]}"; do
    echo "[polish-note] 尝试 agent: ${candidate}" >&2

    OUTPUT=""
    case "$candidate" in
        kimi)
            if ! command -v "${KIMI_CLI_PATH:-kimi}" &>/dev/null; then
                echo "[polish-note] kimi CLI 不可用，跳过" >&2
                continue
            fi
            OUTPUT=$(call_kimi "$PROMPT_FILE") || {
                echo "[polish-note] kimi 调用失败" >&2
                continue
            }
            ;;
        claude)
            if ! command -v "${CLAUDE_CLI_PATH:-claude}" &>/dev/null; then
                echo "[polish-note] claude CLI 不可用，跳过" >&2
                continue
            fi
            OUTPUT=$(call_claude "$PROMPT_FILE") || {
                echo "[polish-note] claude 调用失败" >&2
                continue
            }
            ;;
        *)
            echo "[polish-note] 未知 agent: ${candidate}，跳过" >&2
            continue
            ;;
    esac

    OUTPUT=$(echo "$OUTPUT" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

    # 验证
    if ! validate_output "$OUTPUT" "$ORIGINAL"; then
        echo "[polish-note] ${candidate} 输出验证失败，尝试 fallback" >&2
        continue
    fi

    if [[ "$candidate" != "$AGENT" ]]; then
        echo "[polish-note] ${AGENT} 失败，fallback 到 ${candidate} 成功" >&2
    else
        echo "[polish-note] ${candidate} 润色成功" >&2
    fi

    echo "$OUTPUT"
    exit 0
done

# 所有 agent 都失败，返回原始内容
echo "[polish-note] 所有润色 agent 均失败，使用原始内容" >&2
echo "$ORIGINAL"
