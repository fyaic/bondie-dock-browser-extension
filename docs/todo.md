# TODO

日期：2026-05-19

当前版本：0.1.0-alpha.11

产品主线：浏览器智能工作流 Agent 门户。详见 [product-requirements-2026-05-15.md](product-requirements-2026-05-15.md)。

## 当前已完成

- Manifest V3 插件骨架。
- 配置页支持 Gateway URL / token / token mode / protocol / node name。
- 快速安装说明和 zip 打包脚本。
- Popup 展示连接状态。
- 浏览器通知和点击回传。
- 当前 tab 元信息读取。
- Content script 页面摘要。
- 下载记录摘要。
- 浏览器内用户确认弹窗。
- OpenClaw node-compatible 协议：
  - Ed25519 device identity。
  - `connect.challenge`。
  - 签名 `connect`。
  - `hello-ok`。
  - deviceToken 持久化。
  - `node.invoke.request` / `node.invoke.result`。
  - `node.event`。
- paired 与 online 生命周期分离，重连不再制造重复配对体验。
- MV3 keepalive / 快速重连。
- Gateway protocol 4 兼容，`node-compatible` 握手声明 `minProtocol/maxProtocol = 4`。
- `node-compatible` 心跳使用 `node.presence.alive`，不再调用 node role 无权访问的 RPC `ping`。
- Chrome for Testing 本地烟测、mock Gateway 协议验证、真实 Chrome 插件加载和在线验证。

## P0：页面智能服务闭环

- 主按钮固定为“生成知识笔记”，避免首页多个相似动作分散重心。
- 识别文章、GitHub 仓库、YouTube/Bilibili/Douyin/TikTok 等页面类型。
- 触发 OpenClaw 调用 `extension/plugins/media-to-notes`。
- Media to Notes 依赖、env、token、输出目录进入设置页。
- 产物默认写入 OpenClaw workspace 下的 browser notes 目录。
- 通知卡片展示处理中、完成、失败、TLDR 和 Markdown 路径。
- 历史页保留所有处理记录，可关闭首页通知但不丢历史。
- 日常 Chrome Default profile reload 状态要在安装/更新说明中明确。

## P1：Pattern Memory 智能感知

- 定义 Pattern 数据结构。
- 使用 `chrome.tabs` / `chrome.windows` 采集 tabs/windows 快照。
- 使用 `chrome.alarms` 实现默认每小时一次快照。
- 快照首期只记录 URL、origin、title、windowId、tabId、active、pinned、timestamp。
- 本地存储快照，设置最大保留量，避免无限增长。
- 实现简单共现分析：
  - 同一窗口内 URL/origin 共现。
  - 多次快照重复出现提升 confidence。
  - 过滤浏览器内部页、搜索结果页和低价值页面。
- 支持“保存当前窗口为可恢复页面组”。
- Popup 只在建议可信时展示“可恢复页面/相关页面”，不直接暴露 Pattern Memory 内部术语。
- 一键打开 Pattern 里的链接。
- 打开匹配页面时生成候选建议。

## P1：Context Capture / OpenClaw Recap

- Popup 增加“发送当前页给 OpenClaw”入口。
- 支持 capture 类型：
  - 记录当前页。
  - 总结当前页。
  - 保存选中文本。
  - 关联到当前工作。
- Capture payload 包含 URL、title、selectedText、textPreview、capturedAt。
- 通过现有 OpenClaw node event 上报。
- 保持用户主动触发，不默认读取页面正文。
- 设计最小事件：
  - `browser.pattern.snapshot`
  - `browser.pattern.detected`
  - `browser.pattern.opened`
  - `browser.context.capture`
  - `browser.suggestion.accepted`
  - `browser.suggestion.dismissed`
- 设计最小远端调用：
  - `browser.suggestion.show`
  - `browser.pattern.open`
- 明确 OpenClaw Recap 输入：
  - 用户确认过的 Pattern。
  - 本地摘要化快照。
  - Context Capture 事件。
- 明确 OpenClaw Recap 输出：
  - 今日建议链接。
  - 继续昨日工作的链接组。
  - 当前页面相关链接建议。
- 所有协议先复用现有 OpenClaw node 传输，不另起 WebSocket 协议。

## P0：权限与隐私

- 增加采集开关：Pattern Memory on/off。
- 增加上传开关：是否把 Pattern 摘要发给 OpenClaw。
- 增加清空本地 Pattern / 快照数据入口。
- Options 明确说明：
  - 默认不采集页面正文。
  - 页面正文只在用户主动 capture 时读取。
  - Pattern 快照只用于工作流建议。
  - 数据会发送到当前配置的 Agent。
- 避免默认 `<all_urls>`，继续使用用户触发的站点权限请求。

## P1：主动建议体验

- 每日首次打开浏览器时展示今日建议。
- 打开匹配 Pattern 的页面时展示轻量建议。
- 支持建议操作：
  - 打开全部。
  - 选择部分打开。
  - 忽略。
  - 不再提示此 Pattern。
  - 稍后提醒。
- 设计低打扰 UI，不依赖系统通知承载主要交互。
- 建议展示和用户反馈都回传 OpenClaw。

## P1：Pattern 管理

- Pattern 列表页。
- 重命名 Pattern。
- 删除 Pattern。
- 固定常用 Pattern。
- 合并相似 Pattern。
- 禁用某些域名参与学习。
- 手动添加/删除 Pattern URL。

## P1：Gateway / Node 稳定性

- 继续长时间真实 Gateway 在线验证。
- 确认 `browser-extension` node 类型服务侧 allowlist。
- 确认 Origin 策略。
- 增加连接诊断输出。
- 增加 pairing / token 错误提示的用户友好文案。
- 持续保持 paired 与 online 生命周期分离。

## P2：Agent Portal 抽象

- 抽象 `AgentProvider` 边界。
- 首期实现 `OpenClawProvider`。
- 为 Harmony / Mercury 保留 adapter 目录和接口文档，但不实现。
- 避免为了多 Agent 过早抽象传输层。

## P2：品牌与分发

- 决策插件产品名：继续 OpenClaw Browser Host，还是切换到 The Tailor / Bondie 子品牌。
- 设计 The Tailor 工作室 Logo。
- 准备 Chrome Web Store / Edge Add-ons 需要的：
  - 产品说明。
  - 权限说明。
  - 隐私政策。
  - 截图。
  - 支持页。
- 评估域名落点：bondi.io / thetailor 系列域名。

## 暂不做

- 复杂安装器。
- Windows 托盘。
- 开机自启动。
- 任意本地目录扫描。
- 任意命令执行。
- Native Messaging。
- 全量浏览历史上传。
- 多 Agent 全量兼容。
