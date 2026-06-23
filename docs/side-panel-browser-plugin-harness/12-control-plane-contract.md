# Bondie Control Plane Contract

日期：2026-06-18

## 目标

本文件冻结浏览器 Side Panel 与 Bondie Control Plane 的最小生产契约。它解决三件事：

- 当前用户是谁：OAuth 或等价身份服务返回 viewer。
- 当前用户能访问哪些 Bondie 实例：每个实例必须带 relationship 和 visibility policy。
- 每个实例下可见 sessions 以及 new/switch action 的完成确认。

当前分支已实现 contract helper：`extension/src/modules/bondie-side-panel/control-plane-contract.js`，以及 runtime adapter：`extension/src/modules/bondie-side-panel/control-plane-adapter.js`。`sidePanelIdentityMode=oauth` 且 `sidePanelInstanceProvider=bondie-control-plane` 时，Dock 会通过 background token provider 调用 Control Plane；开发期可使用 Options 中的 Control Plane dev token，本地只读 smoke 已验证 2 个实例、27 条 sessions。生产 OAuth token provider 等登录授权系统文档到位后替换。

命名边界：Browser Side Panel 是本仓库的前端 UI；Bondie Control Plane 是服务侧 API / 控制面，不是 Side Panel 页面。Control Plane 内部再通过 bridge registry 和 bridge secret store 调用每台 Bondie 设备上的 OpenClaw Session Bridge。系统拆分见 `18-system-boundary-and-repo-plan.md`。

## 不做什么

- 不让浏览器直连所有 Bondie 设备 bridge。
- 不把每台 bridge token 下发到 extension。
- 不用 device pairing 代替 user identity。
- 不在 Control Plane adapter 缺失时 fallback 到 legacy Session Bridge。
- 不用 `ok=true` 作为 new/switch 业务完成标准。

## Endpoint

| 用途 | Method | Path |
|---|---|---|
| 当前用户身份 | `GET` | `/v1/me` |
| 当前用户可访问实例 | `GET` | `/v1/bondie-instances` |
| 实例 session 列表 | `GET` | `/v1/bondie-instances/{instance_id}/sessions` |
| 实例新开 session | `POST` | `/v1/bondie-instances/{instance_id}/sessions/new` |
| 实例切换 session | `POST` | `/v1/bondie-instances/{instance_id}/sessions/switch` |

所有请求必须使用 OAuth bearer token 或等价用户令牌。令牌只存在 background/adapter 层，不进入普通 UI payload、operation card、history 或 diagnostics。

## Identity Response

```json
{
  "authenticated": true,
  "source": "oauth",
  "viewer": {
    "user_id": "veil",
    "display_name": "Veil",
    "email": "veil@example.com"
  }
}
```

缺少 `viewer.user_id` 时视为 `identity_required`。只有 device pairing、browser host id、route label 都不能视作已登录用户。

## Instances Response

```json
{
  "instances": [
    {
      "instance_id": "bondie-a",
      "display_name": "Bondie A",
      "relationship_type": "subordinate",
      "visibility_policy": "all_sessions",
      "roles": ["owner"],
      "bridge_id": "openclaw-a",
      "status": "online",
      "capabilities": ["sessions.list", "sessions.new", "sessions.switch"]
    },
    {
      "instance_id": "bondie-b",
      "display_name": "Bondie B",
      "relationship_type": "communication",
      "visibility_policy": "participant_sessions",
      "roles": ["participant"],
      "bridge_id": "openclaw-b",
      "status": "online"
    }
  ]
}
```

强约束：

- `subordinate` 只能对应 `all_sessions`。
- `communication` 只能对应 `participant_sessions`。
- 缺少 relationship 或 visibility policy 的实例必须被过滤或返回 `permission_unresolved`。
- 沟通关系不能通过 URL、搜索、route label、device pairing、instance id 枚举提升到全量 sessions。

## Sessions Response

