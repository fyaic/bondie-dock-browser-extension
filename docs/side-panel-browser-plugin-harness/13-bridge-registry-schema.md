# Bondie Bridge Registry Schema

日期：2026-06-18

## 目标

Bridge Registry 是 Bondie Control Plane 的服务端数据层。它不运行在浏览器插件里，负责把“用户可访问的 Bondie 实例”映射到“可被控制面调用的 OpenClaw Session Bridge 设备”。

核心原则：

- 用户权限和设备路由分离。
- bridge endpoint/token 只保存在服务端。
- 浏览器只看到 instance/session projection，不看到 bridge secret。
- Tailscale/private network 只解决可达性，不解决用户权限。

## 关系图

```text
OAuth user
  -> user_instance_relationship
  -> bondie_instance
  -> instance_bridge_binding
  -> bridge_device
  -> bridge_secret
  -> Tailscale/private endpoint
```

`user_instance_relationship` 决定用户能不能看、能看多少；`instance_bridge_binding` 决定 Control Plane 应该调用哪台 bridge。

## 表模型

### `bondie_instances`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `instance_id` | string | 是 | 稳定 ID，例如 `bondie-a` |
| `display_name` | string | 是 | UI 展示名 |
| `owner_user_id` | string | 否 | 从属关系的主用户或 owner |
| `workspace_id` | string | 是 | 多租户隔离 |
| `status` | enum | 是 | `active` / `disabled` / `archived` |
| `created_at` | datetime | 是 | 创建时间 |
| `updated_at` | datetime | 是 | 更新时间 |

约束：

- `instance_id` 不能复用给另一台设备或另一个用户。
- `status != active` 时不能返回给普通 Side Panel。

### `user_instance_relationships`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `relationship_id` | string | 是 | 稳定关系 ID |
| `user_id` | string | 是 | OAuth user id |
| `instance_id` | string | 是 | Bondie instance id |
| `relationship_type` | enum | 是 | `subordinate` / `communication` |
| `visibility_policy` | enum | 是 | `all_sessions` / `participant_sessions` |
| `roles` | string[] | 否 | `owner` / `participant` / `operator` |
| `granted_by` | string | 否 | 授权来源 |
| `status` | enum | 是 | `active` / `revoked` |
| `created_at` | datetime | 是 | 创建时间 |
| `updated_at` | datetime | 是 | 更新时间 |

硬约束：

- `subordinate` 必须对应 `all_sessions`。
- `communication` 必须对应 `participant_sessions`。
- `status != active` 时不能返回 sessions。
- 同一 `user_id + instance_id` 同时只能有一个 active relationship。

### `bridge_devices`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `bridge_id` | string | 是 | `SESSION_BRIDGE_ID`，稳定设备 ID |
| `bridge_name` | string | 是 | `SESSION_BRIDGE_NAME` |
| `endpoint` | string | 是 | Tailscale/MagicDNS/private URL |
| `network_type` | enum | 是 | `tailscale` / `private_http` / `local_dev` |
| `adapter` | enum | 是 | 当前为 `gateway` |
| `capabilities` | string[] | 是 | `list_sessions` / `switch_session` / `start_new_conversation` |
| `status` | enum | 是 | `online` / `degraded` / `offline` / `disabled` |
| `last_seen_at` | datetime | 否 | 最近一次健康探测时间 |
| `created_at` | datetime | 是 | 创建时间 |
| `updated_at` | datetime | 是 | 更新时间 |

约束：

- `endpoint` 不返回给浏览器。
- `endpoint` 必须从 Control Plane 所在网络可达。
- `bridge_id` 由设备配置决定，不等于用户 ID。

### `bridge_secrets`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `bridge_id` | string | 是 | 关联 bridge |
| `secret_ref` | string | 是 | secret manager 引用 |
| `token_hash` | string | 否 | 可选 token hash，用于轮换校验 |
| `rotated_at` | datetime | 否 | 最近轮换时间 |
| `expires_at` | datetime | 否 | 过期时间 |

