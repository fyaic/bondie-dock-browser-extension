# Bondie Control Plane Contract

日期：2026-06-18

## 目标

本文件冻结浏览器 Side Panel 与 Bondie Control Plane 的最小生产契约。它解决三件事：

- 当前用户是谁：OAuth 或等价身份服务返回 viewer。
- 当前用户能访问哪些 Bondie 实例：每个实例必须带 relationship 和 visibility policy。
- 每个实例下可见 sessions 以及 new/switch action 的完成确认。

当前分支只实现 contract helper：`extension/src/modules/openclaw-side-panel/control-plane-contract.js`。还没有接入真实网络 adapter；`sidePanelInstanceProvider=bondie-control-plane` 仍保持 fail closed。

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
2. 设计 Control Plane fetch adapter，并只在 `sidePanelIdentityMode=oauth` 且 `sidePanelInstanceProvider=bondie-control-plane` 时启用。
3. 增加越权测试：无 OAuth、仅 pairing、无 relationship、沟通关系枚举他人 session。
4. 与服务端仓库对齐 endpoint 和 response schema。
