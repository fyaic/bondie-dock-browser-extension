# 浏览器插件 Side Panel 架构

## 目标架构

```text
Browser Extension
├── extension core
│   ├── manifest / permissions
│   ├── background service worker
│   ├── OpenClaw node-compatible transport
│   ├── device identity / pairing / deviceToken
│   ├── storage and settings
│   ├── capability dispatcher
│   └── feature module registry
├── feature modules
│   ├── popup shell
│   ├── page intelligence
│   ├── pattern memory
│   ├── media-to-notes script plugin
│   └── openclaw-side-panel UI module
└── adapters
    ├── session bridge HTTP adapter
    ├── OpenClaw Gateway adapter
    └── future native messaging adapter
```

## 第一阶段数据流

```text
User opens browser side panel
  -> sidepanel.js requests sidePanel.status
  -> background reads pairing/config/bridge status
  -> sidepanel.js requests sidePanel.sessions.list
  -> background session adapter calls bridge/Gateway
  -> sidepanel renders scoped sessions
  -> user confirms new/switch
  -> sidepanel sends sidePanel.sessions.new or sidePanel.sessions.switch
  -> background adapter executes action
  -> sidepanel gates success on confirmed fields
```

## 与当前 popup 的关系

Popup 适合短动作：

- 当前页解析。
- 通知/历史概览。
- Pattern 建议。
- 快速设置入口。

Side Panel 适合长停留：

- 对话列表。
- 当前会话状态。
- 新建/切换会话。
- 当前页面上下文和研究任务队列。

两者共享 background API，不互相调用 DOM 或复制状态。

## Manifest 规划

第一阶段需要评估并加入：

```json
{
  "permissions": [
    "sidePanel"
  ],
  "side_panel": {
    "default_path": "src/sidepanel/sidepanel.html"
  }
}
```

保持现有策略：

- 不添加默认 `<all_urls>`。
- 不默认全站 content script。
- 页面正文读取仍由用户主动点击触发。
- Side Panel 仅使用当前已授权的 extension API 和 background message。

## 信任边界

可信来源：

- extension 持久化 device identity。
- OpenClaw Gateway pairing/deviceToken。
- background service worker 中的配置。
- Session Bridge / OpenClaw Gateway 返回的 scoped sessions 和 confirmed result。

不可信来源：

- 网页 DOM。
- active tab title/url 中的推断身份。
- side panel UI 自己传入的 route label。
- content script 采集的正文。
- 用户手填的 display label。

## Session Scope 模型

浏览器插件不应在 UI 层使用 `WeComBinding`。建议定义通用 scope：

```json
{
  "scope_version": 1,
  "agent": "openclaw",
  "workspace_id": "default",
  "route_type": "browser",
  "route_key": "browser:default",
  "route_label": "Browser",
  "device_id": "<extension-host-id>",
  "operator_id": "<paired-user-id-or-local-profile>",
  "source": "browser-extension-side-panel"
}
```

如果调用旧 Session Bridge，可由 adapter 映射为旧字段。映射必须是显式且可测试的，不让 UI 直接拼旧字段。

## Adapter 策略

### Phase 1: Session Bridge HTTP Adapter

优点：

- 最快复用旧 B 侧 session list/new/switch 契约。
- OpenClaw route restore 和 confirmation 已封装在 B。
- 浏览器插件保持薄 UI 和薄控制面。

风险：

- 旧 B API 命名偏 WeCom，需要 adapter 隔离。
- 本地/远程 bridge URL 和 token 配置需要产品化。

### Phase 2: OpenClaw Gateway Adapter

优点：

- 可能减少一个本地服务。
- 复用当前 extension 到 Gateway 的 node-compatible 连接。

风险：

- extension 需要承担更多 session scope、mutation、confirmation 逻辑。
- Gateway 是否已有完整 generation list/restore RPC 需要确认。

### Phase 3: Native Messaging Adapter

仅当需要本地系统能力或浏览器 API 不足时考虑。它会改变安装成本，不进入 MVP。

## UI 状态机

```text
booting
  -> unpaired
  -> offline
  -> bridge_unavailable
  -> scope_unresolved
  -> loading_sessions
  -> ready
  -> confirming_action
  -> action_pending
  -> action_confirmed
  -> action_unconfirmed
  -> action_failed
```

UI 文案需要面向用户，不暴露底层错误为主标题。详细错误放在可展开 diagnostics。

## Browser 适配

Chrome：

- 第一阶段主目标。
- 当前 manifest 已声明 `minimum_chrome_version: "116"`。
- 使用 `sidePanel` permission 和 default path。

Edge：

- 作为 Chromium 近线目标。
- 复用 Chrome 实现，单独验证加载、权限、side panel 打开方式。

Safari：

- 不进入第一阶段实现。
- 后续单独评估 extension manifest、background 生命周期、侧栏/弹窗替代形态和分发流程。

