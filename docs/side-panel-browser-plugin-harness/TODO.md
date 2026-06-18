# TODO

## 状态

当前阶段：Phase 7C - Bondie Control Plane contract and adapter skeleton。已从 `feature/openclaw-browser-side-panel-plugin` 切出新分支 `feature/bondie-multi-instance-permissions`，用于承接 Bondie 多实例权限主线，不影响 main。B 侧 `/v1/sessions` 504 已在 `openclaw-session-bridge` 源码中完成最小修复；正式 `100.79.143.105:8766` 已重启加载补丁，`debug.timings` 和 exact-route short-circuit 已验证。Chrome Side Panel 指向正式 Bridge 可稳定渲染 26 个真实 sessions。2026-06-18 已完成 Phase 7A 最小可运行闭环：legacy 单 Bridge sessions 被包装为 `instances/groups`，fixture 模式展示 Bondie A/B/C，从属/沟通权限 badge 和合集/实例切换 UI，fixture new/switch fail closed。Phase 7B 已完成 message-level instance contract、identity gate 和 provider gate：默认 legacy-paired + legacy-session-bridge 保留现有路径，OAuth/control-plane mode 在 adapter 未接入前 fail closed 且不列 sessions。Phase 7C 已新增 Control Plane contract helper、文档和 adapter skeleton，冻结 endpoint、OAuth header、relationship/visibility 校验、sessions/action normalizer 与 fetch adapter 边界；当前 adapter 仍未接入 `module.js` runtime，下一步是 OAuth token provider 和 fail-closed 越权自动化测试。

## 已完成

- [x] 本地提交上一版浏览器插件稳定性改动。
- [x] 安装 `rose-skill` 到 `/Users/fuyo-aic/.codex/skills/rose-skill/SKILL.md`。
- [x] 创建新分支 `feature/openclaw-browser-side-panel-plugin`。
- [x] 阅读旧 A 侧 `wecom-sidepanel-probe` README/docs/tests。
- [x] 阅读旧 B 侧 `openclaw-session-bridge` README/docs/API/code。
- [x] 生成 browser side panel harness 文档。
- [x] 同步 Linear 父子任务树：AIC-2911 -> AIC-2912..AIC-2918。
- [x] 2026-06-17 整理最新权限模型：从属关系可查看全部 sessions，沟通关系仅查看用户相关 sessions。
- [x] 创建新分支 `feature/bondie-multi-instance-permissions` 承接 Bondie 多实例权限主线。
- [x] 新增 Bondie 多实例产品/权限/UI 架构文档。
- [x] 新增 Bondie 设备 bridge、Tailscale、registry 和标准分发规划文档。
- [x] 新增 Bondie 多实例 Side Panel PRD。
- [x] 新增 Session Bridge 504 修复 runbook，包含回退基线和验证命令。
- [x] 在 B 仓库完成 Session Bridge 504 最小源码修复，记录见 `/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/session-bridge-504-fix-2026-06-17.md`。
- [x] Phase 7A 实现 Bondie A/B/C fixtures、实例切换器、合集分组列表、权限 badge 和 fixture read-only action gate。

## 下一步

