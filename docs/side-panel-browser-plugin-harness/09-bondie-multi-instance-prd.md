# Bondie 多实例 Side Panel PRD

日期：2026-06-17

## 一句话目标

把浏览器 Side Panel 从“单个 OpenClaw/Session Bridge 的会话列表”升级为“当前用户有权限访问的多个 Bondie 实例会话入口”。

用户打开 Side Panel 后，应能看到 Bondie A/B/C 的 session 合集：

- Bondie A：从属关系，用户可查看全部 sessions。
- Bondie B/C：沟通关系，用户只查看自己相关 sessions。

## 背景

OpenClaw 是底层能力和历史命名。团队产品名是 Bondie。未来面向用户时，Side Panel 应逐步表达为 Bondie 工作面板。

旧 WeCom Side Panel 解决的是聊天窗口没有 session 切换能力。浏览器插件继续保留“会话切换/新开”的主线，但必须脱离企业微信身份体系，改用跨应用 OAuth 用户身份和 Bondie 权限控制面。

## 用户故事

作为 Veil，我希望在浏览器 Side Panel 中看到我有权限访问的所有 Bondie 实例，以便从一个入口切换和恢复不同 Bondie 的会话。

作为 Bondie A 的从属用户，我希望查看 Bondie A 的全部 sessions，包括它与其他人的对话，以便管理我的私助完整工作历史。

作为 Bondie B/C 的沟通用户，我只希望看到我自己与这些 Bondie 的相关 sessions，以便使用团队或他人分享的 Bondie，同时不泄露其他人的会话。

作为多设备用户，我不希望手动配置每台 Bondie 设备的 Tailscale 地址和 bridge token；Side Panel 应通过可信控制面完成路由。

作为后续开发者，我希望权限和设备路由被拆到清晰的 adapter/control plane 边界，以便可以先用 fixtures 做 UI，再逐步接真实 OAuth 和 bridge registry。

## 本期范围

### 包含

- Bondie 多实例信息架构。
- 从属关系 / 沟通关系权限规则。
- 用户身份、实例、relationship、visibility policy 的数据契约。
- Side Panel UI 方案：实例切换器 + 全部合集分组列表。
- 多设备 bridge / Tailscale / registry 技术路线。
- Session Bridge 504 修复计划和回退 runbook。
- Linear 子任务同步。

### 不包含

- 生产 OAuth 接入。
- 生产 Bondie Control Plane 实现。
- 完整 bridge registry 服务端实现。
- 真实多设备 Tailscale ACL 配置。
- Chrome Web Store / Edge Add-ons 发布。
- Safari 实现。

## 产品体验

### 默认视图

默认进入 `全部` 视图，按 Bondie 实例分组展示 sessions：

```text
Bondie A · 私助 · 查看全部
  session 1
  session 2

Bondie B · 团队 · 仅相关
  session 3

Bondie C · 分享 · 仅相关
  session 4
```

### 实例切换器

顶部提供 compact instance switcher：

```text
[全部] [A · 查看全部] [B · 仅相关] [C · 仅相关]
```

规则：

- 320px/420px 宽度下可以横向滚动或自动换行。
- 不采用三列并排。
- 每个 chip 显示实例名、权限范围、连接状态。
- 离线/错误实例不隐藏，显示状态并提供诊断入口。

### Session Row

每个 session row 至少展示：

- 标题。
- 摘要或最近消息。
- 更新时间。
- 所属 Bondie。
- 当前 / 历史 / 空 generation 状态。
- 权限来源 badge。

普通 UI 不展示 raw route key、token、debug JSON。

## 权限规则

### 从属关系

```text
relationship_type = subordinate
visibility_policy = all_sessions
```

允许：

- 查看该 Bondie 实例全部 sessions。
- sessions 可包含其他人与该 Bondie 的对话。

### 沟通关系

```text
relationship_type = communication
visibility_policy = participant_sessions
```

允许：

- 只查看当前用户参与或被授权查看的 sessions。

禁止：

- 查看同一 Bondie 实例下其他用户 sessions。
- 通过搜索、URL、route label 或 device pairing 提升为全量可见。

### 无关系

无 relationship 时不展示实例或只展示不可访问占位，不发起 session list。

## 数据契约草案

Viewer：

```json
{
  "user_id": "veil",
  "display_name": "Veil",
  "source": "oauth"
}
```

Instance membership：

```json
{
  "instance_id": "bondie-a",
  "display_name": "Bondie A",
  "relationship_type": "subordinate",
  "visibility_policy": "all_sessions",
  "roles": ["owner"],
  "bridge_id": "openclaw-a",
  "status": "online"
}
```

Session group：

```json
{
  "instance_id": "bondie-a",
  "visibility_policy": "all_sessions",
  "sessions": []
}
```

## 技术架构

推荐默认路径：

```text
Browser Extension
  -> Bondie Control Plane over HTTPS + OAuth
  -> Bridge Registry
  -> per-device Session Bridge over Tailscale/private network
  -> local OpenClaw Gateway
```

原因：

- 浏览器不保存每台 bridge token。
- 用户设备不需要加入所有 Bondie 设备的 private network。
- OAuth、relationship、registry 和审计集中在服务端。
- 每个设备 bridge 保持本地、简单、可标准分发。

