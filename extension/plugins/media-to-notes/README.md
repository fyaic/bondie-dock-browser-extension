# axia-multimedia-to-note

多媒体内容知识沉淀工具 — 将 URL / 本地文件转化为 Obsidian 笔记。

自动判断输入类型（文章 / 视频 / GitHub repo），走对应的解析流水线，输出结构化 Markdown 笔记到 Obsidian vault。

## 支持平台

| 类型 | 平台 | 解析方式 |
|------|------|----------|
| 文章 | 微信公众号、知乎、掘金、Medium、Substack、通用网页 | readability + markdownify |
| 视频 | YouTube | yt-dlp + Gemini 视觉分析 |
| 视频 | Bilibili | yt-dlp (m4s) + Gemini 视觉分析 |
| 视频 | 抖音 (Douyin) | Playwright CDN 拦截 + Gemini 视觉分析 |
| 视频 | TikTok | yt-dlp + Gemini 视觉分析 |
| 视频 | 其他 | yt-dlp 通用提取器 |
| GitHub | Repo | GitHub API + 产品识别 |
| 图片 | PNG/JPG/GIF/WebP | Gemini 图片描述 |

视频链路支持**双轨处理**：Gemini 视觉分析 + Deepgram 音频转写，两者可选独立运行。

## 架构

```
run-pipeline.sh (主入口)
  ├── 路由层: router.py — 根据 URL 判断 article / video / github
  ├── 前处理层:
  │   ├── video-pipeline.py — 视频双轨处理 (yt-dlp / Playwright + Gemini + Deepgram)
  │   ├── fetch-webpage.py — 文章抓取
  │   ├── fetch-github.py — GitHub repo 解析
  │   └── media-understand.sh — Gemini 多模态调用 (图片/音频/视频)
  ├── 分析层:
  │   ├── analyze-note.py — 内容分析
  │   ├── rewrite-note.py — LLM 重写
  │   └── enrich-note.py — 延展补充
  └── 输出层:
      ├── render-note.py — Markdown 渲染
      ├── polish-note.sh — Code-Agent 润色 (Kimi / Claude)
      └── render-slack.py — Slack Block Kit 播报
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt

# 视频处理需要
pip install yt-dlp playwright
playwright install chromium

# 系统依赖 (macOS)
brew install ffmpeg
```

### 2. 配置

```bash
cp .env.example .env
# 编辑 .env，填入必需的 API Key
```

详见下方 [环境变量](#环境变量) 章节。

### 3. 运行

```bash
# 完整流水线
scripts/run-pipeline.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 指定输出目录
scripts/run-pipeline.sh "https://www.bilibili.com/video/BV1xx411c7mD" --output-dir ~/Notes

# 跳过润色
scripts/run-pipeline.sh "https://mp.weixin.qq.com/s/xxx" --skip-polish

# 单独调用视频处理
python3 scripts/video-pipeline.py --url "https://www.douyin.com/video/7623335766449556788"
```

## 环境变量

复制 `.env.example` 为 `.env`，按需填写。配置加载路径：`.env`（项目根目录）。

### 必需

| 变量 | 说明 |
|------|------|
| `MEDIA_API_KEY` | API Key，用于 Gemini 多模态调用（视觉分析 + LLM 重写） |

### 视频（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPGRAM_API_KEY` | — | Deepgram API Key，开启音频转写 |
| `VIDEO_NETWORK_MODE` | `direct` | 网络模式：`direct` / `system` / `auto` |
| `VIDEO_MAX_DURATION` | `120` | 长视频截取前 N 秒（控制文件大小） |
| `VIDEO_MAX_SIZE_MB` | `100` | 视频文件大小上限 (MB) |

### 抖音专用（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DOUYIN_COOKIE_FILE` | `~/.config/axia-multimedia-to-note/cookies/douyin.txt` | Netscape 格式 cookies 文件 |
| `DOUYIN_PAGE_TIMEOUT` | `30` | Playwright 页面加载超时 (秒) |
| `DOUYIN_CDN_TIMEOUT` | `120` | CDN 视频下载超时 (秒) |

### LLM 重写（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENAI_API_KEY` | 使用 `MEDIA_API_KEY` | LLM 重写专用 API Key |
| `OPENAI_BASE_URL` | `https://118api.cn/v1` | LLM API Base URL |
| `OPENAI_MODEL` | `gemini-3-flash-preview` | LLM 模型 |

### 输出（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WEB_FETCH_OUTPUT_DIR` | `~/Documents/AIC-000/Web Clippings` | 笔记输出目录 |
| `WEB_FETCH_VAULT_ROOT` | `~/Documents/AIC-000` | Obsidian vault 根目录 |

### 润色（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WEB_FETCH_POLISH_AGENT` | `kimi` | 润色 agent：`kimi` / `claude` / `custom` / `none` |
| `WEB_FETCH_DISABLE_POLISH` | `false` | 设为 `true` 跳过润色 |

## 抖音视频说明

抖音使用 Playwright headless 浏览器替代 yt-dlp（绕过 X-Bogus JS 签名问题），流程：

1. Playwright 加载页面 → 从 DOM 提取 `video.currentSrc` CDN URL
2. curl 下载视频流（带 Referer + Cookie）
3. ffmpeg 大文件截取（控制在 API 限制内）
4. Gemini 视觉分析 → Deepgram 音频转写（可选）

需要导出抖音 cookies 为 Netscape 格式：

```bash
# 使用浏览器插件导出 cookies（如 EditThisCookie、Get cookies.txt LOCALLY）
# 保存到 ~/.config/axia-multimedia-to-note/cookies/douyin.txt
```

## 降级策略

设计原则：可选步骤失败不阻塞主流程。

| 场景 | 降级方案 |
|------|----------|
| Playwright 未安装 | 回退 yt-dlp（抖音可能失败） |
| 视频下载失败 | 使用页面截图做 Gemini 图片分析 |
| 视觉分析失败 | 仅保留 Deepgram 音频转写 |
| 音频转写失败 | 仅保留视觉分析 |
| 全部失败 | 抛出错误，pipeline 报告 `failed` |

## 仓库结构

```
.
├── scripts/
│   ├── run-pipeline.sh          # 主入口：完整流水线
│   ├── router.py                # URL 路由（article/video/github）
│   ├── video-pipeline.py        # 视频处理（独立 CLI）
│   ├── media-understand.sh      # Gemini 多模态 API 调用
│   ├── analyze-note.py          # 内容分析
│   ├── rewrite-note.py          # LLM 重写
│   ├── enrich-note.py           # 延展补充
│   ├── render-note.py           # Markdown 渲染
│   ├── render-slack.py          # Slack Block Kit 播报
│   ├── polish-note.sh           # Code-Agent 润色
│   ├── fetch-webpage.py         # 文章抓取
│   ├── fetch-github.py          # GitHub repo 解析
│   ├── config.py                # 配置加载
│   ├── models.py                # 数据模型
│   └── ...
├── SKILL.md                     # Skill 元数据
├── .env.example                 # 环境变量模板
├── env.template                 # 环境变量简版模板
├── requirements.txt             # Python 依赖
└── install.sh                   # 安装脚本
```

## 作为 Skill 使用

本项目同时作为 Claude Code / OpenClaw skill 使用：

- Claude Code: `~/.claude/skills/axia-multimedia-to-note/`
- OpenClaw: `~/.openclaw/skills/axia-multimedia-to-note/`

三套安装文件完全相同、相互独立，脚本使用 `Path(__file__).parent` 相对定位，不跨目录引用。

## License

Private — Internal use only.
