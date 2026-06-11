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

验证：

- 用户主动点击才读取页面正文。
- article/video/github/webpage 文案与 popup 保持一致。
- history/handoff 状态可在 Side Panel 展示或跳转。

## Phase 6: Product Polish and Visual QA

目标：

- 按真实 side panel 窄宽度打磨 UI。
- 处理空态、长标题、长 URL、长 session key、错误堆栈折叠。
- 与 alpha.12 重设计语言保持一致，避免直角、拥挤和层级混乱。

验证：

- Chrome desktop side panel 截图。
- Edge desktop side panel 截图。
- 文本不溢出、不重叠。
- 键盘可达性、焦点态、按钮禁用态清晰。

## Phase 7: Edge Validation and Safari Plan

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

