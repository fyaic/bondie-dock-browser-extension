# 旧 Side Panel / Session Bridge 分析

本文件记录从本地旧项目读取到的事实，用于指导浏览器插件迁移。

## 读取范围

旧 A 侧：

```text
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/README.md
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/docs/tldr.md
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/docs/x-backend-session-bridge.md
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/docs/product-scope.md
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/docs/security-model.md
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/docs/side-panel-research.md
/Users/fuyo-aic/Projects/wecom-sidepanel-probe/tests/test_session_bridge_proxy.py
```

旧 B 侧：

```text
/Users/fuyo-aic/Projects/openclaw-session-bridge/README.md
/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/tldr.md
/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/api.md
/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/architecture.md
/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/openclaw-integration.md
/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/wecom-scope-contract.md
/Users/fuyo-aic/Projects/openclaw-session-bridge/app/main.py
/Users/fuyo-aic/Projects/openclaw-session-bridge/app/models.py
/Users/fuyo-aic/Projects/openclaw-session-bridge/app/adapters.py
```

## 旧系统边界

旧链路：

```text
WeCom Side Panel
  -> A: wecom-sidepanel-probe
  -> Tailscale/private network
  -> B: openclaw-session-bridge
  -> OpenClaw
```

A 负责：

- WeCom OAuth。
- JS-SDK `config` / `agentConfig`。
- `panel_token` 签发与校验。
- 服务端重建 operator identity。
- 将可信 WeCom route scope 转发给 B。
- 渲染 B 返回的 sessions、switch/new 结果和 message card 预览。

B 负责：

- OpenClaw route/session 解析。
- scoped session 授权过滤。
- list session / get session。
- new conversation reset。
- switch historical generation。
- OpenClaw Gateway read-back confirmation。
- 状态卡片通过 OpenClaw/Y-side channel 投递。

## 必须保留的契约

### 1. 授权必须 fail closed

旧系统拒绝在 scope 不足时展示全局、最近、模糊或本地猜测 sessions。浏览器插件也必须如此：如果 extension 不能形成可信 OpenClaw scope，就展示 unresolved 状态，不展示全量 session。

### 2. 浏览器输入不可信

旧 A 侧测试明确覆盖：浏览器请求体中的 `chat_label/operator_*` 不能覆盖服务端身份。新系统对应规则是：网页 DOM、URL、active tab title、用户输入 label 都不能直接决定 session 授权。

### 3. `session_key` 和 `session_id` 不能混淆

旧 B 侧定义：

- `session_key` 是 route/binding identity。
- `session_id` 是该 route 下具体 generation/run id。

新系统仍应保持这个模型。UI 可展示简化文案，但内部 contract 不应混用。

### 4. 新开对话是 route-level action

旧 `POST /v1/sessions/new` 不应带 `session_id`。它作用于当前 route/scope，新建一个 generation。

### 5. 切换对话是 generation-level action

旧 `POST /v1/switch-session` 必须带目标 `session_id` 或等价 generation id。B 先验证目标 generation 属于当前 scope，再执行 route restore。

### 6. 完成态必须由 confirmation 决定

旧 UI 不以 HTTP 200 作为完成条件：

- `new_conversation_confirmed=true` 才显示新开完成。
- `route_switch_confirmed=true` 才显示切换完成。

如果 delivery 失败但 route 已确认，UI 应区分“路由已切换”和“可见状态卡片失败”。

## 必须移除或替换的旧假设

这些是企业微信特有，不应进入浏览器插件主模型：

- WeCom OAuth。
- JS-SDK `getContext`、`getCurExternalContact`、`getCurExternalChat`。
- `panel_token`。
- 企业微信可信域名、可信 IP、备案服务器。
- 上下游/客户联系聊天工具栏入口。
- `wecom_user_id` 作为 UI 层身份字段。
- `chat_label` 由企业微信 alias/name 重建。
- OpenClaw/Y-side WeCom 状态卡片作为唯一可见确认。

## 可复用接口形态

旧 B API 可作为第一阶段 adapter 目标：

```text
GET  /health
GET  /v1/bridge
GET  /v1/sessions
GET  /v1/sessions/{session_id}
POST /v1/sessions/new
POST /v1/switch-session
POST /v1/signals
```

但 browser side panel 不应在 UI 层暴露 WeComBinding。建议在 background adapter 中完成新旧字段映射。

## 新系统映射建议

| 旧 WeCom 概念 | 新浏览器插件概念 | 处理方式 |
|---|---|---|
| `panel_token` | extension deviceToken / paired identity | 复用当前 pairing，不暴露给网页 |
| `wecom_user_id` | paired operator / local profile | adapter 内部字段 |
| `external_user_id` / `conversation_key` | browser/openclaw route scope | 改名为 `route_key` 或 `workspace_scope` |
| `account_id` | OpenClaw workspace/account | 保留概念，改成通用命名 |
| `organization` | workspace/org/project namespace | 保留为可选 namespace |
| `chat_type` | route type | 不再限定 direct/group |
| `chat_label` | route label | 仅显示，不作为唯一授权 |
| WeCom message card | Side Panel operation result / OpenClaw event | 不依赖 WeCom send |

## 旧测试给新测试的启发

新主线需要 contract tests 覆盖：

- 未配对时不能调用 session mutation。
- UI/网页传入的 route label 不能覆盖 trusted scope。
- new-session payload 不包含 `session_id`。
- switch-session payload 必须包含目标 generation id。
- unconfirmed response 不显示“已完成”。
- current session 标记以 `session_id` 为准，不能只用 `session_key`。
- debug/raw session 只在开发诊断里可见，不出现在普通 UI。

