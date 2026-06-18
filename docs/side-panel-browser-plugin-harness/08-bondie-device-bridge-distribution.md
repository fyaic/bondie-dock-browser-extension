# Bondie 设备 Bridge 与标准分发规划

日期：2026-06-17

## 核心结论

每个真实运行 Bondie/OpenClaw 的设备，都需要一个本地控制面组件。当前可复用的形态就是 `openclaw-session-bridge`：

```text
Bondie device
  -> local OpenClaw Gateway/session store
  -> local Session Bridge
  -> Tailscale/private network
  -> Bondie control plane / registry
  -> Browser Side Panel
```

没有私网互联或可达的控制面，Side Panel 就拿不到该设备上的 session 信息。

## 当前已存在能力

`openclaw-session-bridge` 已有：

- FastAPI HTTP API。
- `/health`。
- `/v1/bridge` metadata。
- `/v1/sessions`。
- `/v1/sessions/new`。
- `/v1/switch-session`。
- Gateway adapter。
- macOS launchd 模板。
- Linux systemd 模板。
- `.env.production.example`。
- `scripts/smoke_check.sh`。
- 设备迁移和标准分发文档。

当前 Mac mini 现场：

```text
URL: http://100.79.143.105:8766
bridge_id: mac-mini-session-bridge
adapter: gateway
OpenClaw Gateway: local loopback 127.0.0.1:18789
service model: uvicorn long-running process
```

## 单设备模式和多设备模式

### 单设备模式

当前已跑通的是单设备模式：

```text
Side Panel / A
  -> one configured bridge URL
  -> one Bondie/OpenClaw device
```

优点：

- 配置简单。
- 适合本地开发和单人私助。

限制：

- 无法表达 ABC 多 Bondie。
- 无法让同一用户按关系访问多个实例。
- endpoint 和 token 需要手动配置。

### 多设备模式

新需求需要多设备模式：

```text
Browser Extension
  -> Bondie control plane
  -> bridge registry
    -> Bondie A bridge
    -> Bondie B bridge
    -> Bondie C bridge
```

控制面负责：

- OAuth user identity。
- 用户与 Bondie instance 的关系。
- instance -> bridge endpoint 路由。
- bridge token 管理。
- health/readiness 聚合。
- session visibility policy。

每个 bridge 仍只负责自己的本地 OpenClaw。

## Bridge Registry 草案

详细字段和约束见 `13-bridge-registry-schema.md`。本节只保留核心形态。

```json
{
  "instance_id": "bondie-a",
  "bridge_id": "openclaw-a",
  "bridge_name": "Bondie A on Mac mini",
  "endpoint": "http://bondie-a.tailnet:8766",
  "network": "tailscale",
  "capabilities": [
    "list_sessions",
    "switch_session",
    "start_new_conversation"
  ],
  "health": {
    "state": "online",
    "checked_at": "2026-06-17T00:00:00Z"
  }
}
```

Secrets such as `SESSION_BRIDGE_TOKEN` must remain server-side in the control plane or deployment secret store. The browser extension should not store tokens for every Bondie device.

## Device Onboarding

可执行清单见 `14-device-onboarding-checklist.md`。本节只保留摘要。

每个新 Bondie 设备的标准流程：

1. 安装 OpenClaw/Bondie runtime。
2. 确认本机 OpenClaw Gateway 可用。
3. 加入 Tailscale 或等价私网。
4. 安装 Session Bridge。
5. 设置稳定 `SESSION_BRIDGE_ID` 和 `SESSION_BRIDGE_NAME`。
6. 设置强随机 `SESSION_BRIDGE_TOKEN`。
7. 以 launchd/systemd 长期运行。
8. 从 control plane 所在网络执行 `/health` 和 `/v1/bridge` smoke。
9. 注册到 bridge registry。
10. 绑定到一个或多个 Bondie instance。

## 标准配置

```env
SESSION_BRIDGE_TOKEN=<strong-random-token>
SESSION_BRIDGE_ID=<stable-bondie-device-id>
SESSION_BRIDGE_NAME=Bondie Bridge - <device-name>

OPENCLAW_ADAPTER=gateway
OPENCLAW_GATEWAY_TIMEOUT=10000
OPENCLAW_SESSION_LIST_LIMIT=50
OPENCLAW_INCLUDE_LAST_MESSAGE=true
OPENCLAW_INCLUDE_SESSION_GENERATIONS=true
```

当前已知 `/v1/sessions` 可能因 Gateway `sessions.list` 超时返回 504。标准分发前需要在 B 侧补：

- 分段 timing debug。
- exact key 命中短路。
- 可观测的 Gateway timeout 错误。
- health 不只检查 process alive，还要检查 session list readiness。

## 网络要求

推荐默认拓扑：

```text
Browser Extension
  -> public HTTPS Bondie control plane
  -> Tailscale/private network
  -> per-device bridge
```

不推荐默认拓扑：

```text
Browser Extension
  -> direct Tailscale to every Bondie bridge
```

原因：

- 需要用户浏览器设备进入多个 tailnet 或 ACL。
- bridge tokens 会下发到 extension。
- endpoint 配置成本高。
- 很难做统一权限审计。

保留直连模式：

- 本地开发。
- 单设备高级用户。
- 内部 smoke。

## Side Panel 需要的聚合 API

浏览器插件理想上只调用控制面：

```text
GET /v1/me
GET /v1/bondie-instances
GET /v1/bondie-instances/{instance_id}/sessions
POST /v1/bondie-instances/{instance_id}/sessions/new
POST /v1/bondie-instances/{instance_id}/switch-session
```

控制面内部再调用：

```text
GET  bridge /v1/bridge
GET  bridge /v1/sessions
POST bridge /v1/sessions/new
POST bridge /v1/switch-session
```

这样浏览器不需要知道每台设备的 token、Tailscale 地址和 OpenClaw Gateway 细节。

## 权限与网络的关系

网络可达不等于有权限。

- Tailscale 只解决 control plane 到 bridge 的可达性。
- OAuth 解决当前用户是谁。
- Relationship policy 解决用户能看哪个 Bondie。
- Visibility policy 解决能看全量还是仅相关 sessions。
- Bridge/Gateway 解决具体 session 读写和 confirmation。

任何一层失败都必须 fail closed。

## 标准分发缺口

当前 B 侧已有一对一标准分发基础，但 Bondie 多实例还缺：

- Bridge registry 服务。字段草案已见 `13-bridge-registry-schema.md`。
- Instance -> bridge 绑定模型。字段草案已见 `13-bridge-registry-schema.md`。
- OAuth user -> instance relationship 模型。字段草案已见 `13-bridge-registry-schema.md`。
- 控制面到多 bridge 的 token/secret 管理。
- 多设备 health aggregation。
- Session list cache 和超时降级策略。
- 多实例 fixtures 和 E2E smoke。
- 安装包或脚本化 bootstrap。

## 推荐拆分

- Browser extension: 多实例 UI、identity 状态、instances list、legacy direct bridge dev mode。
- Bondie control plane: OAuth、relationship、registry、bridge proxy、secret 管理。
- Session Bridge: 每设备本地 adapter、Gateway 性能修复、metadata、标准分发。
- OpenClaw Gateway: session list/restore/new 的正式能力和性能稳定性。
