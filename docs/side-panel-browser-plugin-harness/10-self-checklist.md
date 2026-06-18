# AI 自检清单

每次推进本主线后按此检查。未通过项写入 `TODO.md` 或 `99-deviation-log.md`。

## 范围检查

- [x] 变更仍服务 OpenClaw Browser Side Panel 主线。
- [x] 没有把 WeCom OAuth/JS-SDK/panel_token 作为新系统依赖。
- [x] 明确需要 OpenClaw/AIC OAuth 或等价用户身份，不用 device pairing 替代用户身份。
- [x] 没有引入 Native Messaging，除非人类明确确认。
- [x] 没有默认请求 `<all_urls>`。
- [x] 没有静默读取页面正文或上传完整浏览历史。
- [x] Page Context Dock 刷新阶段只读取 tab metadata，正文读取仅由用户主动点击页面任务触发。
- [x] 没有实现完整多 Agent provider。

## 架构检查

- [x] Side Panel UI 只通过 background message API 通信。
- [x] background 仍是唯一 transport/pairing/storage owner。
- [x] `openclaw-side-panel` 能作为 feature module 启用/禁用。
- [x] session adapter 隔离了旧 B API 的 WeCom 命名。
- [x] Side Panel 页面任务复用既有 `pageMeta` / `pageService` / `handoffs` message contract，没有复制 media-to-notes pipeline。
- [x] popup、options、history、confirm 的既有路径没有被破坏。
- [x] Side Panel 首屏以 OpenClaw 会话新开/恢复为主，页面上下文只作为辅助 dock。

## Session 契约检查

- [x] list sessions 只展示 adapter/OpenClaw 返回的 scoped sessions。
- [x] scope 不足时 fail closed，不展示全局/最近/模糊 session。
- [x] new-session 不发送 `session_id`。
- [x] switch-session 必须发送目标 `session_id`。
- [x] current 标记以 `session_id` 优先，不只看 `session_key`。
- [x] `new_conversation_confirmed=true` 才显示新开完成。
- [x] `route_switch_confirmed=true` 才显示切换完成。
- [x] delivery 状态与 route/session confirmation 分开展示。

## 权限模型检查

- [x] 文档区分从属关系和沟通关系。
- [x] 从属关系对应 `all_sessions`，可查看该班底实例全部 sessions。
- [x] 沟通关系对应 `participant_sessions`，只查看当前用户相关 sessions。
- [x] 多班底实例是用户视角聚合，不是设备视角或单账号单实例假设。
- [x] 未完成 OAuth、无 relationship、权限不完整时 fail closed。
- [x] 浏览器页面、DOM、URL、用户手填 label 不能提升权限。
- [x] 旧 Session Bridge adapter 仅作为兼容路径，不作为最终权限模型。
- [x] Bondie A/B/C 多实例默认用实例切换器 + 合集分组列表，不做侧栏三列并排。
- [x] 浏览器默认不保存每台 Bondie bridge token；多设备默认走 control plane / registry。
- [x] Tailscale/private network 只表示 control plane 到 bridge 可达，不表示用户有 session 权限。
- [x] `sidePanel.sessions.list({ instanceId })` 不会把未知 instance 回退到 legacy 全量 sessions。
- [x] fixture instance actions 返回 `fixture_read_only`，不触发真实 Bridge。
- [x] `sidePanelIdentityMode=oauth` 时未接入 OAuth adapter 前返回 `identity_required`，不列 sessions/instances。

## 安全检查

- [x] token 不打印到 console、history、operation result 或文档样例。
- [x] UI/网页传入的 route label 不覆盖 trusted scope。
- [x] content script payload 不作为授权源。
- [x] debug/raw session 信息不出现在普通用户 UI。
- [x] 错误信息面向用户，diagnostic 可展开且脱敏。

## UX 检查

- [x] Side Panel 宽度下标题、按钮、URL、session key 不溢出。
- [x] loading、empty、offline、unpaired、unconfirmed、failed 都有明确状态。
- [x] destructive 或高影响 action 有二次确认。
- [x] disabled button 有可理解原因。
- [x] 视觉语言与 alpha.12 popup/options/history 一致。
- [x] 不出现死亡大直角、卡片套卡片、拥挤工具栏。
- [x] article/video/github/webpage 的页面任务文案与 popup 保持一致。
- [x] 页面任务状态、TLDR、artifact 路径和失败信息能在 Side Panel 或 History 中追踪。
- [x] Page Context Dock 在 390px/320px 侧栏宽度下无横向溢出，窄宽按钮单列堆叠。
- [x] OpenClaw 会话区排在当前路由和页面上下文之前。
- [x] 未配对/离线时 Side Panel 内有直接连接 OpenClaw 的入口。
- [x] 多实例视图中每个 session group 都能看到所属 Bondie 和权限范围。
- [x] 从属/沟通 badge 不挤占 session 标题主体，320px/420px 宽度下不溢出。

## 验证命令

文档变更：

```bash
git diff --check
python3 -m json.tool "extension/manifest.json" >/dev/null
```

代码变更：

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/background-entry.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
test ! -f "extension/src/history.js" || node --check "extension/src/history.js"
test ! -f "extension/src/pattern-memory.js" || node --check "extension/src/pattern-memory.js"
test ! -f "extension/src/modules/openclaw-side-panel/contract.js" || node --check "extension/src/modules/openclaw-side-panel/contract.js"
test ! -f "extension/src/modules/openclaw-side-panel/session-adapter.js" || node --check "extension/src/modules/openclaw-side-panel/session-adapter.js"
test ! -f "extension/src/modules/openclaw-side-panel/module.js" || node --check "extension/src/modules/openclaw-side-panel/module.js"
test ! -f "extension/src/sidepanel/sidepanel.js" || node --check "extension/src/sidepanel/sidepanel.js"
./scripts/package-extension.sh
```

浏览器 gate：

- [x] Chrome unpacked extension loads.
- [x] Side Panel opens.
- [x] Popup still opens.
- [x] Options still opens.
- [x] Background service worker has no uncaught runtime error.
- [x] Screenshots show no overlap or broken responsive layout.
- [x] Page Context Dock metadata smoke passes at 390px.
- [x] Page Context Dock narrow smoke passes at 320px.
- [x] Side Panel History link opens `src/history.html`.
- [x] Real Session Bridge direct scope smoke can list scoped sessions.
- [x] Chrome for Testing official Bridge gate renders 26 real sessions with no horizontal overflow.
- [x] Phase 7A fixtures render Bondie A/B/C with correct visibility badges and disabled actions.
- [x] Phase 7B message contract smoke covers legacy instance, unknown instance, fixture instance filter, and fixture action gate.
- [x] Phase 7B identity gate smoke covers legacy-paired happy path and oauth fail-closed path.
- [ ] Real Google Chrome host permission gate approved and Side Panel renders latest local unpacked build in UI.
