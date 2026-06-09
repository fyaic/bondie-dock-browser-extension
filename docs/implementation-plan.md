# 实施计划

日期：2026-05-19

## 阶段 0：调研与边界确认

状态：已完成。

产出：

- 官方资料调研。
- 纯插件能力边界。
- 与 Windows exe 路线差异。
- 浏览器插件安装、权限、MV3 service worker 限制说明。

## 阶段 1：浏览器宿主 / Gateway 稳定性

状态：已完成到 alpha.11。

目标：验证浏览器插件作为 OpenClaw client host 的可行性。

已完成：

- Manifest V3 插件骨架。
- Gateway URL/token 配置。
- OpenClaw node-compatible WebSocket 连接。
- Ed25519 device identity。
- pairing / deviceToken。
- 心跳、重连、paired 与 online 生命周期分离。
- 浏览器通知。
- 当前 tab 信息读取。
- 当前页选中文本/正文摘要。
- 下载记录摘要。
- 浏览器内确认弹窗。

验收结果：

- Chrome 能加载 unpacked extension。
- 插件能保存配置。
- 插件能显示浏览器通知。
- 插件能读取当前 tab 元信息。
- 插件能通过 content script 获取页面摘要。
- 插件能弹出用户确认窗口并回传结果。
- 插件能连接真实 OpenClaw Gateway 并保持在线。
- Gateway protocol 4 已对齐。
- stale deviceToken 可自动恢复。
- node role 心跳已改为 `node.presence.alive`，避免 RPC `ping` 权限错误。

## 阶段 2：产品方向调整

状态：已完成需求整理。

背景：2026-05-15 产品会议明确插件不是单纯通知/远程调用工具，而是浏览器智能工作流 Agent 门户。

新主线：

- Pattern Memory：记忆并复现用户标签页组合习惯。
- Context Capture：浏览内容时一键触发 Agent 记录或处理。
- OpenClaw Recap：OpenClaw 基于历史工作流和当日规划主动推送建议。

产出：

- [product-requirements-2026-05-15.md](product-requirements-2026-05-15.md)
- [todo.md](todo.md)
- [architecture.md](architecture.md)

## 阶段 3：页面智能服务闭环

状态：alpha.11 已有工程底座，下一步做产品闭环。

目标：用户点击“生成知识笔记”后，OpenClaw 在本地 workspace 产出 Markdown，并把 TLDR/路径回传到插件。

范围：

- 页面类型识别。
- OpenClaw `agent.request` / Media to Notes 调用。
- Media to Notes env、token、输出目录设置。
- 处理中/完成/失败通知卡片。
- 历史页追溯。
- Markdown 路径回传。

验收：

- 普通文章页面可生成知识笔记。
- GitHub repo 页面可生成知识笔记。
- 视频页面可进入 Media to Notes 管线。
- 失败时用户能看到可操作错误。
- 完成后插件展示 TLDR 和 Markdown 路径。

## 阶段 4：Pattern Memory 智能感知

状态：已有初版，待产品化验证。

目标：从“手动保存/恢复”升级为可信的自动建议。

范围：

- tabs/windows 快照保留。
- 共现关系质量提升。
- 搜索页、低价值页过滤。
- 可恢复页面/相关页面建议。
- accept/dismiss/稍后/不再提示反馈。

验收：

- 自动建议出现频率低但有用。
- 用户能理解建议来源。
- 首页不出现 `Pattern Memory` 这类内部术语。
- 用户可关闭采集、清空本地数据。

## 阶段 5：OpenClaw Recap / Suggestion

状态：待设计接口。

目标：OpenClaw 能基于 Recap 主动给插件推送链接建议，插件展示并回传用户反馈。

范围：

- 定义 `browser.suggestion.show`。
- 定义 accept/dismiss feedback。
- 定义 Pattern / Context Capture 事件输入。
- 实现建议 UI。
- 实现打开全部/打开部分/忽略。

验收：

- OpenClaw 可推送一组建议链接。
- 插件可展示建议。
- 用户接受建议后插件打开链接并回传 accepted。
- 用户忽略建议后插件回传 dismissed。

## 阶段 6：产品化与分发

状态：待启动。

范围：

- 命名和品牌决策：OpenClaw Browser Host / The Tailor / Bondie。
- Logo 和视觉。
- Chrome Web Store / Edge Add-ons 文案。
- 权限说明和隐私政策。
- 内测升级说明。
- 长时间稳定性测试。

## 暂缓

- Native Messaging。
- 本地目录监听。
- 全盘文件读取。
- 系统级操作。
- 多 Agent 全量兼容。
