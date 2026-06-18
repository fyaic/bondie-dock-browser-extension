# Bondie 多实例 Side Panel 产品与权限架构

日期：2026-06-17

## 设计读法

Reading this as: compact browser extension product surface for power users, with a quiet operational UI language, leaning toward dense-but-readable instance switching rather than three-column dashboards.

## 背景

团队产品名使用 Bondie。OpenClaw 是底层能力或历史命名，浏览器插件对用户应逐步表达为 Bondie Side Panel。

用户视角不是“一台设备上的一个 OpenClaw”，而是：

```text
Veil
  -> Bondie A: 从属关系，个人私助，可看全部 sessions
  -> Bondie B: 沟通关系，团队/他人班底，只看 Veil 相关 sessions
  -> Bondie C: 沟通关系或无从属，只看 Veil 相关 sessions
```

因此 Side Panel 要展示的是“我有权限访问的 Bondie session 合集”，不是单个 bridge 的 session list。

## 产品原则

- 用户先于设备：先识别当前 user，再查询可访问 Bondie 实例。
- 关系决定可见性：从属关系看全量，沟通关系看相关。
- 服务端判权：浏览器 UI 只展示权限结果，不自行提升可见性。
- 实例可切换，也可合集查看：用户既能扫全局，也能聚焦某个 Bondie。
- 不泄漏他人会话：沟通关系永远不能 fallback 到全量 sessions。
- 保留旧 Session Bridge 兼容路径，但最终模型是 Bondie instance control plane。

## UI 方案取舍

### 方案 A：纯实例 Tabs

形态：

```text
[A] [B] [C]
selected instance sessions...
```

优点：

- 简单。
- 实现成本低。
- 权限边界直观。

缺点：

- 默认看不到合集。
- 用户需要逐个点开，跨 Bondie 查找慢。
- B/C 有新消息或当前会话时容易被隐藏。

结论：可作为窄屏下的聚焦模式，但不应是唯一形态。

### 方案 B：三个实例同时并排

形态：

```text
A column | B column | C column
```

优点：

- 同屏对比强。

缺点：

- 浏览器 Side Panel 常见宽度 320-420px，三列会严重拥挤。
- session title、summary、last messages 会溢出。
- 不符合当前 extension 侧栏工具的扫描节奏。

结论：不采用。

### 方案 C：实例切换器 + 合集分组列表

形态：

```text
Identity / status

Bondie switcher
[全部] [A 私助 · 查看全部] [B 团队 · 仅相关] [C 分享 · 仅相关]

Sessions
A 个人私助 · 查看全部
  session...
  session...
B 团队共享 · 仅相关
  session...
C 他人分享 · 仅相关
  session...
```

优点：

- 默认展示合集，符合“我能看到 ABC 的 session 合集”。
- 每组天然展示权限范围，减少误解。
- 点击实例后可聚焦单个 Bondie，不丢失全局入口。
- 适合 320-420px 侧栏：顶部 switcher 横向滚动或两行 wrap，列表纵向滚动。

缺点：

- 需要更好的空态、loading 和错误分组。
- 需要 instance-level session fetching 和缓存策略。

结论：采用。Phase 7 UI 以该方案为主。

## 推荐信息架构

```text
Bondie Side Panel
├── Header
│   ├── 当前用户
│   ├── 设备连接状态
│   └── 设置
├── Bondie Instance Switcher
│   ├── 全部
│   ├── Bondie A · 私助 · 查看全部 · online
│   ├── Bondie B · 团队 · 仅相关 · online
│   └── Bondie C · 分享 · 仅相关 · offline/error
├── Session Feed
│   ├── Group: Bondie A
│   │   ├── 权限 badge: 查看全部
│   │   └── sessions...
│   ├── Group: Bondie B
│   │   ├── 权限 badge: 仅相关
│   │   └── sessions...
│   └── Group: Bondie C
│       ├── 权限 badge: 仅相关
│       └── sessions / empty / unavailable
└── Page Context Dock
    └── 继续作为辅助能力
```

## UI 细则

