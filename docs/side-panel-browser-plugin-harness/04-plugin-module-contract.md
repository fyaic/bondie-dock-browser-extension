# `bondie-side-panel` 模块契约

本文件定义“插件的插件”设计。目标是在 extension 内形成可拆模块，而不是把 Side Panel 直接写进 popup 或 background 的大 switch 里。

## 插件类型

当前仓库需要区分两类插件：

| 类型 | 示例 | 运行位置 | 用途 |
|---|---|---|---|
| script plugin | `extension/plugins/media-to-notes` | 浏览器外部脚本/本地 pipeline | 处理网页、视频、笔记产物 |
| feature module | `bondie-side-panel` | extension UI + background API | 注册浏览器 UI、状态、命令和 adapter |

Side Panel 属于 feature module。

## 建议目录

```text
extension/
├── src/
│   ├── modules/
│   │   └── bondie-side-panel/
│   │       ├── module.js
│   │       ├── session-adapter.js
│   │       ├── contract.js
│   │       ├── control-plane-contract.js
│   │       └── control-plane-adapter.js
│   └── sidepanel/
│       ├── sidepanel.html
│       ├── sidepanel.js
│       └── sidepanel.css
└── plugins/
    └── bondie-side-panel/
        └── plugin.json
```

说明：

- `src/modules` 放运行时代码，可由 background import。
- `src/sidepanel` 放浏览器 UI。
- `plugins/bondie-side-panel/plugin.json` 放模块元数据，便于后续 settings/registry 展示。

## 模块 manifest 草案

```json
{
  "id": "bondie-side-panel",
  "name": "OpenClaw Side Panel",
  "version": "0.1.0",
  "type": "extension-feature-module",
  "description": "OpenClaw conversation control and page-context side panel for Browser Host.",
  "entry": "src/modules/bondie-side-panel/module.js",
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
  "ownedBy": "bondie-dock-browser-extension"
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

Phase 7B 起，session message 支持 instance-level 参数：

```js
chrome.runtime.sendMessage({
  type: 'sidePanel.sessions.list',
  instanceId: 'bondie-b' // optional; "all" means aggregate
});

chrome.runtime.sendMessage({
  type: 'sidePanel.sessions.new',
  instanceId: 'legacy-session-bridge'
});

chrome.runtime.sendMessage({
  type: 'sidePanel.sessions.switch',
  instanceId: 'legacy-session-bridge',
  sessionId: '<target-session-id>'
});
```

约束：

- `instanceId="all"` 只用于 list aggregate，不用于 new/switch。
- legacy direct Bridge 只允许空 `instanceId` 或 `legacy-session-bridge`。
- 未知 instance 返回 `instance_unavailable`，不回退到全局 sessions。
- fixture instance action 返回 `fixture_read_only`，不调用真实 Bridge。

Phase 7C 起，生产 Bondie Control Plane contract 固化在
`extension/src/modules/bondie-side-panel/control-plane-contract.js`。Control Plane fetch 边界固化在
`extension/src/modules/bondie-side-panel/control-plane-adapter.js`。当前 adapter 已接入 `module.js` runtime；在 `sidePanelIdentityMode=oauth` + `sidePanelInstanceProvider=bondie-control-plane` 且 Control Plane URL/token 配置完整时，status/list/new/switch 都通过 Control Plane adapter 路由。缺 URL、缺 token、缺 host permission、未登录或实例未授权时仍 fail closed，不回退 legacy Bridge。

Control Plane endpoint 草案：

```text
GET  /v1/me
GET  /v1/bondie-instances
GET  /v1/bondie-instances/{instance_id}/sessions
POST /v1/bondie-instances/{instance_id}/sessions/new
POST /v1/bondie-instances/{instance_id}/sessions/switch
```

约束：

- `subordinate` 必须对应 `all_sessions`。
- `communication` 必须对应 `participant_sessions`。
- relationship / visibility 缺失或不匹配时 fail closed。
- `bondie-control-plane` provider 不允许 fallback 到 legacy Session Bridge。
- new/switch 完成态只看 explicit confirmation 字段，不能只看 HTTP 200 或 `ok=true`。
- 缺 Control Plane URL 或 OAuth token 时 adapter 不发请求。

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
  async listSessions(scope, options) {}
  async newConversation(scope, options) {}
  async switchSession(scope, sessionId, options) {}
  async sendSignal(scope, signal, payload) {}
}
```

约束：

- `newConversation` 不接受 `sessionId`。
- `switchSession` 必须接受 `sessionId`。
- `options.instanceId` 只作为 instance-level 路由上下文；最终授权由服务端控制面或 adapter gate 判定。
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
  bondieSidePanelModule
];
```

模块可以声明：

```js
export const bondieSidePanelModule = {
  id: 'bondie-side-panel',
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
  sidePanelIdentityMode: 'legacy-paired',
  sidePanelInstanceProvider: 'legacy-session-bridge',
  sidePanelControlPlaneBaseUrl: '',
  sidePanelWorkspaceId: 'default',
  sidePanelRouteKey: 'browser:default',
  sidePanelOAuthProvider: '',
  sidePanelSelectedInstanceId: ''
}
```

`sidePanelIdentityMode`：

| 值 | 用途 | 权限语义 |
|---|---|---|
| `legacy-paired` | 当前 direct Session Bridge 兼容路径 | 设备配对作为临时 viewer，只用于 legacy/dev mode |
| `oauth` | 生产用户身份路径 | 当前支持 dev-token provider；生产 OAuth provider 到位前只能用于本地 smoke/手测 |

当前实现：

- 默认 `legacy-paired` 不破坏现有真实 Bridge smoke。
- 切换到 `oauth` 后，必须通过 background token provider 返回 authenticated token。
- 没有 token 时返回 `identity_required`；有 dev token 时可进入 Control Plane runtime。
- OAuth mode 不请求 legacy Session Bridge，不把 device pairing 伪装成用户身份。

`sidePanelInstanceProvider`：

| 值 | 用途 | 当前行为 |
|---|---|---|
| `legacy-session-bridge` | 当前 Mac mini / direct Bridge 兼容路径 | 可读取 legacy scoped sessions |
| `bondie-control-plane` | 生产多 Bondie 权限控制面 | 已接入 Control Plane runtime adapter；缺 URL/token/permission 时 fail closed |

当前实现：

- 默认 `legacy-session-bridge` 不破坏真实 Bridge 26 sessions 路径。
- 切到 `bondie-control-plane` 时要求 OAuth identity；否则返回 `identity_required`。
- 不允许 control-plane provider 失败后 fallback 到 legacy sessions。

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
- `sidePanel.sessions.list({ instanceId })` 只能返回该实例的 groups/sessions。
- legacy adapter 对未知 `instanceId` 返回 `instance_unavailable`，不能回退展示全量。
- fixture adapter 对 new/switch 返回 `fixture_read_only`。
