# OpenClaw Browser Side Panel PRD

日期：2026-06-11

## 背景

旧 Side Panel 解决的是企业微信聊天窗口缺少 AI 会话管理能力的问题。浏览器插件新主线要脱离企业微信自建应用环境，把 OpenClaw 会话控制做成浏览器插件内的侧栏能力。

浏览器插件当前定位已经升级为“浏览器智能工作流 Agent 门户”。Side Panel 是这个门户里的长期主视图：用户可以看到 OpenClaw 当前状态、会话列表、当前页面上下文和后续工作流入口。

## 用户故事

作为 OpenClaw 用户，我希望在浏览器右侧打开一个 OpenClaw 面板，以便查看和切换历史对话，而不必回到企业微信或独立桌面应用。

作为重度浏览器用户，我希望 Side Panel 能基于当前页面发起 OpenClaw 任务，以便把文章、视频、GitHub 仓库或普通网页快速变成摘要、笔记或深度调研。

作为多设备用户，我希望插件侧的会话状态来自可信 OpenClaw 控制面，以便切换和新开对话不会因为浏览器本地状态失真而误导我。

作为后续开发者，我希望 Side Panel 是可拆卸模块，以便它能独立迭代，不破坏已有 popup、Pattern Memory 和页面解析主链路。

## 本期包含

- Chrome/Edge Chromium Side Panel 入口规划。
- OpenClaw session list/new/switch MVP。
- 当前连接、配对、bridge、scope 的状态展示。
- 二次确认：切换历史会话、新开对话都需要明确确认。
- Confirmation-gated UI：只有 confirmed 字段为 true 才显示完成。
- “插件的插件”模块契约：module manifest、background API、消息命名、能力开关。
- 测试计划：manifest 校验、JS syntax、contract tests、浏览器加载/视觉检查。

## 本期不包含

- Safari 实现。
- Chrome Web Store / Edge Add-ons 发布。
- Native Messaging host。
- 完整聊天输入框或替代 OpenClaw 客户端。
- 全局 session 搜索和模糊匹配。
- 直接读取 OpenClaw transcript 文件。
- 静默读取所有页面正文或上传完整浏览历史。
- 多 Agent provider 的完整实现。

## MVP 页面结构

```text
OpenClaw Side Panel
├── Header
│   ├── OpenClaw 状态
│   ├── 当前 node / device pairing 状态
│   └── 刷新 / 设置入口
├── Current Scope
│   ├── workspace / route / browser context
│   └── bridge adapter status
├── Conversation List
│   ├── current generation
│   ├── historical generations
│   └── empty / unauthorized / offline states
├── Actions
│   ├── 新开对话
│   ├── 切换到选中会话
│   └── 触发 refresh/focus signal
└── Page Context Dock
    ├── 当前页面摘要入口
    ├── 深度调研入口
    └── 与现有 Page Intelligence 链路打通
```

## 数据字段

第一阶段 UI 需要展示的 session 字段：

```text
session_id
session_key
title
updated_at
summary
last_messages
model
context_window
context_used
project
tools
is_current
generation_type
empty
restorable
```

第一阶段 scope 字段不再命名为 WeComBinding。建议新命名：

```json
{
  "agent": "openclaw",
  "workspace_id": "default",
  "route_key": "browser:default",
  "route_label": "Browser",
  "device_id": "<extension-host-id>",
  "operator_id": "<paired-user-or-local-profile>",
  "browser_context": {
    "tab_id": 123,
    "url": "https://example.com",
    "title": "Example"
  }
}
```

如果第一阶段复用旧 B API，可以由 adapter 做临时映射，不要求 UI 层暴露 `wecom_user_id` 等旧字段。

## 验收标准

- 新分支有自包含文档，后续 agent 5 分钟内能知道从哪里开始。
- Side Panel 设计不依赖 WeCom OAuth、JS-SDK、panel token 或企业微信域名配置。
- 架构中明确哪些能力来自 extension core，哪些能力来自 `openclaw-side-panel` 模块。
- new/switch 行为保持旧 B 侧安全语义：new 不带 generation id，switch 必须校验 generation id。
- UI 状态明确区分：offline、unpaired、bridge unavailable、scope unresolved、empty sessions、unconfirmed operation、confirmed operation。
- 测试计划覆盖 contract、权限、service worker 生命周期、side panel 打开路径、文字溢出和关键空态。

## 主要风险

- MV3 service worker 生命周期导致 Side Panel 打开时 background 状态冷启动。
- 浏览器 sidePanel API 在 Chrome/Edge 可用，但 Safari 需要不同模型。
- 旧 B API 仍是 WeCom 命名，直接复用会污染新浏览器模型。
- 如果绕过 Session Bridge 直接调 Gateway，extension 中会承担更多 auth、route 和 confirmation 复杂度。
- Side Panel UI 容易膨胀成完整客户端，需要用 MVP 边界控制范围。

