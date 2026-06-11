# AI 自检清单

每次推进本主线后按此检查。未通过项写入 `TODO.md` 或 `99-deviation-log.md`。

## 范围检查

- [ ] 变更仍服务 OpenClaw Browser Side Panel 主线。
- [ ] 没有把 WeCom OAuth/JS-SDK/panel_token 作为新系统依赖。
- [ ] 没有引入 Native Messaging，除非人类明确确认。
- [ ] 没有默认请求 `<all_urls>`。
- [ ] 没有静默读取页面正文或上传完整浏览历史。
- [ ] 没有实现完整多 Agent provider。

## 架构检查

- [ ] Side Panel UI 只通过 background message API 通信。
- [ ] background 仍是唯一 transport/pairing/storage owner。
- [ ] `openclaw-side-panel` 能作为 feature module 启用/禁用。
- [ ] session adapter 隔离了旧 B API 的 WeCom 命名。
- [ ] popup、options、history、confirm 的既有路径没有被破坏。

## Session 契约检查

- [ ] list sessions 只展示 adapter/OpenClaw 返回的 scoped sessions。
- [ ] scope 不足时 fail closed，不展示全局/最近/模糊 session。
- [ ] new-session 不发送 `session_id`。
- [ ] switch-session 必须发送目标 `session_id`。
- [ ] current 标记以 `session_id` 优先，不只看 `session_key`。
- [ ] `new_conversation_confirmed=true` 才显示新开完成。
- [ ] `route_switch_confirmed=true` 才显示切换完成。
- [ ] delivery 状态与 route/session confirmation 分开展示。

## 安全检查

- [ ] token 不打印到 console、history、operation result 或文档样例。
- [ ] UI/网页传入的 route label 不覆盖 trusted scope。
- [ ] content script payload 不作为授权源。
- [ ] debug/raw session 信息不出现在普通用户 UI。
- [ ] 错误信息面向用户，diagnostic 可展开且脱敏。

## UX 检查

- [ ] Side Panel 宽度下标题、按钮、URL、session key 不溢出。
- [ ] loading、empty、offline、unpaired、unconfirmed、failed 都有明确状态。
- [ ] destructive 或高影响 action 有二次确认。
- [ ] disabled button 有可理解原因。
- [ ] 视觉语言与 alpha.12 popup/options/history 一致。
- [ ] 不出现死亡大直角、卡片套卡片、拥挤工具栏。

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
test ! -f "extension/src/sidepanel/sidepanel.js" || node --check "extension/src/sidepanel/sidepanel.js"
./scripts/package-extension.sh
```

浏览器 gate：

- [ ] Chrome unpacked extension loads.
- [ ] Side Panel opens.
- [ ] Popup still opens.
- [ ] Options still opens.
- [ ] Background service worker has no uncaught runtime error.
- [ ] Screenshots show no overlap or broken responsive layout.

