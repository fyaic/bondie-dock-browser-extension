---
name: axia-multimedia-to-note
description: |-
  多媒体内容知识沉淀工具 - 将链接/媒体转化为 Obsidian 笔记。
  支持输入：文章 URL、视频 URL、GitHub repo URL、本地文件
  输出：Obsidian Markdown 笔记 + Slack Block Kit 播报
  触发词：解析链接、保存文章、生成笔记、存档链接、视频转笔记、抓取网页
  组件化架构：每个处理步骤可独立调用
version: 3.0.0
author: AIC
---

# axia-multimedia-to-note

组件化多媒体知识沉淀工具。

## 核心原则

- 内容全面优先，分析深度优先
- 组件解耦，每个 CLI 可独立运行
- 优雅降级，可选步骤失败不阻塞主流程

## 架构

```
media-to-note.sh (主入口)
  ├── 前处理层: media-understand.sh / video-pipeline.py / fetch-webpage.py / fetch-github.py
  ├── 分析层: analyze-note.py / rewrite-note.py / enrich-note.py
  └── 输出层: render-note.py / polish-note.sh / render-slack.py
```

## 调用方式

### 完整流水线
```bash
scripts/run-pipeline.sh <URL> [--output-dir DIR] [--skip-polish] [--skip-enrich]
```

### 单独调用组件
```bash
# 分析
echo "$MARKDOWN" | python3 scripts/analyze-note.py --title "..." --content-type article --source-url URL

# LLM 重写
echo "$ANALYSIS_JSON" | python3 scripts/rewrite-note.py --source-file doc.md --title "..."

# 延展补充
echo "$ANALYSIS_JSON" | python3 scripts/enrich-note.py --source-file doc.md --title "..."

# 渲染笔记
python3 scripts/render-note.py --analysis-file a.json --enrichment-file e.json --title "..." --source-url URL

# 润色
scripts/polish-note.sh note.md

# Slack 播报
python3 scripts/render-slack.py --note-file note.md --source-url URL --title "..."
```

## 依赖

- 系统: python3, curl, yt-dlp, ffmpeg
- API: MEDIA_API_KEY (必需), OPENAI_API_KEY (可选), DEEPGRAM_API_KEY (可选)
- 可选 CLI: kimi (润色), claude (润色)
