#!/bin/bash
# run-pipeline.sh - 完整知识沉淀流水线
# 用法: run-pipeline.sh <URL或文件路径> [--output-dir DIR] [--skip-polish] [--skip-enrich] [--skip-rewrite] [--skip-vision]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT="$1"
shift || true

# 解析参数
OUTPUT_DIR=""
SKIP_POLISH=false
SKIP_ENRICH=false
SKIP_REWRITE=false
SKIP_VISION=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --skip-polish) SKIP_POLISH=true; shift ;;
        --skip-enrich) SKIP_ENRICH=true; shift ;;
        --skip-rewrite) SKIP_REWRITE=true; shift ;;
        --skip-vision) SKIP_VISION=true; shift ;;
        *) shift ;;
    esac
done

if [[ -z "$INPUT" ]]; then
    echo "用法: run-pipeline.sh <URL或文件路径> [--output-dir DIR] [--skip-polish] [--skip-enrich] [--skip-rewrite] [--skip-vision]" >&2
    exit 1
fi

# 临时文件管理
TMPDIR=$(mktemp -d /tmp/axia-pipeline-XXXXXX)
trap "rm -rf $TMPDIR" EXIT

# 文章图片下载+视觉分析的 output dir
FETCH_OUTPUT_DIR="$TMPDIR/fetch-output"

# 构造图片分析参数（当 MEDIA_API_KEY 可用且未 skip 时启用）
VISION_ARGS=""
if [[ "$SKIP_VISION" != "true" && -n "${MEDIA_API_KEY:-}" ]]; then
    VISION_ARGS="--analyze-images --output-dir $FETCH_OUTPUT_DIR"
elif [[ "$SKIP_VISION" != "true" ]]; then
    # 即使没有 API key 也传 output-dir，至少下载图片
    VISION_ARGS="--output-dir $FETCH_OUTPUT_DIR"
fi

TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%d_%H%M%S)
NOW=$(TZ=Asia/Shanghai date "+%Y-%m-%d %H:%M")

# 默认输出目录
if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="${WEB_FETCH_OUTPUT_DIR:-$HOME/Documents/AIC-000/Web Clippings}"
fi
mkdir -p "$OUTPUT_DIR"

echo "🔄 开始处理: $INPUT" >&2

# ── Step 1: 前处理 ── 获取原始 Markdown 文档
echo "📥 Step 1: 前处理（获取原始内容）..." >&2

SOURCE_URL=""
TITLE=""
CONTENT_TYPE=""
PLATFORM=""
AUTHOR=""

if [[ -f "$INPUT" ]]; then
    # 本地文件
    CONTENT_TYPE="article"
    PLATFORM="本地文件"
    TITLE=$(basename "$INPUT")
    cp "$INPUT" "$TMPDIR/source.md"
