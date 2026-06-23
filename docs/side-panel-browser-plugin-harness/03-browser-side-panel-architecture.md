# 浏览器插件 Side Panel 架构

## 目标架构

命名边界必须保持稳定：

- `Browser Side Panel` 是浏览器插件里的页面前端，负责实例切换、合集视图、会话列表和用户交互。
- `Bondie Control Plane` 是服务侧 API / 控制面，负责 OAuth identity、relationship 权限、instance registry、bridge registry、secret 管理、health 聚合和 session proxy。
- `OpenClaw Session Bridge` 是每台 Bondie/OpenClaw 设备旁边的本地服务，负责把本机 OpenClaw Gateway/session store 暴露成标准 HTTP API。

Control Plane 未来可以有 admin dashboard，但它不是本仓库要实现的 Side Panel 前端。边界和仓库拆分见 `18-system-boundary-and-repo-plan.md`。

```text
Browser Extension
├── extension core
│   ├── manifest / permissions
│   ├── background service worker
│   ├── OpenClaw node-compatible transport
│   ├── device identity / pairing / deviceToken
│   ├── OAuth user identity state
│   ├── storage and settings
│   ├── capability dispatcher
│   └── feature module registry
├── feature modules
│   ├── popup shell
│   ├── page intelligence
│   ├── pattern memory
│   ├── media-to-notes script plugin
│   └── bondie-side-panel UI module
└── adapters
    ├── identity / permission adapter
    ├── session bridge HTTP adapter
    ├── OpenClaw Gateway adapter
    └── future native messaging adapter
```

## 第一阶段数据流

```text
User opens browser side panel
  -> sidepanel.js requests sidePanel.status
  -> background reads pairing/config/OAuth/bridge status
  -> sidepanel.js requests identity and permitted instances
  -> background permission adapter resolves subordinate/communication relationships
  -> sidepanel.js requests sidePanel.sessions.list for selected instance
  -> background session adapter calls bridge/Gateway with allowed visibility
  -> sidepanel renders authorized sessions
  -> user confirms new/switch
  -> sidepanel sends sidePanel.sessions.new or sidePanel.sessions.switch
  -> background adapter executes action
  -> sidepanel gates success on confirmed fields
```

## 与当前 popup 的关系

Popup 适合短动作：

- 当前页解析。
- 通知/历史概览。
- Pattern 建议。
- 快速设置入口。

Side Panel 适合长停留：

- 对话列表。
- 当前会话状态。
- 新建/切换会话。
- 当前页面上下文和研究任务队列。

两者共享 background API，不互相调用 DOM 或复制状态。

## Manifest 规划

第一阶段需要评估并加入：

```json
{
  "permissions": [
    "sidePanel"
  ],
  "side_panel": {
    "default_path": "src/sidepanel/sidepanel.html"
  }
}
```

保持现有策略：

- 不添加默认 `<all_urls>`。
- 不默认全站 content script。
- 页面正文读取仍由用户主动点击触发。
- Side Panel 仅使用当前已授权的 extension API 和 background message。

## 信任边界

可信来源：

- extension 持久化 device identity。
- OpenClaw Gateway pairing/deviceToken。
- OAuth 或等价身份服务返回的 user identity。
- 服务端权限控制面返回的 relationship / visibility policy。
- background service worker 中的配置。
- Session Bridge / OpenClaw Gateway 返回的 scoped sessions 和 confirmed result。

不可信来源：

- 网页 DOM。
- active tab title/url 中的推断身份。
- side panel UI 自己传入的 route label。
- content script 采集的正文。
- 用户手填的 display label。

注意：device pairing 只证明浏览器设备可以连接控制面，不证明当前用户是谁。session 可见性必须由 OAuth user identity 和服务端权限判定。

## Session Scope 模型

浏览器插件不应在 UI 层使用 `WeComBinding`。建议定义通用 scope：

```json
{
  "scope_version": 1,
  "agent": "openclaw",
  "workspace_id": "default",
  "route_type": "browser",
  "route_key": "browser:default",
  "route_label": "Browser",
  "device_id": "<extension-host-id>",
  "operator_id": "<paired-user-id-or-local-profile>",
  "source": "browser-extension-side-panel"
}
```

如果调用旧 Session Bridge，可由 adapter 映射为旧字段。映射必须是显式且可测试的，不让 UI 直接拼旧字段。

## Identity and Permission 模型

浏览器插件需要支持用户视角的多班底实例：

```text
viewer user
  -> permitted agent instances
    -> relationship type
      -> allowed session visibility
```

关系类型：

| relationship_type | 产品语义 | session 可见性 |
|---|---|---|
| `subordinate` | 从属关系，个人私助或强绑定班底 | `all_sessions`，可看该实例全部会话 |
| `communication` | 沟通关系，团队共享或他人分享班底 | `participant_sessions`，只看当前用户相关会话 |

Side Panel UI 必须按实例分组或提供实例切换。不能把多个实例的 sessions 拉平成没有来源的列表。

建议状态：

```text
identity_required
permission_unresolved
instance_empty
```

这些状态都必须 fail closed，不得退回全局 session 搜索。

## Adapter 策略

### Phase 1: Session Bridge HTTP Adapter

优点：

- 最快复用旧 B 侧 session list/new/switch 契约。
- OpenClaw route restore 和 confirmation 已封装在 B。
- 浏览器插件保持薄 UI 和薄控制面。

风险：

- 旧 B API 命名偏 WeCom，需要 adapter 隔离。
- 本地/远程 bridge URL 和 token 配置需要产品化。
- 旧 B API 偏单 scope，不能完整表达“用户 -> 多实例 -> 关系权限”的新模型，只能作为兼容路径。

### Phase 1.5: Permission-aware Control Plane

用途：

- 通过 OAuth user identity 获取用户可访问的班底实例。
- 返回每个实例的 relationship type 和 visibility policy。
- 将 subordinate / communication 的 session 可见性判定放在服务端，而不是浏览器 UI。
- 从 bridge secret store 读取服务端 bridge token，调用每台 Bondie 设备上的 Session Bridge。

风险：

- 需要明确 OAuth provider 和权限服务归属。
- 需要与 OpenClaw Gateway / Session Bridge 的 instance id、route scope 和 session id 对齐。

### Phase 2: OpenClaw Gateway Adapter

优点：

- 可能减少一个本地服务。
- 复用当前 extension 到 Gateway 的 node-compatible 连接。

风险：

- extension 需要承担更多 session scope、mutation、confirmation 逻辑。
- Gateway 是否已有完整 generation list/restore RPC 需要确认。

### Phase 3: Native Messaging Adapter

仅当需要本地系统能力或浏览器 API 不足时考虑。它会改变安装成本，不进入 MVP。

## UI 状态机

```text
booting
  -> identity_required
  -> permission_unresolved
  -> unpaired
  -> offline
  -> bridge_unavailable
  -> scope_unresolved
  -> loading_sessions
  -> ready
  -> confirming_action
  -> action_pending
  -> action_confirmed
  -> action_unconfirmed
  -> action_failed
```

UI 文案需要面向用户，不暴露底层错误为主标题。详细错误放在可展开 diagnostics。

## Browser 适配

Chrome：

- 第一阶段主目标。
- 当前 manifest 已声明 `minimum_chrome_version: "116"`。
- 使用 `sidePanel` permission 和 default path。

Edge：

- 作为 Chromium 近线目标。
- 复用 Chrome 实现，单独验证加载、权限、side panel 打开方式。

Safari：

- 不进入第一阶段实现。
- 后续单独评估 extension manifest、background 生命周期、侧栏/弹窗替代形态和分发流程。
