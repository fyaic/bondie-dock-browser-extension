# Side Panel 身份与权限模型

日期：2026-06-17

## 核心结论

浏览器插件 Side Panel 是用户视角，不是设备视角，也不是单个 OpenClaw 实例视角。

团队产品名使用 Bondie。OpenClaw 是底层能力或历史命名。同一个用户可能同时访问多个 Bondie/班底实例：

- 个人私助。
- 团队共享班底。
- 他人分享给自己的班底。

因此不能用“一人一个账号只看自己的数据”来简化模型。Side Panel 必须先识别当前用户，再展示该用户有权限访问的所有 Bondie 实例和会话。

## 两种关系

### 从属关系

从属关系是强绑定关系。OpenClaw 或班底实例是用户的私有助理，或由用户拥有、管理、委托运行。

权限语义：

- 用户可以查看该班底实例下的全部 sessions。
- sessions 可以包含该班底与其他人的对话。
- 典型例子：汤米的私助，汤米可以查看这个私助与他人的全部会话历史。

建议命名：

```text
relationship_type = subordinate
visibility_policy = all_sessions
```

### 沟通关系

沟通关系是弱绑定关系。OpenClaw 或班底实例对用户提供团队行为、共享服务或他人分享能力。

权限语义：

- 用户只能查看自己与该班底相关的 sessions。
- 不允许查看同一班底与其他人的 sessions。
- 典型例子：团队共享班底、他人分享的班底。

建议命名：

```text
relationship_type = communication
visibility_policy = participant_sessions
```

## 身份识别

脱离企业微信后，Side Panel 仍然需要 OAuth 或等价的用户身份体系。旧 WeCom OAuth 不再作为依赖，但不能退化为只依赖浏览器本地账号或 device pairing。

需要区分两类认证：

| 认证 | 作用 | 不能替代什么 |
|---|---|---|
| extension device pairing / deviceToken | 证明这个浏览器插件设备可以连接 OpenClaw 控制面 | 不能证明当前浏览器用户是谁 |
| OpenClaw / AIC OAuth user identity | 证明当前用户是谁，并用于查询关系和权限 | 不能替代设备配对和本地能力授权 |

第一阶段已有的 pairing 仍然有价值，但它只适合连接和设备能力授权。session 数据隔离必须基于 OAuth 后的用户身份和服务端权限判定。

## 权限数据模型

建议把 Side Panel 的权限模型拆成三层：

```text
User
  -> Relationship / Membership
    -> Agent Instance / Bandit Instance
      -> Sessions
```

最小字段：

```json
{
  "viewer_user_id": "user_123",
  "instance_id": "openclaw_instance_a",
  "instance_label": "个人私助 A",
  "relationship_type": "subordinate",
  "visibility_policy": "all_sessions",
  "roles": ["owner"],
  "source": "oauth"
}
```

沟通关系示例：

```json
{
  "viewer_user_id": "user_123",
  "instance_id": "openclaw_instance_b",
  "instance_label": "团队共享 B",
  "relationship_type": "communication",
  "visibility_policy": "participant_sessions",
  "roles": ["participant"],
  "participant_scope": {
    "route_type": "direct",
    "route_key": "user_123"
  },
  "source": "oauth"
}
```

## Session 展示规则

Side Panel 应按班底实例分组展示，而不是把所有 sessions 拉平为一个列表。

展示规则：

- 从属关系实例：展示该实例下全部 sessions，可标记“查看全部”。
- 沟通关系实例：只展示与当前用户相关的 sessions，可标记“仅相关”。
- 同一个用户拥有多个实例时，默认展示“有权限访问的全部实例”，并允许切换/筛选实例。
- Session item 必须带上所属实例和 visibility 来源，避免用户误解数据范围。
- 普通用户 UI 不展示 debug/raw session 详情。

## Fail Closed 规则

任何不完整权限状态都必须 fail closed：