else
    # URL - 使用 media-understand.sh 或 yt-dlp 检测
    SOURCE_URL="$INPUT"

    # 尝试检测是否为视频平台
    IS_VIDEO=false
    if echo "$INPUT" | grep -qE "youtube\.com|youtu\.be|bilibili\.com|b23\.tv|tiktok\.com|douyin\.com|v\.douyin\.com"; then
        IS_VIDEO=true
        CONTENT_TYPE="video"
    fi

    if echo "$INPUT" | grep -qE "github\.com"; then
        CONTENT_TYPE="github"
    fi

    if [[ "$IS_VIDEO" == "true" ]]; then
        # 视频 URL - 使用 video-pipeline.py
        echo "🎬 检测到视频链接，使用 video-pipeline.py..." >&2
        if python3 "$SCRIPT_DIR/video-pipeline.py" --url "$INPUT" > "$TMPDIR/fetch-result.json" 2>"$TMPDIR/video-err.log"; then
            # 从 JSON 提取字段
            TITLE=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('title',''))")
            PLATFORM=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('platform',''))")
            AUTHOR=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('author',''))")
            python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('content_markdown',''))" > "$TMPDIR/source.md"
            echo "✅ 视频处理完成" >&2
        else
            echo "⚠️ 视频处理失败，尝试 HANDOFF" >&2
            cat "$TMPDIR/video-err.log" >&2
            # 输出 HANDOFF 信息到 stdout
            echo "HANDOFF: VIDEO_FALLBACK"
            echo "URL: $INPUT"
            echo ""
            echo "## 调用前准备"
            echo "- 视频下载或处理失败"
            echo "- 可尝试: 手动下载后用 media-understand.sh 处理"
            exit 0
        fi
    elif [[ "$CONTENT_TYPE" == "github" ]]; then
        # GitHub URL
        echo "🧩 检测到 GitHub 链接..." >&2
        if python3 "$SCRIPT_DIR/fetch-github.py" --url "$INPUT" > "$TMPDIR/fetch-result.json" 2>/dev/null; then
            TITLE=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('title',''))")
            PLATFORM="GitHub"
            AUTHOR=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('author',''))")
            python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('content_markdown',''))" > "$TMPDIR/source.md"
            echo "✅ GitHub 处理完成" >&2
        else
            # fallback 到网页抓取
            echo "⚠️ GitHub API 失败，尝试网页抓取..." >&2
            if python3 "$SCRIPT_DIR/fetch-webpage.py" --url "$INPUT" $VISION_ARGS > "$TMPDIR/fetch-result.json" 2>/dev/null; then
                TITLE=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('title',''))")
                PLATFORM=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('platform',''))")
                AUTHOR=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('author',''))")
                python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('content_markdown',''))" > "$TMPDIR/source.md"
                echo "✅ 网页抓取完成" >&2
            else
                echo "HANDOFF: WEB_ARTICLE"
                echo "URL: $INPUT"
                echo "TYPE: github_page"
                exit 0
            fi
        fi
    else
        # 普通网页
        CONTENT_TYPE="article"
        echo "📰 尝试网页抓取..." >&2
        if python3 "$SCRIPT_DIR/fetch-webpage.py" --url "$INPUT" $VISION_ARGS > "$TMPDIR/fetch-result.json" 2>/dev/null; then
            TITLE=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('title',''))")
            PLATFORM=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('platform',''))")
            AUTHOR=$(python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('author',''))")
            python3 -c "import json; d=json.load(open('$TMPDIR/fetch-result.json')); print(d.get('content_markdown',''))" > "$TMPDIR/source.md"
            echo "✅ 网页抓取完成" >&2
        else
            echo "HANDOFF: WEB_ARTICLE"
            echo "URL: $INPUT"
            echo "TYPE: general_webpage"
            echo ""
            echo "## 调用前准备"
            echo "- 目标 skill: web-capabilities"
            echo "- 原因: 基础抓取失败，需要浏览器渲染"
            echo ""
            echo "## 调用方式"
            echo "- 优先: agent-browser open \"$INPUT\""
            echo "- 备用: jina reader https://r.jina.ai/$INPUT"
            exit 0
        fi
    fi
fi

# 确保 CONTENT_TYPE 有值
CONTENT_TYPE=${CONTENT_TYPE:-article}
TITLE=${TITLE:-"未命名"}
PLATFORM=${PLATFORM:-"未知"}
SOURCE_URL=${SOURCE_URL:-$INPUT}

echo "📊 标题: $TITLE" >&2
echo "📊 类型: $CONTENT_TYPE | 平台: $PLATFORM" >&2

# ── Step 2: 规则分析 ──
echo "🧠 Step 2: 规则分析..." >&2
ANALYSIS_JSON=$("$SCRIPT_DIR/analyze-note.py" \
    --title "$TITLE" \
    --content-type "$CONTENT_TYPE" \
    --source-url "$SOURCE_URL" \
    < "$TMPDIR/source.md")
echo "$ANALYSIS_JSON" > "$TMPDIR/analysis.json"
echo "✅ 分析完成" >&2

# ── Step 3: LLM 重写（可选）──
if [[ "$SKIP_REWRITE" != "true" ]]; then
    echo "✍️ Step 3: LLM 重写（可选）..." >&2
    REWRITE_RESULT=$(echo "$ANALYSIS_JSON" | python3 "$SCRIPT_DIR/rewrite-note.py" \
        --source-file "$TMPDIR/source.md" \
        --title "$TITLE" \
        --content-type "$CONTENT_TYPE" \
        --platform "$PLATFORM" \
        --source-url "$SOURCE_URL" 2>"$TMPDIR/rewrite-err.log") || true

    if echo "$REWRITE_RESULT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
        ANALYSIS_JSON="$REWRITE_RESULT"
        echo "$ANALYSIS_JSON" > "$TMPDIR/analysis.json"
        echo "✅ LLM 重写完成" >&2
    else
        echo "⚠️ LLM 重写跳过（使用规则分析结果）" >&2
    fi
