# `openclaw-side-panel` 模块契约

本文件定义“插件的插件”设计。目标是在 extension 内形成可拆模块，而不是把 Side Panel 直接写进 popup 或 background 的大 switch 里。

## 插件类型

当前仓库需要区分两类插件：

| 类型 | 示例 | 运行位置 | 用途 |
|---|---|---|---|
| script plugin | `extension/plugins/media-to-notes` | 浏览器外部脚本/本地 pipeline | 处理网页、视频、笔记产物 |
| feature module | `openclaw-side-panel` | extension UI + background API | 注册浏览器 UI、状态、命令和 adapter |

Side Panel 属于 feature module。

## 建议目录

```text
extension/
├── src/
│   ├── modules/
│   │   └── openclaw-side-panel/
│   │       ├── module.js
│   │       ├── session-adapter.js
│   │       └── contract.js
│   └── sidepanel/
│       ├── sidepanel.html
│       ├── sidepanel.js
│       └── sidepanel.css
└── plugins/
    └── openclaw-side-panel/
        └── plugin.json
```

说明：

- `src/modules` 放运行时代码，可由 background import。
- `src/sidepanel` 放浏览器 UI。
- `plugins/openclaw-side-panel/plugin.json` 放模块元数据，便于后续 settings/registry 展示。

## 模块 manifest 草案

```json
{
  "id": "openclaw-side-panel",
  "name": "OpenClaw Side Panel",
  "version": "0.1.0",
  "type": "extension-feature-module",
  "description": "OpenClaw conversation control and page-context side panel for Browser Host.",
  "entry": "src/modules/openclaw-side-panel/module.js",
  "ui": {
    "sidePanel": "src/sidepanel/sidepanel.html"
  },
  "capabilities": [
    "openclaw.sessions.list",
    "openclaw.sessions.new",
    "openclaw.sessions.switch",
    "openclaw.sessions.signal"
  ],
  "permissions": [
    "sidePanel",
    "storage"
  ],
  "ownedBy": "openclaw-browser-host-extension"
}
```

## Background message API

Side Panel UI 只通过 `chrome.runtime.sendMessage` 与 background 通信。

```text
sidePanel.status
sidePanel.bridge.status
sidePanel.identity.status
sidePanel.instances.list
sidePanel.sessions.list
sidePanel.sessions.new
sidePanel.sessions.switch
sidePanel.sessions.signal
sidePanel.scope.current
sidePanel.settings.get
sidePanel.settings.update
```

建议响应形态：

```json
{
  "ok": true,
  "payload": {},
  "error": null,
  "diagnostic": {}
}
```

错误响应：

```json
{
  "ok": false,
  "error": "bridge_unavailable",
  "message": "OpenClaw Session Bridge 暂不可用",
  "diagnostic": {
    "reason": "fetch_failed"
  }
}
```

## Adapter 接口

```js
export class OpenClawSessionAdapter {
  async status() {}
  async listSessions(scope) {}
  async newConversation(scope, options) {}
  async switchSession(scope, sessionId, options) {}
  async sendSignal(scope, signal, payload) {}
}
```

约束：

- `newConversation` 不接受 `sessionId`。
- `switchSession` 必须接受 `sessionId`。
- adapter 返回原始 confirmation 字段，但 UI 通过统一 helper 判断完成态。

## Confirmation helper

```js
export function isNewConversationConfirmed(result) {
  return result?.new_conversation_confirmed === true;
}

export function isRouteSwitchConfirmed(result) {
  return result?.route_switch_confirmed === true;
}
```

不允许在 UI 中用 `result.ok === true` 或 `response.ok === true` 判断业务完成。

## 能力注册

background 需要从硬编码 switch 逐步走向模块注册，但第一阶段保持 KISS：

```js
const FEATURE_MODULES = [
  openClawSidePanelModule
];
```

模块可以声明：

```js
export const openClawSidePanelModule = {
  id: 'openclaw-side-panel',
  messages: {
    'sidePanel.status': handleStatus,
    'sidePanel.sessions.list': handleListSessions
  },
  capabilities: [
    'openclaw.sessions.list',
    'openclaw.sessions.new',
    'openclaw.sessions.switch'
  ]
};
```

第一阶段不需要动态加载远程代码，不允许从网络安装 feature module。

## 设置项

建议新增配置，默认关闭或显式 beta：

```js
{
  sidePanelEnabled: true,
  sidePanelAdapter: 'session-bridge',
  sessionBridgeBaseUrl: '',
  sessionBridgeToken: '',
  sessionBridgeTimeoutMs: 20000,
  sidePanelWorkspaceId: 'default',
  sidePanelRouteKey: 'browser:default',
  sidePanelOAuthProvider: '',
  sidePanelSelectedInstanceId: ''
}
```

密钥处理：

- token 存在 `chrome.storage.local`，不打印到日志。
- UI 只显示已配置/未配置，不显示完整 token。
- debug export 必须脱敏。
- OAuth token 或 refresh token 不进入普通 operation card、history 或 console-safe diagnostics。
- instance/relationship 权限结果只作为展示和请求上下文，最终授权仍由服务端控制面判定。

## 测试契约

实现时必须覆盖：

- module registry 能路由 `sidePanel.*` 消息。
- disabled module 返回明确 disabled 状态。
- missing bridge config 返回 setup required，不发请求。
- `newConversation` payload 不含 `session_id`。
- `switchSession` 缺少 session id 时拒绝。
- unconfirmed result 不进入 completed UI。
- token 不出现在 history、operation card、console-safe diagnostics。
- 未完成 OAuth 时返回 `identity_required`，不请求 session list。
- 从属关系和沟通关系的 visibility policy 在 UI 中可区分。
- 沟通关系不会展示非当前用户相关 sessions。
