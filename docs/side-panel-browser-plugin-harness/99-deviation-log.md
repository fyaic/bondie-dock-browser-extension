# 执行偏差日志

## 2026-06-18

- 偏差：正式 Bridge 和单实例真实 sessions UI 已通过后，容易被误报为“复杂多 Bondie 权限需求已完成”。
  - 处理：更新 TODO 状态为 Phase 7A，仅声明 fixture UI、legacy compatibility 和 read-only gate 已完成；生产 OAuth、permission-aware instances API、control plane、bridge registry 和完整越权测试仍列为 Phase 7B/8 待办。

- 偏差：多 Bondie fixture 模式如果复用原 new/switch 按钮，可能误调用真实 legacy Session Bridge。
  - 处理：fixture sessions 标记 `actions_enabled=false` / `restorable=false`；Side Panel UI 禁用 new/switch；background `sidePanel.sessions.new` / `sidePanel.sessions.switch` 在 fixture 模式返回 `fixture_read_only`，双层 fail closed。

- 偏差：定时刷新真实 sessions 时，旧 UI 会把 action hint 长时间改为“正在刷新 Session Bridge 会话列表”，在 Bridge 查询慢时产生状态噪音。
  - 处理：已有 sessions 时刷新不再覆盖主 action hint；列表继续保持稳定，刷新完成后仍显示 new/switch confirmation gate 提示。

- 偏差：系统 Google Chrome 自动化加载 unpacked extension 未观测到 service worker，若继续使用会误判扩展不可用。
  - 处理：切回 Playwright 自带 Chrome for Testing，并显式移除 `--disable-extensions` 默认参数；Phase 7A smoke 使用临时 extension copy、dummy Gateway online gate 和 official Bridge 完成验证。

- 偏差：Phase 7A 虽然 UI 有实例切换器，但 background message 仍是隐式单 Bridge contract，后续 new/switch 容易继续依赖全局 legacy scope。
  - 处理：Phase 7B 给 `sidePanel.sessions.list/new/switch` 增加 `instanceId`；legacy mode 对未知 instance 返回 `instance_unavailable`，fixture action 返回 `fixture_read_only`，UI 执行动作时携带当前可操作 instance id。

- 偏差：如果继续默认用 device pairing 构造 viewer，开发者可能误把设备配对当成生产用户身份。
  - 处理：新增 `sidePanelIdentityMode`。默认 `legacy-paired` 只保留 direct Bridge 兼容路径；切换到 `oauth` 后，在真实 OAuth adapter 未接入前返回 `identity_required`，不列 sessions/instances，也不请求 Session Bridge。

- 偏差：引入 Bondie Control Plane provider 后，如果 provider 未实现时自动回退 legacy Bridge，会把生产权限路径误连到单 Bridge 开发路径。
  - 处理：新增 `sidePanelInstanceProvider`。默认 `legacy-session-bridge` 保持现有体验；切换到 `bondie-control-plane` 后要求 OAuth/control-plane adapter，当前返回 `identity_required` / `permission_unresolved`，不回退 legacy sessions。

- 偏差：如果直接实现 Control Plane fetch adapter，可能在 OAuth provider 和服务端归属未定时制造半通不通的生产路径。
  - 处理：Phase 7C 先落地纯 contract helper 和文档，冻结 endpoint、relationship/visibility 校验、payload normalizer 与 action confirmation 规则；runtime 仍保持 `bondie-control-plane` fail closed。

## 2026-06-17

- 偏差：新需求从 OpenClaw 单实例升级为 Bondie 多实例，但分支仍停留在 `feature/openclaw-browser-side-panel-plugin`。
  - 处理：已创建 `feature/bondie-multi-instance-permissions`，后续 Bondie 多实例权限主线在该分支推进，不影响 main。

- 偏差：如果把 Bondie A/B/C 做成三列并排，会在浏览器 Side Panel 320-420px 宽度下牺牲 session 可读性。
  - 处理：采用 taste 判断后的“实例切换器 + 全部合集分组列表”方案；三列并排不进入 Phase 7。

- 偏差：如果让浏览器 extension 直连每台 Bondie bridge，会要求用户设备进入多条 Tailscale/ACL，并把多台 bridge token 下发到本地。
  - 处理：默认设计改为 Browser -> Bondie control plane -> bridge registry -> per-device bridge；直连 bridge 只保留为开发/单机高级路径。

