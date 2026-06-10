# Release Notes：0.1.0-alpha.12

日期：2026-06-09

## 版本定位

`0.1.0-alpha.12` 是浏览器插件前端产品化版本。alpha.11 已完成 Gateway protocol 4、node role 心跳和连接生命周期的收口；alpha.12 的重点是把 popup、设置页、历史页和确认页从工程验证界面推进到可内测的产品界面。

## 主要变化

- Popup 从单页长列表改为“页面 / 工作流 / 记录”三段式主导航。
- Popup 外壳从硬直角改为 20px 软圆角壳层，增加内边距、阴影、边界和聚焦层级。
- 当前页面主按钮按页面类型切换文案：普通网页、文章、视频、GitHub 仓库分别表达。
- “深度调研 / 知识关联 / Issue 草案”作为当前页面的二级动作，避免和主解析链路抢层级。
- Pattern Memory 相关能力改为“可恢复页面 / 保存的组合”，减少内部术语暴露。
- 近期处理记录移入“记录”页，历史入口改为“全部历史”。
- 设置页降级为二级入口，开发工具折叠，避免干扰普通使用路径。
- Options 页改为分组面板：Agent 连接、页面智能、Pattern Memory、内置解析能力。
- History 和 Confirm 页面接入统一背景、圆角、状态边界和按钮风格。
- 样式系统统一颜色、半径、控件、focus、hover、状态和响应式规则。

## 验证

- `python3 -m json.tool "extension/manifest.json" >/dev/null`
- `node --check` 覆盖 extension 下所有 JavaScript 入口。
- `./scripts/package-extension.sh`
- Playwright + mock `chrome.*` 视觉预览覆盖 popup 页面/工作流/设置和 options，无横向溢出或按钮裁切。

## 后续

后续主线不再只是继续修 UI，而是围绕产品闭环推进：

- OpenClaw 到浏览器的远程通知闭环。
- 当前页面解析链路：文章、视频、GitHub 仓库和普通网页。
- 当前页面深度调研任务。
- Pattern Memory 智能感知和低打扰建议。
- Edge 近线适配和 Safari 后续评估。

完整任务树见 [Browser Extension Productization Roadmap](browser-extension-productization-roadmap-2026-06-09.md)。