- 顶部实例切换器用 compact segmented chips，不使用三列卡片。
- 默认选中 `全部`，但 session list 按实例分组。
- 每个实例 chip 至少显示：名称、关系 badge、可见性 badge、连接状态点。
- 从属关系文案使用“查看全部”。
- 沟通关系文案使用“仅相关”。
- 离线实例不隐藏，显示不可用状态和诊断入口。
- Session row 显示所属 Bondie，避免在合集模式下迷路。
- Page Context Dock 放在 session feed 后方，不抢主线。
- 普通 UI 不展示 raw route key、token、debug JSON；诊断折叠展示脱敏信息。

## 数据模型

```json
{
  "viewer": {
    "user_id": "veil",
    "display_name": "Veil"
  },
  "instances": [
    {
      "instance_id": "bondie-a",
      "display_name": "Bondie A",
      "relationship_type": "subordinate",
      "visibility_policy": "all_sessions",
      "status": "online",
      "bridge_id": "openclaw-a"
    },
    {
      "instance_id": "bondie-b",
      "display_name": "Bondie B",
      "relationship_type": "communication",
      "visibility_policy": "participant_sessions",
      "participant_scope": {
        "user_id": "veil"
      },
      "status": "online",
      "bridge_id": "openclaw-b"
    }
  ]
}
```

Session list response should carry instance metadata:

```json
{
  "instance_id": "bondie-b",
  "visibility_policy": "participant_sessions",
  "sessions": []
}
```

## 权限规则

从属关系：

- 用户是 owner/admin/delegated principal。
- 返回该 Bondie 实例全部 sessions。
- sessions 可包含其他用户与该 Bondie 的对话。

沟通关系：

- 用户是 participant/member/recipient。
- 返回该用户参与或被授权查看的 sessions。
- 不返回同实例下其他人的 sessions。

无关系：

- 不返回实例，或返回不可访问的占位。
- 不允许通过搜索、URL、route label、device pairing 推断访问。

## 技术路径

### Phase 7A: 本地 fixture 和 UI 重构

- 增加 fake instances：A/B/C。
- 默认合集分组显示。
- 增加关系 badge 和可见性 badge。
- 增加 `identity_required` / `permission_unresolved` UI 状态。
- 只做 fixture，不接真实 OAuth。

### Phase 7B: Identity / Permission Adapter

- `sidePanel.identity.status`
- `sidePanel.instances.list`
- `sidePanel.sessions.list` 支持 `instanceId`。
- 背景层缓存 viewer identity 和 permitted instances。

### Phase 7C: Control Plane / Registry Integration

- Extension 通过 OAuth 调用 Bondie control plane。
- Control plane 查询用户可访问 instances。
- Control plane 根据 instance routing 调用各设备 bridge。
- Bridge token 保存在服务端，不放在浏览器扩展里。

## 为什么不让浏览器直连所有 Bridge

直连模式看似简单，但问题很大：

- 用户浏览器必须加入所有相关设备的 Tailscale 网络。
- 每个 bridge token 需要下发到 extension，泄漏面扩大。
- 多设备 endpoint 变更需要用户本地配置。
- 权限判断容易落到浏览器 UI。

推荐默认路径：

```text
Browser Extension
  -> Bondie Control Plane over HTTPS with OAuth
  -> bridge registry
  -> per-device Session Bridge over Tailscale/private network
  -> local OpenClaw Gateway
```

本地直连 bridge 只保留为开发和单机高级模式。

## 当前 Mac mini 现场映射

当前已知运行态：

```text
bridge URL: http://100.79.143.105:8766
bridge id: mac-mini-session-bridge
adapter: gateway
process: uvicorn app.main:app --host 100.79.143.105 --port 8766
network: Tailscale/private IP
```

当前问题：

- `/health` 和 `/v1/bridge` 可用。
- `/v1/sessions` 曾返回 HTTP 504，来源是 B -> local OpenClaw Gateway sessions.list 超时。
- 这是设备 bridge / Gateway 性能问题，不是浏览器权限模型本身。

## 下一步产出

- Side Panel multi-instance wireframe。
- Fixture-driven UI 实现，不接生产 OAuth。
- Permission-aware API contract 草案。
- Bondie control plane / registry issue 拆分。
- Session Bridge 标准分发与多设备注册文档。