- 偏差：多设备可达性容易被误解为数据权限。
  - 处理：新增 `08-bondie-device-bridge-distribution.md`，明确 Tailscale 只解决网络可达，OAuth relationship / visibility policy 才决定 session 可见性。

- 偏差：早期 browser side panel harness 仍按“单个 Bridge / 单个 route scope”推进，容易把插件理解成设备视角或单账号单实例视角。
  - 处理：新增 `06-identity-permission-model.md`，明确浏览器插件是用户视角，必须支持一个用户访问多个班底实例。

- 偏差：早期文档写“替换 WeCom OAuth”，但没有明确新系统仍需要 OAuth 或等价用户身份，可能被误解为只靠 device pairing 或本地账号隔离。
  - 处理：修正 PRD、架构和自检清单：WeCom OAuth 不再依赖，但 OpenClaw/AIC OAuth user identity 是权限模型前置；device pairing 只证明设备，不证明用户。

- 偏差：Veil 初始思路偏“一人一个账号看自己的数据”，无法表达 Ren 指出的 N 对 N 网状关系。
  - 处理：冻结两类关系：从属关系 `subordinate/all_sessions` 可看该班底全部会话；沟通关系 `communication/participant_sessions` 只看当前用户相关会话。

- 偏差：当前 Session Bridge adapter 只能表达旧 B 的单 scoped route，不能完整表达“用户 -> 多班底实例 -> 关系权限 -> allowed sessions”。
  - 处理：保留旧 adapter 为 legacy compatibility path；新增 Phase 7 身份、OAuth、权限模型阶段，后续需要 permission-aware control plane。

## 2026-06-11