- [x] 运行文档/代码验证命令。
- [x] 根据验证结果修正文档格式或链接问题。
- [x] 拆 Phase 1 实现 issue：Manifest and Side Panel Shell (`AIC-2913`)。
- [x] 拆 Phase 2 实现 issue：Feature Module Registry (`AIC-2914`)。
- [x] 拆 Phase 3 实现 issue：Session Adapter MVP (`AIC-2915`)。
- [x] 将 Phase 0-2 文档与 shell/registry 变更提交到新分支：`d9e6f4b Add browser side panel shell`。
- [x] 推进 Phase 1：Manifest and Side Panel Shell。
- [x] 推进 Phase 2 最小部分：静态 feature module registry 与 `openclaw-side-panel` manifest。
- [x] 完成 rose-skill 审核修复：trusted pairing、Bridge URL+token gate、Options 配置入口、popup 显式打开入口、Phase 文案同步。
- [x] 完成 Chrome for Testing unpacked extension smoke：扩展加载、Side Panel 页面渲染、Popup 打开入口、Options Bridge 配置项。
- [x] 推进 Phase 3：Session Bridge Adapter MVP。
- [x] 本地提交 Phase 3 adapter/UI/harness 变更：`e01e902 Add side panel session bridge adapter`。
- [x] 推进 Phase 4：New/Switch actions with confirmation gates。
- [x] 本地提交 Phase 4 action/UI/harness 变更：`6a74f5c Add side panel session actions`。
- [x] 推进 Phase 5：Page Context Dock and Deep Research entry。
- [x] 按主线回调 UI：Side Panel 核心改为会话控制优先，页面上下文降为辅助能力。
- [x] 参考旧 Session Bridge 和旧浏览器对接方式，补齐 organization / route type / operator id 配置。
- [x] 验证真实 Session Bridge `http://100.79.143.105:8766` 可用，旧 `127.0.0.1:8787` 不是 Session Bridge。
- [x] 本机 Chrome for Testing 手工 profile 已配置真实 Gateway + Session Bridge + route mapping，并完成 OpenClaw paired/online。
- [x] Chrome host permission 弹窗“允许”已授权，扩展权限状态为 granted。
- [x] 修复 Service Worker 中 `fetch` 非绑定调用导致的 `Illegal invocation`。
- [x] Session Bridge `/v1/sessions` 504 已定位并在 B 侧源码修复：exact route 第一项 scoped 命中后短路，避免继续请求慢 agent key。
- [x] 临时 patched Bridge HTTP API smoke：`http://127.0.0.1:18766/v1/sessions?debug=true` 返回 26 个 sessions，raw route key scoped 命中并 short-circuit。
- [x] Chrome for Testing real sessions UI smoke：临时 extension copy + dummy gateway online gate + patched Bridge，Side Panel Ready 且稳定渲染 26 个真实 sessions。
- [x] 重启/部署正式 B 服务，使 `100.79.143.105:8766` 加载短路源码和 debug timing。
- [x] 正式 B 服务重启后 `/v1/sessions?debug=true` 返回 26 个 sessions，`has_timings=true`，raw route key `4212ms`，`short_circuited=true`，`total_ms=6003`。
- [x] Chrome for Testing 指向正式 Bridge UI smoke：`Ready`、26 个 session cards、刷新周期后稳定、无横向溢出。截图：`/tmp/openclaw-sidepanel-real-prod-sessions-20260618.png`。
- [x] 新增 `06-identity-permission-model.md`，冻结用户视角、多班底实例、OAuth 身份和数据隔离模型。
- [x] 新增 `07-bondie-multi-instance-product-architecture.md`，冻结“实例切换器 + 全部合集分组列表”的 UI 方向。
- [x] 新增 `08-bondie-device-bridge-distribution.md`，冻结多设备 bridge / Tailscale / registry / 标准分发方向。
- [x] 新增 `09-bondie-multi-instance-prd.md`，明确阶段计划和验收标准。
- [x] 新增 `11-session-bridge-fix-runbook.md`，记录 B 侧 504 修复和回退路径。
- [x] 将权限模型同步到 Linear：新增 `AIC-3043`。
- [x] 将 Bondie 多实例和设备分发主线同步到 Linear 子任务树：新增 `AIC-3043` / `AIC-3044` / `AIC-3045`，并评论父任务 `AIC-2911`。
- [x] 更新 Linear `AIC-3045` 为 `In Progress`，评论同步 B 侧源码修复、验证结果和剩余复测 gate。
- [x] Phase 7A Chrome for Testing real regression：临时 extension copy + dummy gateway online gate + official Bridge，`Ready`、26 个真实 session cards、2 个 instance chips、1 个 group、无横向溢出。截图：`/tmp/openclaw-sidepanel-phase7-real-20260618-v3.png`。
- [x] Phase 7A Chrome for Testing fixture smoke：Bondie A/B/C 三实例、4 个 fixture session cards、4 个 instance chips、3 个 groups、从属 `查看全部` / 沟通 `仅相关` badge 可见、new/switch disabled、Bondie B chip 过滤后 1 个 session、无横向溢出。截图：`/tmp/openclaw-sidepanel-phase7-fixtures-20260618-v3.png`。
- [x] Phase 7B message contract smoke：`list({instanceId:"legacy-session-bridge"})` 返回 26 个真实 sessions；`list({instanceId:"bondie-b"})` 在 legacy mode 返回 `instance_unavailable`；fixture `list({instanceId:"bondie-b"})` 返回 1 个 session；fixture `new({instanceId:"bondie-b"})` 返回 `fixture_read_only`。
- [x] Phase 7B identity gate：新增 `sidePanelIdentityMode`，`legacy-paired` 保留真实 Bridge 路径，`oauth` 在 adapter 未接入前 fail closed 为 `identity_required`。
- [x] Phase 7B provider gate：新增 `sidePanelInstanceProvider`，`legacy-session-bridge` 保留真实 Bridge 路径，`bondie-control-plane` 在 OAuth/control-plane adapter 未接入前 fail closed，不回退 legacy sessions。
- [x] Phase 7C Control Plane contract：新增 `control-plane-contract.js` 和 `12-control-plane-contract.md`，冻结生产 API / payload / confirmation 规则。
- [x] Phase 7C contract smoke 脚本：新增 `scripts/test-control-plane-contract.mjs`，后续可直接复跑。
- [x] Phase 7C Control Plane adapter skeleton：新增 `control-plane-adapter.js`，支持 readiness、identity、instances、instance sessions、new/switch action 的 fake-fetch 验证。
- [ ] 本地提交 Phase 7C Control Plane adapter skeleton。

