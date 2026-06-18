# 实施顺序

本文件按依赖关系拆分后续实现。执行者应按阶段推进，每阶段结束更新 `TODO.md`。

## Phase 0: 文档和契约冻结

目标：

- 完成本 harness。
- 确认旧 A/B 可复用契约和必须替换的企业微信假设。
- 确认 feature module 目录与 message API 命名。

验证：

```bash
git diff --check
python3 -m json.tool "extension/manifest.json" >/dev/null
```

完成标准：

- `INIT.md` 可让接手 agent 5 分钟内启动。
- `01-PRD.md` 有明确包含/不包含。
- `04-plugin-module-contract.md` 能指导第一批代码。

## Phase 1: Manifest and Side Panel Shell

目标：

- 在 manifest 中加入 `sidePanel` permission 和 `side_panel.default_path`。
- 新增 `src/sidepanel/sidepanel.html/js/css`。
- background 初始化时设置 side panel 打开策略。
- Side Panel shell 展示配对、在线、adapter 配置状态。

验证：

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/background-entry.js"
node --check "extension/src/sidepanel/sidepanel.js"
./scripts/package-extension.sh
```

浏览器 gate：

- Chrome unpacked extension 可加载。
- 点击 extension action 或浏览器 side panel 入口能打开页面。
- service worker 冷启动后 Side Panel 能重新拉状态。

## Phase 2: Feature Module Registry

目标：

- 新增最小 module registry。
- 将 `sidePanel.*` message 从 background 主 switch 中隔离出来。
- 新增 `plugins/openclaw-side-panel/plugin.json`。
- 不重构现有 popup/page intelligence 逻辑。

验证：

- `sidePanel.status` 返回 enabled/configured/paired/online。
- disabled path 有明确响应。
- 现有 popup 功能不回归。

## Phase 3: Session Adapter MVP

目标：

- 实现 `OpenClawSessionAdapter`。
- 首个 adapter 目标为 Session Bridge HTTP。
- 配置项进入 Options 的高级/实验区。
- 支持 `/health`、`/v1/bridge`、`/v1/sessions`。

验证：

- bridge URL 缺失时不发请求。
- token 不泄漏到 UI 和日志。
- list sessions 只渲染 adapter 返回的数据。
- empty/unresolved/offline 状态可区分。

## Phase 4: New and Switch Actions

目标：

- `newConversation(scope, options)` 不发送 `session_id`。
- `switchSession(scope, sessionId, options)` 必须携带 session id。
- UI 二次确认。
- 完成态 gated by confirmed fields。

验证：

- mock unconfirmed new response 只显示“未确认”，不显示完成。
- mock unconfirmed switch response 只显示“未确认”，不标记 current。
- confirmed switch 后按 `session_id` 标记 current。
- operation result 可关闭，错误可重试。

## Phase 5: Page Context Dock

目标：

- 复用现有 Page Intelligence 的当前页类型识别。
- Side Panel 内提供快速摘要、入库、深研入口。
- 不复制 media-to-notes pipeline。
- 展示最近 handoff 状态、TLDR、artifact 路径和失败信息。
- 提供 History 二级页面入口。

验证：

- 用户主动点击才读取页面正文。
- article/video/github/webpage 文案与 popup 保持一致。
- history/handoff 状态可在 Side Panel 展示或跳转。
- 390px/320px 侧栏宽度下页面任务入口可见、按钮不溢出。

## Phase 6: Session-first Real Bridge Validation

目标：

- 将 Side Panel 产品心智收敛到 OpenClaw 会话新开/恢复。
- 页面上下文、视频解析、文章解析、GitHub 解析和深研入口只作为辅助 dock。
- 参考旧 Session Bridge URL/scope contract，完成真实 scoped sessions list 验证。
- 按真实 side panel 窄宽度打磨 UI。
- 处理空态、长标题、长 URL、长 session key、错误堆栈折叠。
- 与 alpha.12 重设计语言保持一致，避免直角、拥挤和层级混乱。

验证：

- Direct Session Bridge smoke 可列出旧 direct scope 的历史会话。
- Browser route 默认 scope 不误展示全局 sessions。
- Chrome for Testing 中 Gateway paired/online 后，Side Panel 可渲染真实 sessions list。
- Chrome desktop side panel 截图。
- Edge desktop side panel 截图。
- 文本不溢出、不重叠。
- 键盘可达性、焦点态、按钮禁用态清晰。

## Phase 7: Bondie Multi-instance Identity, Permission, and UI

目标：

- 增加 OAuth user identity 状态，不再把 device pairing 当成用户身份。
- 定义 permitted Bondie instances 列表。
- 支持从属关系和沟通关系两种权限。
- 从属关系展示该实例全部 sessions。
- 沟通关系只展示当前用户相关 sessions。
- Side Panel UI 采用“实例切换器 + 全部合集分组列表”，不做三列并排。
- 默认 `全部` 视图按 Bondie 实例分组展示 session 合集。
- 保留旧 Session Bridge adapter 作为 legacy compatibility path。

验证：

- 未登录 OAuth 时 Side Panel 进入 `identity_required`，不请求 sessions。
- 登录但无权限关系时进入 `permission_unresolved` 或空态，不做全局搜索。
- 从属关系 fixture 可看到同实例全部 sessions，并明确标注“查看全部”。
- 沟通关系 fixture 只看到当前用户相关 sessions，并明确标注“仅相关”。
- 单用户多实例 fixture 可切换个人私助、团队共享、他人分享三个实例。
- `全部` 视图能同时展示 A/B/C 三组，但每组保持自己的权限 badge 和错误/空态。
- device pairing 存在但 OAuth 缺失时仍不展示 sessions。

## Phase 8: Bondie Device Registry and Bridge Distribution

目标：

- 设计 Bondie control plane / bridge registry。
- 明确每个 Bondie/OpenClaw 设备需要本地 Session Bridge 或等价组件。
- 明确 Tailscale/private network 由 control plane 到 bridge 使用，浏览器默认不直连所有 bridge。
- 明确 bridge token 存服务端，不下发到 extension。
- 复用 `openclaw-session-bridge` 的 launchd/systemd/smoke_check 标准分发资产。
- 输出多设备 onboarding、health、readiness 和 registry metadata gate。

验证：

- 当前 Mac mini bridge 现场被记录为 legacy single-device reference。
- Bondie A/B/C registry fixture 能表达 endpoint、bridge id、health、capabilities。
- 文档明确网络可达不等于 session 权限。
- 标准分发清单覆盖 macOS、Linux、Tailscale/MagicDNS、token、health、session smoke。
- 旧 direct bridge mode 被标记为开发/单机高级路径。

## Phase 9: Edge Validation and Safari Plan

目标：

- Edge Chromium 加载验证。
- 输出 Safari 差异评估，不实现 Safari。

验证：

- Edge unpacked extension 加载。
- side panel 打开与基础状态可用。
- Safari 文档列出缺失 API、替代入口、分发成本。

## 不应提前做

- 大规模重构 `background.js`。
- Native Messaging。
- 多 Agent provider。
- 动态远程插件加载。
- 全局 session 搜索。
- 直接写 OpenClaw session store。