开发/单机高级模式可以保留 direct bridge adapter，但不作为默认产品路径。

## 阶段计划

### 2026-06-18 状态

Phase 7A 已完成最小可运行闭环：

- legacy Session Bridge 单实例 payload 已包装为 `instances/groups/sessions`，不破坏正式 Bridge 26 个真实 sessions 的回归路径。
- `fixtures` 模式可展示 Bondie A/B/C：A 为从属关系 `查看全部`，B/C 为沟通关系 `仅相关`。
- Side Panel 使用实例切换器 + 全部合集分组列表，不采用三列并排。
- fixture 模式为只读预览，UI 禁用 new/switch，background action message 返回 `fixture_read_only`。
- Options 增加 `Bondie preview` 开关，便于手工体验 fixture UI。

仍未完成：

- 生产 OAuth identity adapter。
- 生产 permission-aware instances API。
- Bondie Control Plane 的真实 instance-level `list/new/switch({ instanceId })` contract。
- Control Plane、bridge registry、Tailscale/ACL 标准分发实现。
- 未 OAuth、仅 pairing、无 relationship、沟通关系越权的完整自动化测试。

Phase 7B 已完成扩展消息层的最小 contract：

- `sidePanel.sessions.list({ instanceId })` 支持 legacy instance、fixtures instance 和 `all` aggregate。
- legacy direct Bridge 只允许空 instance 或 `legacy-session-bridge`；未知 instance 返回 `instance_unavailable`。
- fixture `new/switch({ instanceId })` 返回 `fixture_read_only`，不调用真实 Bridge。
- Side Panel UI 执行 new/switch 时会带上当前可操作 instance id。
- `sidePanelIdentityMode` 已落地：默认 `legacy-paired` 保留真实 Bridge 路径，`oauth` 模式要求 OAuth/dev-token token provider，未认证时返回 `identity_required`。
- `sidePanelInstanceProvider` 已落地：默认 `legacy-session-bridge` 保留现有路径，`bondie-control-plane` 已接入 Control Plane runtime adapter，不回退 legacy sessions。
- Phase 7C/10 已固化并接入 Control Plane contract helper 和 runtime adapter：endpoint builder、OAuth header builder、identity/instances/sessions/action normalizer、fake-fetch 验证和本地 Control Plane 只读 smoke 均已通过。生产 OAuth provider 仍等待登录授权系统文档。

### Phase 7A: Fixture UI

- 新增 A/B/C fixtures。
- 默认合集分组列表。
- 实例切换器。
- 权限 badge。
- `identity_required` / `permission_unresolved` / `instance_unavailable` 状态。

### Phase 7B: Extension Adapter Contract

- `sidePanel.identity.status`
- `sidePanel.instances.list`
- `sidePanel.sessions.list({ instanceId })`
- `sidePanel.sessions.new({ instanceId })`
- `sidePanel.sessions.switch({ instanceId, sessionId })`

### Phase 7C: Control Plane Contract

- `GET /v1/me`
- `GET /v1/bondie-instances`
- `GET /v1/bondie-instances/{instance_id}/sessions`
- `POST /v1/bondie-instances/{instance_id}/sessions/new`
- `POST /v1/bondie-instances/{instance_id}/sessions/switch`

已落地文件：

- `extension/src/modules/bondie-side-panel/control-plane-contract.js`
- `extension/src/modules/bondie-side-panel/control-plane-adapter.js`
- `docs/side-panel-browser-plugin-harness/12-control-plane-contract.md`

### Phase 8: Device Bridge Distribution

- Bridge registry schema。
- Device onboarding checklist。
- Tailscale / MagicDNS / ACL notes。
- launchd/systemd + smoke gate。
- Session Bridge performance fix and readiness gate。

## 验收标准

- 未 OAuth 时不显示 sessions。
- 仅 device pairing 时不显示 sessions。
- A/B/C fixtures 能同时在 `全部` 视图展示。
- A 从属关系展示“查看全部”，并可显示全量 fixture sessions。
- B/C 沟通关系展示“仅相关”，并过滤非当前用户 sessions。
- 320px/420px 下实例切换器、badge、session title 不溢出。
- 旧 direct Session Bridge dev mode 仍可用，但被标记为 legacy/direct。
- B 侧 504 修复后，真实 Mac mini bridge 可以恢复 sessions smoke。

## 风险

- OAuth provider 尚未定。
- Bondie control plane 尚未存在。
- 多设备 bridge registry 需要服务端 secret 管理。
- 当前 Session Bridge `/v1/sessions` 存在 Gateway timeout 阻断。
- UI 如果过早接真实接口，容易把产品验证和基础设施问题混在一起。

## 决策

- 已决定：UI 采用实例切换器 + 合集分组列表。
- 已决定：浏览器默认不直连所有 bridge。
- 已决定：Session Bridge 修复先做最小性能/可观测性修复，不改授权模型。
- 待定：OAuth provider。
- 待定：Bondie Control Plane 所属仓库和部署位置。
- 待定：Instance registry 是否先做 mock/local config，还是直接服务端实现。