## Linear 树

- [AIC-2911](https://linear.app/fyaic/issue/AIC-2911/feature-openclaw-browser-side-panel-可拆卸会话控制模块): Feature: OpenClaw Browser Side Panel - 可拆卸会话控制模块
- [AIC-2912](https://linear.app/fyaic/issue/AIC-2912/docs-browser-side-panel-harness-and-legacy-migration-contract): Docs: Browser Side Panel harness and legacy migration contract
- [AIC-2913](https://linear.app/fyaic/issue/AIC-2913/feature-side-panel-manifest-and-shell-chromeedge-entry): Feature: Side Panel manifest and shell - Chrome/Edge entry
- [AIC-2914](https://linear.app/fyaic/issue/AIC-2914/feature-openclaw-side-panel-feature-module-registry): Feature: openclaw-side-panel feature module registry
- [AIC-2915](https://linear.app/fyaic/issue/AIC-2915/feature-session-bridge-adapter-mvp-for-browser-side-panel): Feature: Session Bridge adapter MVP for Browser Side Panel
- [AIC-2916](https://linear.app/fyaic/issue/AIC-2916/feature-conversation-newswitch-actions-with-confirmation-gates): Feature: Conversation new/switch actions with confirmation gates
- [AIC-2917](https://linear.app/fyaic/issue/AIC-2917/feature-page-context-dock-and-deep-research-entry-in-side-panel): Feature: Page Context Dock and Deep Research entry in Side Panel
- [AIC-2918](https://linear.app/fyaic/issue/AIC-2918/qa-browser-side-panel-visualstability-gates-and-safari-adaptation-plan): QA: Browser Side Panel visual/stability gates and Safari adaptation plan
- [AIC-3043](https://linear.app/fyaic/issue/AIC-3043/feature-bondie-多实例-side-panel-权限与-ui-从属沟通关系合集视图): Feature: Bondie 多实例 Side Panel 权限与 UI - 从属/沟通关系合集视图
- [AIC-3044](https://linear.app/fyaic/issue/AIC-3044/feature-bondie-control-plane-与-bridge-registry-多设备路由和标准分发): Feature: Bondie Control Plane 与 Bridge Registry - 多设备路由和标准分发
- [AIC-3045](https://linear.app/fyaic/issue/AIC-3045/bug-session-bridge-sessionslist-504-阻断真实-side-panel-会话列表): Bug: Session Bridge sessions.list 504 - 阻断真实 Side Panel 会话列表

## Phase 1 实现草案

- [x] 在 manifest 加入 `sidePanel` permission 和 `side_panel.default_path`。
- [x] 新增 `extension/src/sidepanel/sidepanel.html`。
- [x] 新增 `extension/src/sidepanel/sidepanel.js`。
- [x] 新增 `extension/src/sidepanel/sidepanel.css` 或复用现有 styles 变量。
- [x] background 支持 `sidePanel.status` message。
- [x] popup 提供用户手势触发的“打开 Side Panel”入口，不替代默认 action popup。
- [x] browser smoke: Chrome for Testing 可加载 unpacked extension，Side Panel 页面可渲染，Popup 打开入口可返回 `side-panel-open-requested`。

## Phase 2 最小实现草案

- [x] 新增 `extension/src/modules/openclaw-side-panel/module.js` 静态 feature module。
- [x] 新增 `extension/plugins/openclaw-side-panel/plugin.json`。
- [x] background 通过本地 registry 路由 `sidePanel.*` 消息。
- [x] disabled/missing config/paired/online 状态有明确响应。
- [x] side panel ready gate 基于 trusted paired + online + Bridge URL/token fully configured。
- [x] Options 页提供 Side Panel / Session Bridge 配置入口。
- [x] 将 `sidePanel.sessions.list` 从占位推进到 Session Bridge adapter。
- [x] 将 `sidePanel.sessions.new` / `sidePanel.sessions.switch` 推进到 Phase 4 confirmation-gated actions。

## Phase 3 实现草案

- [x] 新增 `extension/src/modules/openclaw-side-panel/contract.js`，隔离通用 scope 到旧 B API query 的临时映射。
- [x] 新增 `extension/src/modules/openclaw-side-panel/session-adapter.js`，支持 `/health`、`/v1/bridge`、`/v1/sessions`。
- [x] 缺 Bridge URL/token 时 fail closed，不发请求。
- [x] 缺 host permission 时返回 `permission_required`，不发请求。
- [x] Side Panel UI 提供用户手势触发的 Bridge host permission 授权入口。
- [x] Side Panel UI 渲染 adapter 返回的 scoped sessions，不合成全局/最近/模糊会话。
- [x] Phase 3 仍禁用 new/switch，保留 Phase 4 confirmation gate。

## Phase 4 实现草案

- [x] `newConversation(scope, options)` 调用 `POST /v1/sessions/new`，payload 不发送 `session_id`。
- [x] `switchSession(scope, sessionId, options)` 调用 `POST /v1/switch-session`，缺少 `session_id` 时 fail closed。
- [x] Side Panel UI 对 new/switch 均做二次确认。
- [x] 新开完成态只看 `new_conversation_confirmed=true`。
- [x] 切换完成态只看 `route_switch_confirmed=true`。
- [x] delivery 状态与 route/session confirmation 分开展示。
- [x] 未确认结果不刷新 current session 标记。

## Phase 5 实现草案

- [x] Side Panel 复用 background `pageMeta` 做轻量页面类型识别，刷新阶段不读取页面正文。
- [x] Side Panel 提供“快速读懂 / 解析当前页 / 深度调研”入口，按钮文案复用 popup article/video/github/webpage 口径。
- [x] 用户主动点击页面任务后才调用 `pageService`，再进入正文读取和 handoff 创建路径。
- [x] 页面任务点击后先请求当前 origin optional host permission，再读取页面正文。
- [x] Page Context Dock 展示当前页标题、URL、内容类型、任务结果、capture id、TLDR 摘要和 Markdown artifact 路径。
- [x] Page Context Dock 展示最近 handoff 状态，失败/本地捕获/处理中可追踪。
- [x] “历史”二级入口打开 `src/history.html`。
- [x] 页面上下文入口保留在 Side Panel，但排在 OpenClaw 会话与当前路由之后，避免偏离 session switching 主线。
- [x] Page Context Dock 刷新失败不拖垮 Side Panel 主状态。

## Phase 6 实现草案

- [x] Side Panel 首屏顺序调整为：连接状态 -> OpenClaw 会话 -> 当前路由 -> 页面上下文。
- [x] 未配对/离线状态提供侧栏内“连接 OpenClaw”按钮，不再要求用户先回 popup。
- [x] Options 增加 `sidePanelOrganization`、`sidePanelRouteType`、`sidePanelOperatorId`，支持旧 B 的 direct/group/browser route 映射。
- [x] `buildSessionBridgeQuery` 使用显式 organization，不再把 workspace 强行写入旧 B 的 organization 字段。
- [x] 真实旧 scope smoke：`organization=弗忧联盟`、`chat_type=direct`、`conversation_key=woGd...` 可列出 28 个 scoped sessions。
- [x] Chrome for Testing layout smoke：420px 近似侧栏宽度下会话区排在页面上下文之前，连接按钮可见，按钮/长 route 不溢出。
- [x] Chrome for Testing real E2E：dummy Gateway paired/online gate + Bridge host permission pregrant 后，Side Panel UI 稳定渲染真实 26 个 sessions。

## Phase 7 Bondie 多实例身份、权限与 UI 草案

- [x] 文档冻结：浏览器插件是用户视角，不是设备视角。
- [x] 文档冻结：从属关系 `subordinate/all_sessions`，沟通关系 `communication/participant_sessions`。
- [x] 文档冻结：脱离 WeCom 后仍需要 OpenClaw/AIC OAuth 或等价身份体系。
- [x] 文档冻结：device pairing 不能替代 user identity。
- [x] 文档冻结：默认 UI 使用“实例切换器 + 全部合集分组列表”，不做 ABC 三列并排。
- [x] 文档冻结：浏览器默认不直连所有 bridge，优先走 Bondie control plane。
- [x] 增加 `sidePanel.identity.status` message stub，当前返回 paired-browser-host viewer；生产 OAuth adapter 待 Phase 7B。
- [x] 增加 `sidePanel.instances.list` message stub，当前支持 legacy Bridge instance 和 fixtures；生产 permitted instances adapter 待 Phase 7B。
- [x] 设计并实现 UI 侧 `instances/groups/sessions` payload 兼容层，旧 Session Bridge 单 scope 被包装为 legacy instance。
- [x] UI 增加实例切换器和合集分组列表。
- [x] UI 为从属关系标注“查看全部”，为沟通关系标注“仅相关”。
- [x] 增加 fixtures：个人私助 A、团队共享 B、他人分享 C。
- [x] 增加 fixture action fail-closed：fixture 模式下 UI 禁用 new/switch，background message 也返回 `fixture_read_only`。
- [ ] 设计 OAuth identity adapter：生产 `sidePanel.identity.status`。
- [ ] 设计 permitted instances adapter：生产 `sidePanel.instances.list`。
- [x] 设计并实现 extension message-level instance contract：`list/new/switch({ instanceId })`。
- [x] 新增 identity mode gate：`legacy-paired` / `oauth`，OAuth mode 未接入 adapter 前 fail closed。
- [x] 新增 instance provider gate：`legacy-session-bridge` / `bondie-control-plane`，control-plane mode 未接入 adapter 前 fail closed。
- [x] 设计 production control-plane instance API：`list/new/switch({ instanceId })`。
- [x] 新增 Control Plane contract helper：endpoint builder、OAuth header builder、identity/instances/sessions/action normalizer。
- [x] 新增 Control Plane adapter skeleton：缺 URL/缺 token 不发请求，fake fetch 可验证生产 endpoint 和 confirmation gate。
- [ ] 增加 fail-closed tests：未 OAuth、仅 pairing、无 relationship、沟通关系越权。

## Phase 8 Bondie 设备 Bridge 与标准分发草案

- [x] 文档冻结：每个 Bondie/OpenClaw 设备需要本地 Session Bridge 或等价组件。
- [x] 文档冻结：Tailscale/private network 解决 control plane 到 bridge 的可达性，不等于用户有 session 权限。
- [x] 文档冻结：bridge token 应保存在服务端 control plane，不默认下发到 extension。
- [x] 文档冻结：当前 Mac mini bridge 是 legacy single-device reference。
- [ ] 设计 bridge registry schema：instance id、bridge id、endpoint、health、capabilities。
- [ ] 设计设备 onboarding checklist：OpenClaw、Tailscale、bridge、launchd/systemd、smoke。
- [ ] 设计 multi-bridge health aggregation 和 readiness gate。
- [x] 将 B `/v1/sessions` Gateway 504 性能修复拆为 B 侧依赖任务，并完成源码修复记录。

## 本轮验证

- [x] `python3 -m json.tool "extension/manifest.json" >/dev/null`
- [x] `python3 -m json.tool "extension/plugins/openclaw-side-panel/plugin.json" >/dev/null`
- [x] `node --check "extension/src/background.js"`
- [x] `node --check "extension/src/background-entry.js"`
- [x] `node --check "extension/src/content.js"`
- [x] `node --check "extension/src/options.js"`
- [x] `node --check "extension/src/popup.js"`
- [x] `node --check "extension/src/confirm.js"`
- [x] `test ! -f "extension/src/history.js" || node --check "extension/src/history.js"`
- [x] `test ! -f "extension/src/pattern-memory.js" || node --check "extension/src/pattern-memory.js"`
- [x] `node --check "extension/src/modules/openclaw-side-panel/module.js"`
- [x] `test ! -f "extension/src/sidepanel/sidepanel.js" || node --check "extension/src/sidepanel/sidepanel.js"`
- [x] `./scripts/package-extension.sh`
- [x] `git diff --check`
- [x] Chrome for Testing unpacked extension smoke：service worker 注册、Side Panel 页面渲染、Popup 打开入口、Options Bridge 配置项。
- [x] `node --check "extension/src/modules/openclaw-side-panel/contract.js"`
- [x] `node --check "extension/src/modules/openclaw-side-panel/session-adapter.js"`
- [x] Chrome for Testing adapter smoke：缺 host permission 不发请求；授权后 `/health`、`/v1/bridge`、`/v1/sessions` 路径和 Bearer header 正常；公开 payload 不含 token。
- [x] Chrome for Testing visual smoke：390px 侧栏宽度下 scoped sessions、长 route key、长 session key 不重叠。
- [x] Chrome for Testing action adapter smoke：new payload 不含 `session_id`；switch 缺 `session_id` 拒绝；switch payload 必含目标 `session_id`；confirmed gate 正常；公开 payload 不含 token。
- [x] Chrome for Testing action visual smoke：390px 侧栏宽度下二次确认后操作结果、未确认态、delivery 状态和 message card preview 不重叠。
- [x] Chrome for Testing Page Context Dock smoke：390px 侧栏宽度下识别当前网页、按钮状态正确、页面上下文位于第一屏中段、无横向溢出。
- [x] Chrome for Testing Page Context Dock narrow smoke：320px 侧栏宽度下按钮单列堆叠、长标题/URL 不溢出。
- [x] Chrome for Testing history link smoke：Side Panel “历史”按钮打开 `chrome-extension://<id>/src/history.html`。
- [x] 本机 Google Chrome dev profile 人工体验入口已加载：profile `~/Library/Application Support/Google/Chrome OpenClaw Browser Host Dev`，extension id `fignfifoniblkonapihmkfakmlgkbkcf`，已打开 GitHub 仓库页、`src/sidepanel/sidepanel.html`、`src/options.html`。
- [x] Direct Session Bridge smoke：`/health` 返回 `mac-mini-session-bridge`；旧 WeCom direct scope 返回 28 个 sessions。
- [x] Negative scope smoke：浏览器默认 `chat_type=browser` scope 返回 0 sessions / scope mismatch，证明必须提供旧 route mapping 配置。
- [x] Chrome for Testing real config smoke：当前扩展加载最新代码，Options 新字段存在，Bridge host permission 可授权。
- [x] Chrome for Testing session-first layout smoke：`OpenClaw 会话` 位于 `当前路由` 和 `页面上下文` 之前。
- [x] Chrome for Testing real paired/online smoke：手工 profile `9340` 已 connected/registered/online/paired。
- [x] Chrome for Testing real host permission smoke：手工 profile `9342` 已授权 `http://100.79.143.105:8766/*`。
- [x] B 侧源码验证：`tests.test_gateway_adapter` 26 tests OK；`tests.test_api_contract` 6 tests OK；`compileall app tests` OK；`git diff --check` OK。
- [x] B 侧真实 Gateway 只读 adapter smoke：`session_count=26`、`reason=ok`、raw route key `4115ms` 命中并 `short_circuited=true`、`total_ms=5904`。
- [x] B 侧临时 patched HTTP smoke：`/health` 200、`/v1/bridge` 200、`/v1/sessions?debug=true` 200，`session_count=26`、`reason=ok`、raw route key `4998ms`、`short_circuited=true`、`total_ms=7020`。
- [x] 正式 `100.79.143.105:8766` 只读 HTTP smoke：`/health` 200、`/v1/bridge` 200、`/v1/sessions` 200、`session_count=26`；但无 debug timing，说明运行中进程仍可能是旧代码。
- [x] Chrome for Testing real sessions UI smoke：`Ready`、Bridge `OpenClaw Mac mini Session Bridge`、26 个 session cards、等待 8.5s 刷新周期后仍保持 26 个、无横向溢出。截图：`/tmp/openclaw-sidepanel-real-sessions-stable-20260618.png`。
- [x] 正式 B restart smoke：old PID `1281` -> new PID `65427`，launchd label `com.openclaw.session-bridge`，`/health` 200。
- [x] 正式 B patched debug smoke：`/v1/sessions?debug=true` 200，`session_count=26`，`reason=ok`，`has_timings=true`，`short_circuited=true`。
- [x] Chrome for Testing official Bridge UI smoke：temporary extension copy + dummy gateway online gate + official Bridge，`Ready`，26 个真实 sessions，无横向溢出。截图：`/tmp/openclaw-sidepanel-real-prod-sessions-20260618.png`。
- [x] Phase 7A syntax：`node --check "extension/src/options.js"`。
- [x] Phase 7A syntax：`node --check "extension/src/modules/openclaw-side-panel/module.js"`。
- [x] Phase 7A syntax：`node --check "extension/src/sidepanel/sidepanel.js"`。
- [x] Phase 7A diff hygiene：`git diff --check`。
- [x] Phase 7A Chrome for Testing official Bridge regression：`Ready`，26 个真实 sessions，2 chips，1 group，稳定提示，无横向溢出。截图：`/tmp/openclaw-sidepanel-phase7-real-20260618-v3.png`。
- [x] Phase 7A Chrome for Testing fixtures smoke：Bondie A/B/C，4 sessions，3 groups，权限 badge，可切换 Bondie B，fixture actions disabled，Options `Bondie preview` 可配置，无横向溢出。截图：`/tmp/openclaw-sidepanel-phase7-fixtures-20260618-v3.png`。
- [x] Phase 7B Chrome for Testing message contract smoke：legacy instance list 26 sessions；legacy unknown instance `instance_unavailable`；fixture Bondie B list 1 session；fixture Bondie B new action `fixture_read_only`。
- [x] Phase 7B Chrome for Testing identity gate smoke：默认 `legacy-paired` 可加载 26 sessions；切换 `sidePanelIdentityMode=oauth` 后 `sidePanel.status` 为 `identity_required`，sessions/instances 均为空。
- [x] Phase 7B Chrome for Testing provider gate smoke：默认 `legacy-session-bridge` 可加载 26 sessions；切换 `sidePanelInstanceProvider=bondie-control-plane` 后 `sidePanel.status` 为 `identity_required`，sessions/instances 均为空，new action 返回 `identity_required`。
- [x] Phase 7C syntax：`node --check "extension/src/modules/openclaw-side-panel/control-plane-contract.js"`。
- [x] Phase 7C diff hygiene：`git diff --check`。
- [x] Phase 7C contract smoke：normalize A/B/C instances、过滤无效权限、保留 Control Plane URL path prefix、session 补充 instance metadata、new/switch confirmation gate。
- [x] Phase 7C repeatable smoke：`node "scripts/test-control-plane-contract.mjs"`，输出 `{"ok":true,"instances":2,"sessions":1,"adapterCalls":4}`。
- [x] Phase 7C syntax：`node --check "extension/src/modules/openclaw-side-panel/control-plane-adapter.js"`。

## 待确认

- [x] Session Bridge MVP 继续作为独立本地/私网服务，由 `sessionBridgeBaseUrl` + `sessionBridgeToken` 配置。
- [ ] Side Panel 是否需要成为默认 action 点击行为，还是保留 popup 并另设入口。
- [x] Session Bridge token 走现有 Options 页的 Side Panel / Session Bridge 配置区，UI/diagnostics 只显示已配置状态。
- [x] 本轮执行记录已同步到 Linear `AIC-2913` / `AIC-2914` 评论。
- [x] 本轮 Phase 3 执行记录同步到 Linear `AIC-2915` 评论。
- [x] 本轮 Phase 4 执行记录同步到 Linear `AIC-2916` 评论。
- [x] 本轮 Phase 5 执行记录同步到 Linear `AIC-2917` 评论。
- [x] Linear `AIC-2917` 状态更新为 `In Progress`。
- [ ] 是否批量更新 Linear issue 状态。
- [ ] OAuth provider 使用 OpenClaw 账号、AIC 账号，还是独立身份服务。
- [ ] 班底实例 registry 由 OpenClaw Gateway、Session Bridge，还是独立权限服务提供。
- [ ] Bondie control plane 是否作为新服务承载 OAuth、relationship、bridge registry 和 proxy。
