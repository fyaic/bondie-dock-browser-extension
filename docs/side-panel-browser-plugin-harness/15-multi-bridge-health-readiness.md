# Multi-Bridge Health And Readiness Gate

日期：2026-06-18

## 目标

多 Bondie 场景下，Control Plane 需要同时掌握多台 Session Bridge 的健康状态，并把它投影到 Side Panel：

- 哪些 Bondie 实例 online。
- 哪些实例 degraded/offline。
- 哪些实例能 list sessions。
- 哪些实例允许 new/switch action。

健康状态不能提升权限。它只能决定是否调用 bridge、如何展示状态、是否禁用 action。

## 分层模型

```text
bridge probe result
  -> bridge_health_snapshots
  -> instance_bridge_binding readiness
  -> bondie instance projection
  -> Side Panel status/chip/session group
```

权限仍来自：

```text
OAuth user -> user_instance_relationship -> visibility_policy
```

## Probe 维度

| 维度 | 方法 | 成功标准 | 失败状态 |
|---|---|---|---|
| network | `GET /health` | HTTP 200 | `offline` / `timeout` |
| auth | `GET /v1/bridge` with token | HTTP 200 | `unauthorized` |
| metadata | `/v1/bridge` payload | `bridge_id` 匹配 registry | `misconfigured` |
| capability | `/v1/bridge.capabilities` | 包含所需 action | `degraded` |
| session list | scoped `/v1/sessions` canary | 返回 scoped sessions 或明确 unresolved | `sessions_degraded` |
| latency | probe timing | 低于阈值 | `degraded` |

`/health` 不需要 token，只证明进程可达。`/v1/bridge` 需要 token，证明 Control Plane 可以用服务端 secret 调用该 bridge。

## 状态枚举

### Bridge State

| 状态 | 含义 | Side Panel 行为 |
|---|---|---|
| `online` | network/auth/metadata 基本通过 | 可展示 instance，允许按 capability 调用 |
| `degraded` | bridge 可达但 session/action readiness 弱 | 展示 instance，sessions/action 可禁用或提示 |
| `offline` | network timeout 或进程不可达 | 展示离线，sessions 不请求 |
| `unauthorized` | token 错误或 secret 失效 | 不请求 sessions，提示控制面配置异常 |
| `misconfigured` | bridge_id 不匹配或 metadata 无效 | 不请求 sessions，要求运维修复 |
| `disabled` | registry 手动禁用 | 不返回普通用户 projection |

### Instance Readiness

| 状态 | 来源 |
|---|---|
| `ready` | relationship active + instance active + primary bridge online |
| `degraded` | relationship active + instance active + primary bridge degraded |
| `offline` | primary bridge offline |
| `permission_unresolved` | relationship 缺失或无效 |
| `instance_unavailable` | instance 不存在、disabled、binding 无效 |

## 聚合规则

### Single Primary

本期默认每个 instance 只有一个 active primary bridge：

```text
instance_readiness = primary_bridge_state mapped through relationship gate
```

如果 primary bridge offline：

- instance projection 可以显示 `status=offline`。
- `sessions` 返回空，state 为 `instance_unavailable` 或 `bridge_unavailable`。
- 不 fallback 到 legacy Session Bridge。
- 不自动切 standby。

### Standby

standby binding 只用于诊断和人工切换。本期不做自动 failover。

自动 failover 需要额外设计：

- session consistency。
- action idempotency。
- audit log。
- operator approval。
- rollback。

## Probe 频率

建议起步：

| Probe | 频率 | 说明 |
|---|---|---|
| `/health` | 30s - 60s | 轻量，可用于在线状态 |
| `/v1/bridge` | 60s - 120s | 验证 token、metadata、capabilities |
| scoped `/v1/sessions` canary | 5min 或手动 | 只能使用明确测试 scope，不做全局 sessions |
| action readiness | 不做定时 | 由真实 new/switch action confirmation 决定 |

避免对所有用户 session 做定时扫描。健康检查不能变成隐形数据抓取。

## 缓存和 Stale

Control Plane 返回给 Side Panel 的 health projection 应包含：

```json
{
  "status": "degraded",
  "health": {
    "state": "sessions_degraded",
    "checked_at": "2026-06-18T08:00:00Z",
    "stale": false,
    "latency_ms": 820,
    "sessions_ready": false
  }
}
```

规则：

- `checked_at` 超过 TTL 时标记 `stale=true`。
- stale 不提升为 online。
- stale + 最近失败应显示 degraded/offline。
- UI 不展示 raw token、endpoint、debug timings。

## Side Panel 映射

| Control Plane 状态 | Instance chip | Group 行为 | Action |
|---|---|---|---|
| `ready` | online | 正常 list | 按 capability 开启 |
| `degraded` | degraded | 可显示缓存/空态和诊断 | 默认禁用或二次确认 |
| `offline` | offline | 不请求 sessions | 禁用 |
| `unauthorized` | error | 不请求 sessions | 禁用 |
| `misconfigured` | error | 不请求 sessions | 禁用 |

Side Panel 仍必须显示 relationship badge：

- `查看全部`
- `仅相关`

健康状态不能替代权限 badge。

## Control Plane API Projection

`GET /v1/bondie-instances` 可附带 health 摘要：

```json
{
  "instance_id": "bondie-a",
  "display_name": "Bondie A",
  "relationship_type": "subordinate",
  "visibility_policy": "all_sessions",
  "status": "degraded",
  "actions_enabled": false,
  "health": {
    "state": "sessions_degraded",
    "checked_at": "2026-06-18T08:00:00Z",
    "stale": false
  }
}
```

禁止附带：

- bridge endpoint。
- bridge token。
- full debug response。
- 其他用户 session 统计。

## Readiness Gate

### list instances

```text
if no OAuth:
  identity_required
else:
  return active relationships + instance projection
```

`list instances` 可以返回 degraded/offline 实例，让用户知道某个 Bondie 暂不可用。

### list sessions

```text
if no relationship:
  permission_unresolved
elif relationship/policy mismatch:
  permission_unresolved
elif bridge not online:
  bridge_unavailable
else:
  call bridge and apply visibility filter
```

### new/switch

```text
if no explicit user action:
  reject
elif no relationship:
  permission_unresolved
elif instance actions disabled:
  instance_action_unavailable
elif bridge not online:
  bridge_unavailable
elif bridge response lacks confirmation:
  action_unconfirmed
else:
  action_confirmed
```

## 观测与告警

最小告警：

- bridge offline 连续 N 次。
- `/v1/bridge` unauthorized。
- registry bridge_id 与 `/v1/bridge.bridge_id` 不一致。
- relationship/policy 不匹配被过滤。
- sessions canary 连续 timeout。

告警不能包含 token、完整 session 内容或他人会话标题。

## 自动化测试

应覆盖：

- online bridge -> instance `ready`。
- `/health` timeout -> instance `offline`。
- `/v1/bridge` 401 -> `unauthorized`。
- bridge_id mismatch -> `misconfigured`。
- no relationship -> no sessions。
- communication relationship cannot request all sessions。
- degraded bridge disables action。
- stale health does not become online。

## 当前落地状态

- Browser extension 已有 `BondieControlPlaneAdapter` runtime，并已通过 Control Plane dev token 的模块级只读 smoke。
- Contract smoke 已覆盖缺 URL、缺 token、权限不匹配过滤和 message layer OAuth fail-closed。
- Control Plane 服务端已实现 bridge health projection，并把 stale/unavailable 映射为 action-disabled 的安全实例投影。
- 本文继续作为后续多设备 registry、真实 OAuth 和跨设备部署 issue 的实现边界。
