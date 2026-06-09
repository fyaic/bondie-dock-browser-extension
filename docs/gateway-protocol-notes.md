# Gateway 协议对齐记录

日期：2026-05-13

## 当前状态

主线改为复用 OpenClaw node 后端，浏览器插件作为一种新的 node 类型：`browser-extension`。

插件 `background.js` 当前默认 `node-compatible`，并按 Windows node 的真实 Gateway JSON-RPC 形态通信：

- Gateway -> 插件：`event/connect.challenge`
- 插件 -> Gateway：`req/connect`
- Gateway -> 插件：`res/hello-ok`
- Gateway -> 插件：`req/ping`
- Gateway -> 插件：`event/node.invoke.request`
- Gateway -> 插件：`req/node.invoke`
- 插件 -> Gateway：`req/node.invoke.result` 或 `res/<node.invoke id>`
- 插件 -> Gateway：`req/node.event`

同时保留 Browser Host Protocol fallback：

- `browser.host.register`
- `browser.host.registered`
- `browser.host.heartbeat`
- `browser.host.pong`
- `browser.host.invoke`
- `browser.host.invoke.result`
- `browser.host.event`

这样浏览器插件和 Windows/exe 可以共享同一套 pairing、identity、invoke/event、审计、权限模型。

2026-05-14 本地测试：

- `https://fuyo-aicmac-mini.tailc6f104.ts.net/health` 可达。
- 本地 mock Gateway 已验证 Ed25519 签名 `connect`、`hello-ok`、deviceToken 保存、`node.invoke.request` 和 `node.invoke.result`。
- 下一步需要用真实 Gateway 验证 node WebSocket path、Origin 策略、GatewayToken/BootstrapToken 和 approve 流程。

2026-06-09 protocol 4 / heartbeat hotfix：

- Gateway 2026.5.22 期望 protocol 4。
- Browser Host extension `0.1.0-alpha.11` 在 `node-compatible` 握手中声明 `minProtocol/maxProtocol = 4`。
- `node-compatible` 心跳使用 `node.event` / `node.presence.alive`，避免 node role 调用 RPC `ping` 被 Gateway 拒绝。
- 本地已安装实例的扩展 ID：`cljflebfgmekmnojaiaonfdjcmoonbpf`。
- 旧版 `0.1.0-alpha.7` 的 Gateway 日志症状：`code=1002 reason=protocol mismatch`，并伴随 `min=3 max=3 expected=4 probeMin=4`。

## 插件当前声明能力

- `browser.notify`
- `browser.current_tab.info`
- `browser.current_tab.extract`
- `browser.downloads.summary`
- `user.confirm`

## Browser Extension Node 协议

### connect

插件先等待 Gateway 下发：

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": {
    "nonce": "<gateway-nonce>",
    "ts": 1778740000000
  }
}
```

随后插件发送：

```json
{
  "type": "req",
  "id": "<request-id>",
  "method": "connect",
  "params": {
    "minProtocol": 4,
    "maxProtocol": 4,
    "client": {
      "id": "node-host",
      "version": "0.1.0-alpha.11",
      "platform": "browser",
      "mode": "node",
      "displayName": "OpenClaw Browser Host"
    },
    "role": "node",
    "scopes": [],
    "caps": ["browser", "user"],
    "commands": [
      "browser.notify",
      "system.notify",
      "browser.current_tab.info",
      "browser.current_tab.extract",
      "browser.downloads.summary",
      "user.confirm"
    ],
    "permissions": {},
    "auth": {
      "token": "<gateway-or-device-token>"
    },
    "device": {
      "id": "<sha256-public-key-hex>",
      "publicKey": "<ed25519-public-key-base64url>",
      "signature": "<signature-base64url>",
      "signedAt": 1778740000000,
      "nonce": "<gateway-nonce>"
    }
  }
}
```

### invoke

服务侧可以用事件形态调用插件能力：

```json
{
  "type": "event",
  "event": "node.invoke.request",
  "payload": {
    "requestId": "req_123",
    "command": "browser.current_tab.info",
    "args": {}
  }
}
```

插件返回：

```json
{
  "type": "req",
  "method": "node.invoke.result",
  "id": "req_123",
  "params": {
    "id": "req_123",
    "nodeId": "<node-or-device-id>",
    "ok": true,
    "payload": {}
  }
}
```

### event

插件主动上报：

```json
{
  "type": "req",
  "method": "node.event",
  "params": {
    "event": "notification.clicked",
    "payloadJSON": "{}"
  }
}
```

## 需要向服务侧确认的问题

1. 现有 OpenClaw node WebSocket path 是否可直接复用。
2. Tailscale Serve 后的 Gateway 是否允许 `Origin: chrome-extension://<id>`。
3. 首次安装用 GatewayToken 手动 approve，还是 BootstrapToken 自动 pairing。
4. 服务侧是否接受 `platform=browser`、`caps=["browser","user"]` 和浏览器命令列表。
5. 服务侧 allowlist 是否允许 `browser.notify`、`browser.current_tab.info` 等命令。
6. 浏览器 service worker 断线重连后，device identity 是否复用。
7. Browser Host Protocol fallback 是否需要独立 endpoint，例如 `/browser-host/ws`。

## 建议方向

优先复用 OpenClaw node 后端。浏览器插件与 Windows/exe 共用后端服务、CLI、agent skill、审计和权限体系，长期维护成本更低。

建议保持：

- per-extension hostId/deviceId。
- bootstrap/enrollment。
- deviceToken 持久化在 `chrome.storage.local`。
- paired 是设备授权状态，online/offline 是 WebSocket 连接状态；两者不能混用。
- 浏览器 MV3 需要 keepalive 和快速重连，避免 service worker 生命周期导致用户感知为反复配对。
- 能力 allowlist 明确上报。
- invoke result 和 event 都带 requestId。
