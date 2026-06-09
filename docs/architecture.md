# OpenClaw Browser Host Extension 架构方案

日期：2026-06-09

## 背景

新的客户侧宿主形态优先考虑浏览器插件，而不是 Windows 本地安装程序。用户在 Edge 或 Chrome 安装插件后，OpenClaw 能触达用户浏览器上下文。

2026-05-15 产品会议后，插件定位从“OpenClaw 浏览器侧宿主”升级为“浏览器智能工作流 Agent 门户”。技术上仍复用 OpenClaw node 连接；产品上先把“当前页面交给 OpenClaw 处理”做成稳定主链路，再继续打磨 Pattern Memory 的低打扰智能感知。

## 当前主线形态

```text
Chrome / Edge Extension
├── Manifest V3
├── service worker
│   ├── Gateway WebSocket client
│   ├── capability dispatcher
│   ├── reconnect / heartbeat
│   ├── page service dispatcher
│   ├── pattern snapshot scheduler
│   ├── local pattern analyzer
│   └── chrome.storage.local config
├── popup
│   ├── connection status
│   ├── current page service actions
│   ├── notification / recent processing feed
│   ├── recoverable page suggestions
│   └── second-level settings and diagnostics
├── options page
│   ├── Gateway URL
│   ├── bootstrap/token config
│   ├── Media to Notes / workspace config
│   ├── pattern/privacy switches
│   └── permission notes
└── content script
    ├── current page summary
    ├── selected text
    └── explicit page share
```

## 能力设计

当前 alpha.11 远端可调用能力：

- `browser.notify`
- `browser.current_tab.info`
- `browser.current_tab.extract`
- `browser.downloads.summary`
- `browser.pattern.open`
- `browser.knowledge.capture`
- `user.confirm`

当前 alpha.11 用户侧主入口：

- 当前页面：入库为知识笔记，优先交给 OpenClaw / Media to Notes 规划处理。
- 当前页面：找库内关联，面向本地知识库和 Obsidian 图谱。
- 当前页面：发起深研，面向 DSearch / research report。
- 当前页面：Issue 草案，面向 Linear issue 草拟。
- 通知集合：展示处理中、完成、失败、TLDR 和产物路径，并可进入历史页。
- 可恢复页面：展示 Pattern Memory 的本地建议，支持打开/关闭反馈。

下一阶段产品能力重点：

- `browser.pattern.snapshot`
- `browser.pattern.detected`
- `browser.pattern.opened`
- `browser.context.capture`
- `browser.suggestion.show`
- `browser.suggestion.accepted`
- `browser.suggestion.dismissed`

暂不做：

- `files.read`
- `files.watch`
- `system.run`
- 全盘文件扫描
- 浏览器关闭后的常驻

## OpenClaw Node 连接模型

插件 service worker 直接连接 OpenClaw Gateway：

```text
Extension service worker -> wss://<openclaw-gateway>
```

注意：

- 纯插件不开放本地端口。
- 插件 service worker 生命周期由浏览器管理。
- WebSocket 断开后需重连。
- 推荐统一复用 OpenClaw node 后端能力，包括 pairing、device token、capability registry、invoke/result、event、审计和在线状态。
- 插件作为新的 node 类型：`browser-extension`。
- 产品化应改为短期 bootstrap + per-extension device token。

## 产品模块架构

```text
Browser Extension
├── Agent Connection
│   ├── OpenClaw node-compatible transport
│   ├── pairing / deviceToken
│   ├── invoke / result
│   └── event upload
├── Page Intelligence
│   ├── current tab metadata
│   ├── selected text / page preview
│   ├── Media to Notes owned plugin config
│   ├── knowledge note request
│   ├── related knowledge request
│   ├── research request
│   └── Linear issue draft request
├── Pattern Memory
│   ├── hourly tab/window snapshots
│   ├── local pattern store
│   ├── co-occurrence analyzer
│   ├── manual save current window
│   └── one-click open pattern
├── Notification / History UI
│   ├── pending / done / failed cards
│   ├── TLDR and output path
│   └── dismissible recent feed
├── Suggestion UI
│   ├── daily recap suggestions
│   ├── page-context suggestions
│   └── accept / dismiss feedback
└── Privacy Controls
    ├── pattern collection switch
    ├── upload switch
    ├── site scope controls
    └── clear local data
```