else
    echo "⏭️ Step 3: 跳过 LLM 重写" >&2
fi

# ── Step 4: 延展补充（可选）──
if [[ "$SKIP_ENRICH" != "true" ]]; then
    echo "🔍 Step 4: 延展补充..." >&2
    ENRICHMENT_JSON=$(echo "$ANALYSIS_JSON" | python3 "$SCRIPT_DIR/enrich-note.py" \
        --source-file "$TMPDIR/source.md" \
        --title "$TITLE" \
        --source-url "$SOURCE_URL" 2>"$TMPDIR/enrich-err.log") || ENRICHMENT_JSON='{"summary":"","entities":[],"resources":[]}'
    echo "$ENRICHMENT_JSON" > "$TMPDIR/enrichment.json"
    echo "✅ 延展补充完成" >&2
else
    echo '{"summary":"","entities":[],"resources":[]}' > "$TMPDIR/enrichment.json"
    echo "⏭️ Step 4: 跳过延展补充" >&2
fi

# ── Step 5: 渲染笔记 ──
echo "📝 Step 5: 渲染笔记..." >&2
NOTE_CONTENT=$(python3 "$SCRIPT_DIR/render-note.py" \
    --analysis-file "$TMPDIR/analysis.json" \
    --enrichment-file "$TMPDIR/enrichment.json" \
    --source-url "$SOURCE_URL" \
    --title "$TITLE" \
    --content-type "$CONTENT_TYPE" \
    --platform "$PLATFORM" \
    --author "$AUTHOR" \
    --status generated 2>/dev/null) || {
    echo "❌ 渲染失败" >&2
    exit 1
}
echo "✅ 笔记渲染完成" >&2

# ── Step 6: 润色（可选）──
if [[ "$SKIP_POLISH" != "true" ]]; then
    echo "✨ Step 6: 润色（可选）..." >&2
    echo "$NOTE_CONTENT" > "$TMPDIR/note-raw.md"
    POLISHED=$("$SCRIPT_DIR/polish-note.sh" "$TMPDIR/note-raw.md" 2>/dev/null) || POLISHED="$NOTE_CONTENT"
    NOTE_CONTENT="$POLISHED"
    echo "✅ 润色完成" >&2
else
    echo "⏭️ Step 6: 跳过润色" >&2
fi

# ── Step 7: 写入文件 ──
SAFE_TITLE=$(echo "$TITLE" | tr '/\\:*?"<>|' '_' | cut -c1-80)
NOTE_PATH="$OUTPUT_DIR/${SAFE_TITLE}.md"
echo "$NOTE_CONTENT" > "$NOTE_PATH"
echo "💾 笔记已保存: $NOTE_PATH" >&2

# ── Step 8: 渲染 Slack 播报 ──
echo "📊 Step 8: 渲染 Slack 播报..." >&2
echo "$NOTE_CONTENT" > "$TMPDIR/note-final.md"
SLACK_PAYLOAD=$(python3 "$SCRIPT_DIR/render-slack.py" \
    --note-file "$TMPDIR/note-final.md" \
    --source-url "$SOURCE_URL" \
    --title "$TITLE" \
    --content-type "$CONTENT_TYPE" \
    --platform "$PLATFORM" \
    --author "$AUTHOR" \
    --status generated 2>/dev/null) || SLACK_PAYLOAD='{"text":"处理完成","blocks":[]}'

# ── Step 9: 输出终态结果 ──
RESULT=$(cat <<ENDJSON
{
  "status": "generated",
  "title": $(python3 -c "import json; print(json.dumps('$TITLE'))"),
  "source_url": $(python3 -c "import json; print(json.dumps('$SOURCE_URL'))"),
  "content_type": "$CONTENT_TYPE",
  "platform": "$PLATFORM",
  "note_path": "$NOTE_PATH",
  "processed_at": "$NOW",
  "report_payload": $SLACK_PAYLOAD
}
ENDJSON
)

echo "$RESULT" | python3 -c "import json,sys; json.dump(json.load(sys.stdin), sys.stdout, ensure_ascii=False, indent=2)"
echo "" >&2
echo "✅ 全部完成！" >&2