约束：

- 原始 `SESSION_BRIDGE_TOKEN` 不进普通数据库明文字段。
- 浏览器 extension 永远不读取该表。

### `instance_bridge_bindings`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `binding_id` | string | 是 | 稳定绑定 ID |
| `instance_id` | string | 是 | Bondie instance |
| `bridge_id` | string | 是 | Session Bridge device |
| `role` | enum | 是 | `primary` / `standby` |
| `status` | enum | 是 | `active` / `disabled` |
| `created_at` | datetime | 是 | 创建时间 |
| `updated_at` | datetime | 是 | 更新时间 |

约束：

- 每个 active instance 至少需要一个 active primary bridge。
- 多 primary 需要明确 sharding policy；本期默认不支持。
- standby 只用于诊断和后续 failover，不自动接管，除非有明确 runbook。

### `bridge_health_snapshots`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `bridge_id` | string | 是 | Bridge device |
| `state` | enum | 是 | `online` / `degraded` / `offline` |
| `checked_at` | datetime | 是 | 检查时间 |
| `latency_ms` | number | 否 | `/health` 或 `/v1/bridge` 延迟 |
| `sessions_ready` | boolean | 否 | scoped sessions smoke 是否通过 |
| `error_code` | string | 否 | `timeout` / `unauthorized` / `http_error` |

约束：

- health 不能提升用户权限。
- `sessions_ready=false` 时实例仍可展示，但 session list 应返回 degraded/empty diagnostic，不做全局 fallback。

## Control Plane Projection

`GET /v1/bondie-instances` 返回给浏览器的 projection：

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
    }
  ]
}
```

禁止出现在 projection 中：

- bridge `endpoint`
- bridge token 或 secret ref
- Tailscale node key
- OpenClaw Gateway local URL
- 其他用户的 relationship 明细

## 查询规则

### Instances

```text
viewer user_id
  -> active user_instance_relationships
  -> active bondie_instances
  -> active primary bridge binding
  -> latest bridge_health_snapshot
  -> browser projection
```

无 relationship 时返回空数组或 `permission_unresolved`，不能搜索全部 instances。

### Sessions

```text
viewer user_id + instance_id
  -> validate active relationship
  -> validate relationship/visibility pair
  -> select active primary bridge
  -> call bridge /v1/sessions with service-side token
  -> apply server-side visibility filter
  -> return normalized sessions
```

沟通关系的 `participant_sessions` 必须在服务端完成过滤。浏览器 helper 只做二次规范化和 UI 标注。

### Actions

new/switch action 必须同时满足：

- viewer 有 active relationship；
- instance active；
- primary bridge active；
- bridge capability 支持目标 action；
- bridge 返回 explicit confirmation；
- Control Plane 把 operation 和 actor 写入审计日志。

## Fail-closed Matrix

| 场景 | 返回 |
|---|---|
| 未登录 OAuth | `identity_required` |
| 登录但无 relationship | 空 instances 或 `permission_unresolved` |
| relationship/policy 不匹配 | 过滤该 relationship，记录告警 |
| instance disabled | 不返回给普通用户 |
| bridge offline | instance 可显示 `offline/degraded`，sessions 不 fallback |
| token 失效 | `control_plane_unavailable` 或 `bridge_unauthorized` |
| 沟通关系枚举他人 session | `instance_unavailable` 或 `permission_denied` |

## 最小落地顺序

1. 先建 `bondie_instances`、`user_instance_relationships`、`bridge_devices`、`instance_bridge_bindings`。
2. secrets 暂接现有 secret store 或环境变量，但接口按 `bridge_secrets.secret_ref` 设计。
3. health snapshots 先由定时任务写入，后续再做事件流。
4. Control Plane 先只支持 primary bridge，不做自动 failover。
5. Browser extension 继续通过 `BondieControlPlaneAdapter` 读取 projection。