首期 Pattern 学习应保持简单：以同一窗口、同一时间快照中的 URL/origin 共现为主，不做复杂语义理解。这样满足会议中“先识别这些东西经常一起打开”的 MVP 目标。

## Browser Extension Node

推荐主线：

```text
OpenClaw Node Protocol
├── Windows Node / Bondie.exe
└── Browser Extension Node
```

浏览器插件本地持久化 Ed25519 设备身份。`hostId` 使用 public key 的 SHA-256 hex，与 Windows node 的 deviceId 思路保持一致。服务侧统一按 node 管理授权、能力、在线状态和撤销。

当前插件默认 `node-compatible`，同时保留 `browser-host` 作为备选/fallback，避免服务侧短期还未接入 node 协议时卡死。

## 权限策略

首版尽量小权限：

- `storage`
- `notifications`
- `tabs`
- `activeTab`
- `scripting`
- `downloads`

后续按能力细化：

- 页面内容读取优先使用 `activeTab` + 用户点击触发。
- 避免默认 `host_permissions: <all_urls>`。
- 需要域名 scope 时再请求具体 host permissions。
- 当前版本不默认注入全站 content script；用户在 popup 中主动触发页面读取或页面智能服务时，先通过 `chrome.permissions.request` 请求当前站点权限，再通过 `chrome.scripting.executeScript` 注入。
- Pattern Memory 首期默认只读取 tab/window 元数据，不读取页面正文。
- Context Capture 读取页面内容必须由用户主动点击触发。
- Pattern 数据优先本地存储，上传 OpenClaw 前做摘要化并受用户开关控制。

## OpenClaw Recap 数据流

```text
tabs/windows snapshot
  -> local pattern analyzer
  -> pattern detected / manual pattern
  -> OpenClaw Recap
  -> suggestion.show
  -> user accept/dismiss
  -> suggestion feedback event
```

OpenClaw 是“大脑”，负责基于 Recap、任务和历史上下文决定推荐什么；插件是“手脚”和“感知器”，负责浏览器上下文采集、展示建议和执行打开链接。

## 当前协议状态

`background.js` 已提供 OpenClaw node-compatible protocol 4 路径：

- Gateway challenge：`event/connect.challenge`
- 设备注册：`req/connect`
- 注册成功：`res/hello-ok`
- 心跳：`node.event` / `node.presence.alive`
- 远端调用：`event/node.invoke.request` 或 `req/node.invoke`
- 调用回传：`req/node.invoke.result` 或 `res/<node.invoke id>`
- 主动事件：`req/node.event`

`0.1.0-alpha.11` 已对齐 Gateway 2026.5.22 的 protocol 4 要求，`node-compatible` 握手声明 `minProtocol/maxProtocol = 4`。下一步重点不再是协议版本号，而是把页面智能服务的 OpenClaw 任务状态、知识笔记产物路径、TLDR、历史记录和失败恢复做成稳定闭环。

## 与 Windows exe 路线的关系

浏览器插件路线是新的主线，但不是完全替代 Windows exe。

- 插件适合浏览器上下文。
- Windows exe 适合系统上下文、本地目录、托盘、开机自启动。
- 如果后续需要两者结合，可采用 Extension + Native Messaging + Bondie native host。

## 多 Agent 策略

首期只支持 OpenClaw。代码结构上保留 Agent provider 边界，但不为了 Harmony、Mercury 等未来 Agent 过早改造传输层。

推荐分层：

```text
AgentProvider
└── OpenClawProvider
    └── OpenClaw node-compatible transport
```

后续若开源社区需要适配其他 Agent，再增加 provider。