```json
{
  "instance": {
    "instance_id": "bondie-b",
    "display_name": "Bondie B",
    "relationship_type": "communication",
    "visibility_policy": "participant_sessions",
    "status": "online"
  },
  "sessions": [
    {
      "session_id": "sess-123",
      "session_key": "bondie-b:veil:123",
      "title": "产品讨论",
      "summary": "Veil 与 Bondie B 的沟通会话",
      "updated_at": "2026-06-18T10:00:00Z",
      "is_current": true,
      "restorable": true,
      "last_messages": []
    }
  ]
}
```

Control Plane 必须在服务端完成过滤。浏览器 helper 只做规范化和 UI 标注，不承担最终授权。

## Action Response

新开 session：

```json
{
  "operation_status": "confirmed",
  "new_conversation_confirmed": true,
  "session": {
    "session_id": "sess-456",
    "title": "新会话"
  }
}
```

切换 session：

```json
{
  "operation_status": "confirmed",
  "session_switch_confirmed": true,
  "session": {
    "session_id": "sess-123",
    "is_current": true
  }
}
```

完成态判断：

- new 只认 `new_conversation_confirmed=true`。
- switch 只认 `session_switch_confirmed=true`；legacy proxy 可兼容 `route_switch_confirmed=true`。
- `ok=true`、HTTP 200、`delivery_status=sent` 都不能单独表示业务完成。

## Extension Mapping

`control-plane-contract.js` 导出：

- `CONTROL_PLANE_ENDPOINTS`
- `buildControlPlaneHeaders(accessToken, extraHeaders)`
- `buildControlPlaneUrl(baseUrl, path, query)`
- `normalizeControlPlaneIdentity(payload)`
- `normalizeControlPlaneInstancesPayload(payload)`
- `normalizeControlPlaneSessionsPayload(payload, instanceContext)`
- `normalizeControlPlaneActionResult(payload, action, instanceContext)`
- `isControlPlaneActionConfirmed(payload, action)`

`control-plane-adapter.js` 导出：

- `BondieControlPlaneAdapter`
- `status()`
- `listInstances()`
- `listSessions(instanceContext)`
- `newConversation(instanceContext, options)`
- `switchSession(instanceContext, sessionId, options)`

adapter readiness 规则：

- 缺 `sidePanelControlPlaneBaseUrl`：返回 `permission_unresolved`，不发请求。
- 缺 OAuth access token：返回 `identity_required`，不发请求。
- 缺或无效 `instanceContext`：返回 `instance_unavailable`，不回退全局 route。
- instance `actions_enabled=false`：new/switch 返回 `instance_action_unavailable`。
- instance health 摘要会保留 `state`、`checked_at`、`stale`、`latency_ms`、`sessions_ready`，但不包含 endpoint/token/debug raw。
- 未显式设置 `actions_enabled=true` 时，只有 `status=online/ready` 的实例默认允许 action；`degraded/offline` 默认禁用。
- `health.stale=true` 时默认禁用 action，不能把过期健康状态当成 online。

规范化后的 session 会补充：

- `instance_id`
- `instance_name`
- `relationship_type`
- `relationship_label`
- `visibility_policy`
- `visibility_label`
- `actions_enabled`

这让 Side Panel 在 `全部` 合集视图中仍能看清每条 session 属于哪个 Bondie，以及为什么能看见。

## Fail-closed Rules

- OAuth 未完成：返回 `identity_required`，不请求 instances/sessions。
- Control Plane URL 未配置：返回 `permission_unresolved`，不请求 legacy Bridge。
- instances 为空或关系无效：显示空态，不做全局 session 搜索。
- unknown `instanceId`：返回 `instance_unavailable`。
- action 缺 `instanceId` 或 `sessionId`：拒绝，不使用全局 route。
- Control Plane adapter 报错：展示诊断，不回退 legacy direct bridge。

## 下一步

1. 设计 OAuth token 获取与刷新 adapter。
1. 接入生产 OAuth token 获取与刷新 adapter，替换当前 dev token provider。
2. 增加浏览器人工 gate：Control Plane URL/dev token/host permission 配置后，Side Panel UI 能展示多实例合集并按实例过滤。
3. 增加越权测试：无 OAuth、仅 pairing、无 relationship、沟通关系枚举他人 session。
4. 与服务端仓库持续对齐 endpoint 和 response schema。
