#!/bin/bash
# install.sh - axia-multimedia-to-note 安装脚本
set -e

SKILL_NAME="axia-multimedia-to-note"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${HOME}/.openclaw/skills/${SKILL_NAME}"

echo "🔧 安装 ${SKILL_NAME}..."
echo ""

# Step 1: 检查环境变量
echo "【1/4】检查环境变量"
if [[ -n "${MEDIA_API_KEY:-}" ]]; then
    echo "  ✅ MEDIA_API_KEY: ${MEDIA_API_KEY:0:8}..."
else
    echo "  ⚠️  MEDIA_API_KEY 未设置（Gemini 多模态调用需要）"
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "  ✅ OPENAI_API_KEY: ${OPENAI_API_KEY:0:8}..."
elif [[ -n "${MEDIA_API_KEY:-}" ]]; then
    echo "  ℹ️  将使用 MEDIA_API_KEY 作为 LLM API Key"
else
    echo "  ⚠️  LLM API Key 未设置（分析重写将使用纯规则模式）"
fi

if [[ -n "${DEEPGRAM_API_KEY:-}" ]]; then
    echo "  ✅ DEEPGRAM_API_KEY: ${DEEPGRAM_API_KEY:0:8}..."
else
    echo "  ⚠️  DEEPGRAM_API_KEY 未设置（视频音频转写将不可用）"
fi
echo ""

# Step 2: 检查系统工具
echo "【2/4】检查系统工具"
TOOLS=("python3" "curl" "yt-dlp" "ffmpeg")
for tool in "${TOOLS[@]}"; do
    if command -v "$tool" &>/dev/null; then
        echo "  ✅ $tool: $(command -v "$tool")"
    else
        echo "  ❌ $tool: 未安装"
    fi
done
echo ""

# Step 3: 安装 Python 依赖
echo "【3/4】安装 Python 依赖"
if [[ -f "${SCRIPT_DIR}/requirements.txt" ]]; then
    pip3 install -q -r "${SCRIPT_DIR}/requirements.txt" 2>/dev/null || \
    pip install -q -r "${SCRIPT_DIR}/requirements.txt" 2>/dev/null || \
    echo "  ⚠️  Python 依赖安装可能失败，请手动执行 pip install -r requirements.txt"
    echo "  ✅ Python 依赖已安装"
else
    echo "  ℹ️  无 requirements.txt，跳过"
fi
echo ""

# Step 4: 部署到 ~/.openclaw/skills/
echo "【4/4】部署 Skill"
mkdir -p "${TARGET_DIR}"

# 复制核心文件
cp -r "${SCRIPT_DIR}/lib" "${TARGET_DIR}/"
cp -r "${SCRIPT_DIR}/scripts" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/SKILL.md" "${TARGET_DIR}/" 2>/dev/null || true
cp "${SCRIPT_DIR}/env.template" "${TARGET_DIR}/" 2>/dev/null || true

# 设置执行权限
chmod +x "${TARGET_DIR}/scripts/"*.sh 2>/dev/null || true
chmod +x "${TARGET_DIR}/scripts/"*.py 2>/dev/null || true

echo "  ✅ 已部署到 ${TARGET_DIR}"
echo ""

# 验证
if [[ -f "${TARGET_DIR}/scripts/run-pipeline.sh" ]]; then
    echo "✅ 安装完成！"
    echo ""
    echo "使用方法:"
    echo "  ${TARGET_DIR}/scripts/run-pipeline.sh <URL>"
    echo "  ${TARGET_DIR}/scripts/media-to-note.sh <URL或文件>"
else
    echo "⚠️  安装可能不完整，请检查 ${TARGET_DIR}"
fi