- 偏差：rose-skill 原文要求 harness 文件固定写到 Windows Vault 路径 `C:\Users\ryshi\Documents\Harness-Design\`。
  - 处理：本项目适配为 repo 内 `docs/side-panel-browser-plugin-harness/`，保证与分支和后续 PR 一起流转。

- 偏差：Phase 0 未联网复核 Chrome/Edge/Safari 最新 Side Panel API。
  - 处理：Phase 1 实现前已复核 Chrome for Developers `chrome.sidePanel` 和 Microsoft Edge Sidebar API 官方文档；Chrome/Edge 均要求 `sidePanel` permission 与 `side_panel.default_path`。Safari 仍仅保留后续适配评估，不进入本期实现。

- 偏差：旧 B API 仍以 `WeComBinding` 命名。
  - 处理：文档要求新 UI 层使用通用 `OpenClawSessionScope`，由 adapter 映射旧字段，避免污染新浏览器模型。

- 偏差：未读取全部 Obsidian 历史会议文档。
  - 处理：已读取两个代码项目的 README/docs/tests/code，足以冻结本轮主架构；如后续产品口径冲突，再补读 `/Users/fuyo-aic/Documents/AIC-000/T-B WeCom Side Panel/` 下的会议记录。

- 偏差：Phase 0 只写文档，未实现 Side Panel 代码。
  - 处理：符合当前任务“认真分析写到新分支下的文档中”；代码实现从 Phase 1 开始。

- 偏差：本轮未执行 Chrome/Edge unpacked extension 手动加载和侧栏打开 smoke。
  - 处理：已完成 manifest JSON、全部现有 JS syntax、sidepanel JS syntax、打包脚本和 `git diff --check` 验证；手动浏览器加载留给有真实 Chrome/Edge UI 的下一轮 gate。

- 偏差：rose-skill 审核发现 Phase 1/2 shell 存在状态 gate 漂移。
  - 处理：已改为 background 提供 trusted pairing 摘要，Side Panel module 不再用 `registered` 替代配对；Bridge ready/configured gate 改为同时要求 URL 与 token；UI 区分缺少 Bridge URL 与缺少 Bridge token。

- 偏差：Side Panel 提示配置 Bridge，但 Options 页原本没有对应配置入口。
  - 处理：Options 页已新增 OpenClaw Side Panel / Session Bridge 配置区，包含模块启用、adapter、Bridge URL、Bridge token、timeout、workspace、route key 和 route label；token 使用 password input 且不写入示例值。

- 偏差：manifest 有 `side_panel.default_path`，但用户缺少明确的 toolbar 打开路径。
  - 处理：popup 第一屏已新增“打开 Side Panel”按钮，通过用户手势调用 `chrome.sidePanel.open()`；未改变默认 action popup 行为。

- 偏差：TODO 已进入 Phase 2，但 Side Panel payload 仍显示 Phase 1。
  - 处理：module phase payload 与侧栏默认文案已同步为 Phase 2 shell/registry ready，next 指向 Phase 3 Session Bridge Adapter MVP。

- 偏差：`aic-issues` skill 常量中的 `Axia` label id 在当前 Linear 可见标签中不可用，首次创建 issue 被拒绝。
  - 处理：未生成半截 issue；查询真实标签后改用有效的 `Feature` + `liev` 标签，成功创建并验证 `AIC-2911` 父子任务树。

- 偏差：系统 Google Chrome 自动化加载 unpacked extension 时未观测到 extension service worker 注册。
  - 处理：未将该次尝试计为通过；改用 Playwright 自带 Chrome for Testing 重新执行 smoke，确认 unpacked extension 可加载、service worker 注册、Side Panel 页面渲染、Popup 打开入口返回 `side-panel-open-requested`、Options Bridge 配置项存在。

- 偏差：Phase 3 adapter smoke 首次尝试在 extension service worker 内动态 `import()` adapter，被 Chrome 按 ServiceWorker 规范拒绝。
  - 处理：未将该次尝试计为失败产品行为；改在 extension page 上动态导入同一 adapter 模块完成 smoke，验证缺 host permission 不发请求、授权后 status/list 路径和 Bearer header 正常、公开 payload 不含 token。

- 偏差：旧 B `/v1/sessions` contract 仍使用 `WeComBinding` 字段名，且 `chat_type` 文档以 direct/group 为主。
  - 处理：浏览器 UI 和 background 模块仍使用通用 `OpenClawSessionScope`；`contract.js` 在 adapter 内做显式临时映射，当前 `route_type=browser` 不暴露到 UI。若 B 现场需要浏览器原生 route 解析，后续应在 B 或新 Gateway adapter 中增加 browser route contract，而不是把 WeCom 概念回灌到 Side Panel UI。

- 偏差：Phase 4 未对真实 Session Bridge 执行 `new-session` / `switch-session` mutation smoke。
  - 处理：真实 mutation 会改变 OpenClaw 会话路由，属于高影响操作；本轮用 Chrome for Testing fake adapter smoke 验证 new payload 不含 `session_id`、switch payload 必含 `session_id`、confirmed gate 与 token 脱敏。真实 Bridge action smoke 留到有明确测试 scope 与授权 token 时执行。

- 偏差：Phase 5 未对真实 OpenClaw 执行页面服务 mutation smoke。
  - 处理：真实 `pageService` 点击会读取当前网页正文、创建 handoff，并可能向 OpenClaw 发起 agent request；本轮只在临时 Chrome for Testing profile 中验证 metadata 刷新、按钮状态、历史入口、390px/320px 视觉与无预点击 handoff 展示。代码路径保持为用户主动点击后才调用 `pageService`；真实正文读取和 OpenClaw request smoke 应在明确测试 scope、host permission 和 token 后执行。

- 偏差：Phase 5 系统 Google Chrome 自动化仍未稳定观测到 unpacked extension service worker。
  - 处理：沿用 Playwright 自带 Chrome for Testing 作为自动化 gate；产物打包和代码检查仍使用 repo 本地文件。后续 Edge/Safari 适配阶段再做真实浏览器手工或专项自动化 gate。

- 偏差：按主线复查后发现 Phase 5 UI 把“页面上下文”放在“会话控制”之前，容易把 Side Panel 产品心智带偏成网页解析器。
  - 处理：Phase 6 调整为 session-first 首屏顺序：连接状态、OpenClaw 会话、当前路由、页面上下文；页面解析/深研保留为辅助 dock。

- 偏差：最初按 browser route 默认映射调用旧 Session Bridge，真实返回 0 sessions / scope mismatch。
  - 处理：参考旧 B `openclaw-session-bridge` contract 后补齐 `organization`、`route_type`、`operator_id` 配置；真实旧 direct scope 可列出 28 个 sessions。当前 adapter 仍作为临时兼容层，不把 WeCom 字段暴露到 Side Panel UI。

- 偏差：本地曾误把 `127.0.0.1:8787` 当成 Session Bridge。
  - 处理：真实 Session Bridge 为 `http://100.79.143.105:8766`，`/health` 返回 `mac-mini-session-bridge`；`8787` 属于其他 ACP/sample bridge，不纳入 Side Panel 配置。

