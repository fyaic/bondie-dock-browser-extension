# OpenClaw Browser Side Panel PRD

日期：2026-06-11

## 背景

旧 Side Panel 解决的是企业微信聊天窗口缺少 AI 会话管理能力的问题。浏览器插件新主线要脱离企业微信自建应用环境，把 Bondie/OpenClaw 会话控制做成浏览器插件内的侧栏能力。

浏览器插件当前定位已经升级为“浏览器智能工作流 Agent 门户”。Side Panel 是这个门户里的长期主视图：用户可以看到 OpenClaw 当前状态、会话列表、当前页面上下文和后续工作流入口。

2026-06-17 新增权限口径：团队产品名使用 Bondie。浏览器插件是用户视角，不是设备视角。一个用户可能同时与多个 Bondie/OpenClaw 实例交互，包括个人私助、团队共享班底和他人分享的班底。Side Panel 必须通过 OAuth 或等价身份体系识别用户，并按关系类型隔离 session 数据。

## 用户故事

作为 OpenClaw 用户，我希望在浏览器右侧打开一个 OpenClaw 面板，以便查看和切换历史对话，而不必回到企业微信或独立桌面应用。

作为重度浏览器用户，我希望 Side Panel 能基于当前页面发起 OpenClaw 任务，以便把文章、视频、GitHub 仓库或普通网页快速变成摘要、笔记或深度调研。

作为多设备用户，我希望插件侧的会话状态来自可信 OpenClaw 控制面，以便切换和新开对话不会因为浏览器本地状态失真而误导我。

作为后续开发者，我希望 Side Panel 是可拆卸模块，以便它能独立迭代，不破坏已有 popup、Pattern Memory 和页面解析主链路。

作为拥有私助的用户，我希望在从属关系下查看该私助的全部会话历史，包括该私助与其他人的对话，以便管理和回顾私有助理的完整工作。

作为团队班底或他人分享班底的使用者，我只能查看自己与该班底相关的会话，以便团队服务可用但不会泄露他人的对话。

作为同时使用多个班底实例的用户，我希望 Side Panel 按实例和权限范围组织会话，而不是只绑定到单一设备或单一账号。

## 本期包含

- Chrome/Edge Chromium Side Panel 入口规划。
- OpenClaw session list/new/switch MVP。
- 当前连接、配对、bridge、scope 的状态展示。
- 二次确认：切换历史会话、新开对话都需要明确确认。
- Confirmation-gated UI：只有 confirmed 字段为 true 才显示完成。
- “插件的插件”模块契约：module manifest、background API、消息命名、能力开关。
- 身份与权限模型冻结：从属关系、沟通关系、OAuth 用户身份、多班底实例和 session 可见性。
- Bondie ABC 多实例 UI 信息架构：默认合集分组 + 实例切换器。
- 多设备 bridge / Tailscale / registry / 标准分发规划。
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
- 完整 OAuth 生产接入和权限服务实现。
- 多班底实例 registry 的生产后端实现。
- 多设备 bridge registry 的生产实现。

## MVP 页面结构

```text
OpenClaw Side Panel
├── Header
│   ├── OpenClaw 状态
│   ├── 当前 node / device pairing 状态
│   └── 刷新 / 设置入口
├── Current Scope
│   ├── workspace / route / browser context
│   ├── OAuth user / permission status
│   └── bridge adapter status
├── Conversation List
│   ├── instance groups
│   ├── current generation
│   ├── historical generations
│   ├── 从属关系：查看全部
│   ├── 沟通关系：仅查看相关
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
  "viewer_user_id": "<oauth-user-id>",
  "instance_id": "<openclaw-or-agent-instance-id>",
  "relationship_type": "subordinate",
  "visibility_policy": "all_sessions",
  "browser_context": {
    "tab_id": 123,
    "url": "https://example.com",
    "title": "Example"
  }
}
```

如果第一阶段复用旧 B API，可以由 adapter 做临时映射，不要求 UI 层暴露 `wecom_user_id` 等旧字段。

沟通关系必须使用 `visibility_policy=participant_sessions`，只能返回当前用户相关 sessions。

## 验收标准

- 新分支有自包含文档，后续 agent 5 分钟内能知道从哪里开始。
- Side Panel 设计不依赖 WeCom OAuth、JS-SDK、panel token 或企业微信域名配置。
- Side Panel 设计明确需要 OpenClaw/AIC OAuth 或等价用户身份，且不把 device pairing 当成用户身份。
- Side Panel 权限模型明确支持从属关系和沟通关系。
- 从属关系可查看该班底全部 sessions；沟通关系只查看当前用户相关 sessions。
- 多班底实例按用户权限聚合展示，不再假设一个账号只对应一个实例。
- Side Panel UI 默认采用“全部合集 + 按 Bondie 实例分组”的布局，并提供实例切换器。
- 多设备场景不要求浏览器直连每台 bridge；默认通过 Bondie control plane 聚合。
- 架构中明确哪些能力来自 extension core，哪些能力来自 `openclaw-side-panel` 模块。
- new/switch 行为保持旧 B 侧安全语义：new 不带 generation id，switch 必须校验 generation id。
- UI 状态明确区分：offline、unpaired、bridge unavailable、scope unresolved、empty sessions、unconfirmed operation、confirmed operation。
- 测试计划覆盖 contract、权限、service worker 生命周期、side panel 打开路径、文字溢出和关键空态。

## 主要风险

- MV3 service worker 生命周期导致 Side Panel 打开时 background 状态冷启动。
- 浏览器 sidePanel API 在 Chrome/Edge 可用，但 Safari 需要不同模型。
- 旧 B API 仍是 WeCom 命名，直接复用会污染新浏览器模型。
- 如果只按账号登录做一人一账号隔离，会无法表达 N 对 N 的用户/班底关系。
- 如果只依赖 device pairing，会把设备视角误当成用户视角，导致数据隔离错误。
- 如果绕过 Session Bridge 直接调 Gateway，extension 中会承担更多 auth、route 和 confirmation 复杂度。
- Side Panel UI 容易膨胀成完整客户端，需要用 MVP 边界控制范围。
