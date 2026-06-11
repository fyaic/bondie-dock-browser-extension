# 执行偏差日志

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