- 偏差：Chrome for Testing E2E 首次为绕过配对写入假的 `browserDeviceToken`，导致扩展优先用假 device token 连接 Gateway，引发 `gateway token mismatch` 与后续短时认证限流。
  - 处理：该次不计入产品失败；测试脚本改回真实路径：先用 gateway token 发起配对，再批准设备，再重连。当前限流释放前不继续撞 Gateway；已保留 direct Bridge smoke 和 layout smoke 作为本轮有效验证。

- 偏差：系统 Google Chrome 命令行加载 unpacked extension 的 profile 行为不稳定，存在历史 extension id / service worker 缓存干扰。
  - 处理：自动化验证以干净 Chrome for Testing profile 为准；给人工体验保留已打开的 Chrome 测试 profile，但最终发布前需要用户通过 `chrome://extensions` 手动 Load unpacked 或专项脚本复核。

- 偏差：Chrome host permission 确认弹窗属于浏览器级 UI，CDP 点击 Side Panel 按钮后不能稳定自动点击“允许”。
  - 处理：手工 profile 已停在该确认弹窗；人工点击“允许”是当前唯一可信 gate。点击后无需重新配置，刷新 Side Panel 即可拉真实 Session Bridge sessions。

- 偏差：Bridge host permission 授权后，Service Worker 内 Session Bridge fetch 首次失败为 `Illegal invocation`。
  - 处理：修复 `OpenClawSessionAdapter` 默认 fetch 注入方式，改为箭头函数包装 `fetch(...args)`，避免把原生 fetch 作为对象方法调用。

- 偏差：修复 fetch 后，扩展权限与 Bridge status 已通过，但 `/v1/sessions` 返回 HTTP 504。
  - 处理：直连 Session Bridge 使用同一 scope/token 也返回 HTTP 504，判断为 B/Gateway 临时超时，不是浏览器插件权限或 adapter 映射问题；保留为后续复测 gate。

- 偏差：B 侧 `/v1/sessions` 504 最初被记录为“等待 B/Gateway 恢复”，但主线推进需要明确是否可由本地源码修复。
  - 处理：已在 `/Users/fuyo-aic/Projects/openclaw-session-bridge` 建立修复记录并完成最小修复：exact route 第一项 scoped 命中后短路，避免继续请求慢 agent key；B 单测、API contract、compileall、diff check 均通过，直接 adapter smoke 返回 `session_count=26`、`reason=ok`、`short_circuited=true`、`total_ms=5904`。运行中 `http://100.79.143.105:8766` 仍需重启/部署后复测 Chrome real sessions UI。

- 偏差：首次 Chrome UI 自动化 smoke 截图显示 sessions 已渲染，但最终 DOM 计数读到 0。
  - 处理：定位为 `refreshSessions()` 每次刷新先清空列表造成的闪烁/竞态；已修改为已有 sessions 时刷新不先清空列表，只更新提示文本。复测等待 8.5 秒跨过刷新周期后仍稳定显示 26 个真实 session cards，无横向溢出。

- 偏差：正式 `100.79.143.105:8766` 当前已能返回 26 个 sessions，容易被误判为“不需要部署修复”。
  - 处理：正式响应没有 `debug.timings`，说明运行中服务仍可能是旧代码，只是本次 Gateway 响应未超时；仍建议后续安排低风险重启/部署，让正式服务具备 exact-route short-circuit 和 timing 诊断。

- 偏差：最初以为正式 Session Bridge 没有 launchd 配置，准备手动 `nohup uvicorn` 重启。
  - 处理：重启后发现服务由 launchd label `com.openclaw.session-bridge` 管理，plist 位于 `/Users/fuyo-aic/Library/LaunchAgents/com.openclaw.session-bridge.plist`。杀掉旧 PID 后 launchd 自动拉起新 PID `65427`；一次手动 `nohup` 启动尝试因端口已占用退出，最终只有 launchd 管理的进程监听。后续应使用 `launchctl kickstart -k "gui/$(id -u)/com.openclaw.session-bridge"`。

- 偏差：正式 Bridge 是否真正加载补丁需要用 `debug.timings` 验证，不能只看 `/v1/sessions` 是否返回 200。
  - 处理：正式重启后 `/v1/sessions?debug=true` 返回 `has_timings=true`、`short_circuited=true`、`session_count=26`、`total_ms=6003`；Chrome Side Panel 指向正式 Bridge 复测通过，稳定展示 26 个真实 sessions。
