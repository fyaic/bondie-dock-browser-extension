# Browser Extension Productization Roadmap

日期：2026-06-09

仓库：[bondie-dock-browser-extension](https://github.com/fyaic/bondie-dock-browser-extension)

## 背景

浏览器插件路线已经从“OpenClaw 浏览器侧宿主”升级为“浏览器智能工作流 Agent 门户”。首期仍以 OpenClaw 为主，后续可面向更多 Agent；浏览器侧先覆盖 Chrome，Edge 作为 Chromium 近线适配目标，Safari 需要单独评估 extension API、权限和分发差异。

用户侧需求主线：

- OpenClaw 可跨设备向浏览器发通知，插件负责展示、追踪和回传用户操作。
- 插件主动学习浏览习惯 Pattern，例如打开 A 时建议一起打开经常共现的 B/C/D/E。
- 当前页面有视频时，插件能进入视频解析链路。
- 当前页面是文章、GitHub 仓库或普通网页时，插件能提供解析、摘要和知识笔记能力。
- 用户正在浏览某个页面且感兴趣时，可直接发起深度调研。

## 当前状态

已完成到 `0.1.0-alpha.12`：

- Gateway protocol 4、`node-compatible` handshake、Ed25519 device identity、pairing/deviceToken、`node.presence.alive` 心跳。
- 浏览器通知、当前 tab、页面摘要、下载摘要、用户确认弹窗等宿主能力。
- Pattern Memory 工程底座：本地快照、保存组合、候选建议、一键恢复。
- Context Capture / Media to Notes 工程底座。
- Popup / Options / History / Confirm 前端重设计。

仍未达到产品化闭环：

- 远程通知缺少完整的展示、点击、关闭、失败、离线重放和历史追踪闭环。
- 页面解析链路缺少按页面类型的稳定处理状态、TLDR、产物路径、失败恢复。
- 视频解析、文章解析、GitHub 解析需要明确统一入口和回传结构。
- 深度调研还只有入口语义，尚未接入 OpenClaw 研究任务生命周期。
- Pattern Memory 需要从工程可用升级为用户可信的低打扰建议。
- Edge/Safari、隐私文案、商店分发、安装升级仍未产品化。

## Linear 树状任务建议

父任务：`[Parent] OpenClaw Browser Extension Productization Roadmap`

子任务建议：

1. `P0 Remote browser notification loop`
   - OpenClaw 下发跨设备通知。
   - 插件展示系统通知和内部记录。
   - 点击、关闭、失败、过期事件回传。
   - 离线/重连期间不丢关键状态。

2. `P0 Page intelligence parser loop`
   - 按文章、视频、GitHub 仓库、普通网页识别页面类型。
   - 统一触发 OpenClaw / Media to Notes。
   - 回传处理中、完成、失败、TLDR、Markdown 路径。
   - 历史页可追溯和重试。

3. `P0 Deep research from current page`
   - 从当前页面发起深度调研。
   - payload 包含 URL、title、selectedText、textPreview 和页面类型。
   - 回传研究任务状态、报告 TLDR、报告路径。
   - 失败可重试。

4. `P0 Pattern Memory suggestion quality`
   - 提升共现质量、过滤低价值页面和搜索页。
   - 支持接受、忽略、稍后、不再提示。
   - 保护隐私：默认不上传完整浏览历史。
   - 建议低打扰、可解释。

5. `P0 Frontend UX productization and visual QA`
   - 基于 alpha.12 重设计继续补齐状态、空态、错误态。
   - 加入稳定视觉 QA：popup、options、history、confirm。
   - 对齐浏览器真实尺寸和文字溢出检查。

6. `P1 Agent provider boundary`
   - OpenClaw first。
   - 只抽最小 provider 边界。
   - 暂不实现 Harmony/Mercury 等完整 adapter。

7. `P1 Edge and Safari adaptation plan`
   - Edge 先走 Chromium 兼容验证。
   - Safari 单独评估 API、权限、background 生命周期和分发成本。
   - 输出适配差异和最小验收清单。

8. `P1 Distribution, install and privacy package`
   - zip / unpacked 内测说明。
   - Chrome Web Store / Edge Add-ons 文案。
   - 权限说明和隐私政策。
   - 版本升级和回滚流程。

## 关联历史

- AIC-2586：OpenClaw 浏览器智能工作流 Agent P0 MVP 父任务。
- AIC-2587：P0 MVP 实现任务。
- AIC-2735：Gateway protocol 4 / node role 心跳修复。
- AIC-2516 / AIC-2518 / AIC-2519：早期 Pattern Memory、Context Capture、Suggestion 任务，部分已归档，作为历史参考而非重复创建对象。

## 关键文档

- [产品需求整理](product-requirements-2026-05-15.md)
- [AI Handoff 长线任务入口](ai-handoff-browser-workflow-agent.md)
- [TODO](todo.md)
- [架构方案](architecture.md)
- [实施计划](implementation-plan.md)
- [0.1.0-alpha.12 Release Notes](release-notes-0.1.0-alpha.12.md)
