#!/bin/bash
# Media understanding via 118api.cn
# Usage: media-understand.sh <media_path> <media_type> [max_chars]
#
# 输出原则：内容全面优先，不做删减压缩
set -e

MEDIA_PATH="$1"
MEDIA_TYPE="$2"  # image, audio, video
MAX_CHARS="${3:-0}"  # 0 = 无限制
API_URL="https://118api.cn/v1/chat/completions"
API_KEY="${MEDIA_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
    echo "❌ 错误: MEDIA_API_KEY 环境变量未设置" >&2
    echo "   请设置: export MEDIA_API_KEY='your-api-key'" >&2
    exit 1
fi

if [[ -z "$MEDIA_PATH" || -z "$MEDIA_TYPE" ]]; then
    echo "Usage: $0 <media_path> <media_type> [max_chars]" >&2
    exit 1
fi

# 根据类型设置 prompt - 要求完整输出
case "$MEDIA_TYPE" in
    image)
        MIME_TYPE="image/jpeg"
        CONTENT_KEY="image_url"
        PROMPT="请详细描述这张图片的所有内容，包括：
1. 视觉元素：场景、人物、物体、颜色、构图
2. 文字内容：图片中的所有文字（完整转录）
3. 细节特征：表情、动作、位置关系
4. 隐含信息：可能的背景、意图、情感

请尽可能详细，不要省略任何内容。"
        ;;
    audio)
        MIME_TYPE="audio/mp3"
        CONTENT_KEY="audio_url"
        PROMPT="请完整转录这段音频的所有内容。

要求：
1. 逐字逐句转录，不要省略
2. 保留说话人的语气和停顿
3. 如果有多个说话人，标注说话人
4. 如有背景音或特殊效果，注明

请尽可能完整，不要概括或压缩。"
        ;;
    video)
        MIME_TYPE="video/mp4"
        # NOTE: 118api 中转不支持 video_url content type，必须用 image_url
        # Gemini 会根据 MIME type (video/mp4) 自动识别为视频
        CONTENT_KEY="image_url"
        PROMPT="请全面分析这段视频的所有内容，输出完整的文档。

## 必须包含的内容

### 1. 视频概览
- 标题/主题（如果能推断）
- 整体时长和节奏
- 视频类型（教学/演讲/娱乐/新闻等）

### 2. 视觉内容详细描述
- 场景设置：地点、环境、背景
- 人物：出场人物、外貌、着装、表情、动作
- 物体：出现的所有重要物体、道具
- 视觉效果：字幕、图表、动画、转场
- 镜头变化：特写、远景、切换

### 3. 音频内容完整转录
- 对话/旁白：逐字转录，标注说话人
- 背景音乐：类型、情绪
- 音效：重要音效描述

### 4. 内容结构
- 开头：如何开始，引入什么
- 主体：分几个部分，每个部分讲什么
- 结尾：如何结束，结论是什么

### 5. 关键信息提取
- 核心观点/主题
- 重要数据/数字
- 关键时间点
- 引用/参考

### 6. 细节补充
- 任何值得注意的细节
- 可能被忽略但重要的内容

---
请尽可能详细完整，不要概括、不要省略、不要压缩。这是文档生成，内容全面优先。"
        ;;
    *)
        echo "Unknown media type: $MEDIA_TYPE" >&2
        exit 1
        ;;
esac

# Build JSON payload with Python to avoid shell variable expansion issues
# (base64 data too large for heredoc, prompt chars need JSON escaping)
TMPFILE=$(mktemp)
python3 -c "
import base64, json, sys

media_path = sys.argv[1]
mime_type = sys.argv[2]
content_key = sys.argv[3]
prompt = sys.argv[4]
max_chars = int(sys.argv[5])

with open(media_path, 'rb') as f:
    encoded = base64.b64encode(f.read()).decode('utf-8')

payload = {
    'model': 'gemini-3-flash-preview',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': prompt},
            {'type': content_key, content_key: {'url': f'data:{mime_type};base64,{encoded}'}}
        ]
    }],
    'temperature': 0.3
}
if max_chars > 0:
    payload['max_tokens'] = max_chars

with open(sys.argv[6], 'w') as f:
    json.dump(payload, f, ensure_ascii=False)
" "$MEDIA_PATH" "$MIME_TYPE" "$CONTENT_KEY" "$PROMPT" "$MAX_CHARS" "$TMPFILE"

# Call API with longer timeout for video
RESPONSE=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    --max-time 300 \
    -d @"$TMPFILE")

rm -f "$TMPFILE"

# Extract content from response
echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'choices' in data and len(data['choices']) > 0:
        content = data['choices'][0]['message']['content']
        print(content)
    elif 'error' in data:
        print(f'API Error: {data[\"error\"]}', file=sys.stderr)
        sys.exit(1)
    else:
        print('Unexpected response format', file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f'Parse error: {e}', file=sys.stderr)
    sys.exit(1)
"
