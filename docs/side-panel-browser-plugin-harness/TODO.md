# TODO

## 状态

当前阶段：Phase 2 - Side Panel shell/registry 审核修复与 Chrome smoke 已完成，等待本地提交与 Session Bridge Adapter MVP。

## 已完成

- [x] 本地提交上一版浏览器插件稳定性改动。
- [x] 安装 `rose-skill` 到 `/Users/fuyo-aic/.codex/skills/rose-skill/SKILL.md`。
- [x] 创建新分支 `feature/openclaw-browser-side-panel-plugin`。
- [x] 阅读旧 A 侧 `wecom-sidepanel-probe` README/docs/tests。
- [x] 阅读旧 B 侧 `openclaw-session-bridge` README/docs/API/code。
- [x] 生成 browser side panel harness 文档。
- [x] 同步 Linear 父子任务树：AIC-2911 -> AIC-2912..AIC-2918。

## 下一步

- [x] 运行文档/代码验证命令。
- [x] 根据验证结果修正文档格式或链接问题。
- [x] 拆 Phase 1 实现 issue：Manifest and Side Panel Shell (`AIC-2913`)。
- [x] 拆 Phase 2 实现 issue：Feature Module Registry (`AIC-2914`)。
- [x] 拆 Phase 3 实现 issue：Session Adapter MVP (`AIC-2915`)。
- [ ] 将 Phase 0 文档变更提交到新分支。
- [x] 推进 Phase 1：Manifest and Side Panel Shell。
- [x] 推进 Phase 2 最小部分：静态 feature module registry 与 `openclaw-side-panel` manifest。
- [x] 完成 rose-skill 审核修复：trusted pairing、Bridge URL+token gate、Options 配置入口、popup 显式打开入口、Phase 文案同步。
- [x] 完成 Chrome for Testing unpacked extension smoke：扩展加载、Side Panel 页面渲染、Popup 打开入口、Options Bridge 配置项。
- [ ] 推进 Phase 3：Session Bridge Adapter MVP。

## Linear 树

- [AIC-2911](https://linear.app/fyaic/issue/AIC-2911/feature-openclaw-browser-side-panel-可拆卸会话控制模块): Feature: OpenClaw Browser Side Panel - 可拆卸会话控制模块
- [AIC-2912](https://linear.app/fyaic/issue/AIC-2912/docs-browser-side-panel-harness-and-legacy-migration-contract): Docs: Browser Side Panel harness and legacy migration contract
- [AIC-2913](https://linear.app/fyaic/issue/AIC-2913/feature-side-panel-manifest-and-shell-chromeedge-entry): Feature: Side Panel manifest and shell - Chrome/Edge entry
- [AIC-2914](https://linear.app/fyaic/issue/AIC-2914/feature-openclaw-side-panel-feature-module-registry): Feature: openclaw-side-panel feature module registry
- [AIC-2915](https://linear.app/fyaic/issue/AIC-2915/feature-session-bridge-adapter-mvp-for-browser-side-panel): Feature: Session Bridge adapter MVP for Browser Side Panel
- [AIC-2916](https://linear.app/fyaic/issue/AIC-2916/feature-conversation-newswitch-actions-with-confirmation-gates): Feature: Conversation new/switch actions with confirmation gates
- [AIC-2917](https://linear.app/fyaic/issue/AIC-2917/feature-page-context-dock-and-deep-research-entry-in-side-panel): Feature: Page Context Dock and Deep Research entry in Side Panel
- [AIC-2918](https://linear.app/fyaic/issue/AIC-2918/qa-browser-side-panel-visualstability-gates-and-safari-adaptation-plan): QA: Browser Side Panel visual/stability gates and Safari adaptation plan

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
- [ ] 将 `sidePanel.sessions.*` 从占位推进到 Session Bridge adapter。

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

## 待确认

- [ ] Session Bridge 是否继续作为独立本地/私网服务。
- [ ] Side Panel 是否需要成为默认 action 点击行为，还是保留 popup 并另设入口。
- [ ] Session Bridge token 是否走现有 options 页配置，还是 side panel 模块单独配置。
- [x] 本轮执行记录已同步到 Linear `AIC-2913` / `AIC-2914` 评论。
- [ ] 是否批量更新 Linear issue 状态。