- 未完成 OAuth：显示 `identity_required`，不列 session。
- 只有 device pairing、没有 user identity：不列 session。
- user identity 有效但没有 relationship：显示空态，不做全局搜索。
- 沟通关系不能 fallback 到从属关系或全量 sessions。
- 浏览器页面 URL、DOM、用户手填 label 不能提升权限。
- 旧 Session Bridge 的 direct/group scope 只能作为兼容 adapter 输入，不能作为新权限模型的最终授权来源。

## 对现有 Session Bridge 的影响

当前 `openclaw-session-bridge` 主要表达单个 scoped route：

```text
viewer/scope -> one OpenClaw route -> sessions under that route
```

新权限模型需要表达：

```text
viewer -> many instances -> per-instance relationship -> allowed session set
```

因此当前浏览器插件里的 Session Bridge adapter 只能作为过渡兼容层。后续需要新增权限感知的控制面契约，例如：

```text
GET /v1/me
GET /v1/agent-instances
GET /v1/agent-instances/{instance_id}/sessions
POST /v1/agent-instances/{instance_id}/sessions/new
POST /v1/agent-instances/{instance_id}/switch-session
```

请求必须携带 OAuth user token，由服务端根据 relationship 计算允许的 session set。浏览器插件不应自行判断“这个用户能不能看全部”。

## 对当前分支的实施边界

当前 Phase 6 已经完成单 Bridge / 单 scope 的 Side Panel MVP 骨架和真实 Bridge smoke。新权限模型应作为下一阶段主线进入，不直接推翻已完成代码。

## 2026-06-18 Phase 7B 执行状态

已落地最小身份 gate：

- 新增 `sidePanelIdentityMode`。
- 默认 `legacy-paired` 保留 direct Session Bridge 兼容路径，只用于开发/过渡场景。
- 2026-06-18 当时 `oauth` 模式在 adapter 未接入前返回 `identity_required`。
- 2026-06-24 当前 `oauth` 模式已支持 dev-token provider 进入 Control Plane runtime；缺 token 时仍返回 `identity_required`。
- OAuth 模式下不请求 legacy Session Bridge，不把 device pairing 伪装成用户身份。
- Side Panel diagnostics 只展示 `identity_mode`、`identity_authenticated`、`identity_reason`，不展示 token。

该实现不是生产 OAuth；它的作用是防止把 device pairing 误当作用户身份，并为后续 OAuth/control plane adapter 留出明确边界。

2026-06-23 Phase 10 更新：`oauth` 模式已可通过 background dev-token provider 进入 Bondie Control Plane runtime，用于本地 smoke 和人工测试；生产 OAuth token 获取、刷新、登出和 scope 仍等待登录授权系统文档后实现。

下一阶段建议：

1. 在 Side Panel 状态中加入 `identity_required` 和 `permission_unresolved`。
2. 增加 OAuth identity 状态入口，但不把 token 暴露给 UI。
3. 增加 Agent Instance / Bandit Instance 列表模型。
4. 将 sessions list 从单一 scope 改为按 instance 拉取。
5. 在 UI 中区分“从属关系 / 查看全部”和“沟通关系 / 仅相关”。
6. 保留旧 Session Bridge adapter 作为 legacy compatibility path。

详细 UI 信息架构见 `07-bondie-multi-instance-product-architecture.md`。多设备 bridge、Tailscale 和标准分发见 `08-bondie-device-bridge-distribution.md`。

## 需要继续确认

- OAuth provider 使用 OpenClaw 账号、AIC 账号，还是独立身份服务。
- 从属关系的授予来源：实例 owner、组织管理员、设备 owner，还是 OpenClaw 控制面。
- 沟通关系的 participant scope 如何跨 WeCom、浏览器、未来更多应用统一。
- 多班底实例的 registry 由 OpenClaw Gateway、Session Bridge，还是独立权限服务提供。
- 现有旧 B route-level new/switch 如何映射到 instance-level new/switch。
