# AI Handoff：浏览器智能工作流 Agent 长线任务入口

日期：2026-05-19

仓库：`openclaw-browser-host-extension`

## 给接手 AI 的一句话任务

继续把当前 Chrome / Edge 插件从早期“OpenClaw 浏览器侧宿主”推进为“浏览器智能工作流 Agent 门户”。当前最重要的产品方向是页面智能服务闭环、Media to Notes 知识笔记能力、Pattern Memory 真感知，以及 OpenClaw 侧的处理反馈，而不是继续只做通知或远程调用。

## 背景

项目最初来自 OpenClaw 客户侧宿主需求：用户常用电脑和 OpenClaw 服务端不在同一台设备上，需要一个客户端侧宿主扩展 OpenClaw 能力。

已有两条路线：

- Windows exe / Bondie：适合系统托盘、开机自启动、本地目录、Windows Toast。已归档在 [windows-exe-route.md](../archive/windows-exe-route.md)。
- 浏览器插件：适合浏览器上下文、当前页、标签页、网页内容、浏览器内交互。当前仓库主线。

2026-05-15 产品会议后，浏览器插件路线升级为浏览器智能工作流 Agent 门户。完整会议需求整理见 [product-requirements-2026-05-15.md](product-requirements-2026-05-15.md)。

## 当前进展

当前版本：`0.1.0-alpha.11`

已完成：

- Manifest V3 插件骨架。
- Options 配置 Gateway URL / token / token mode / protocol / node name。
- Popup 展示连接状态和基础动作。
- OpenClaw node-compatible WebSocket 连接。
- Ed25519 device identity。
- pairing / deviceToken 持久化。
- `node.invoke.request` / `node.invoke.result` / `node.event`。
- 浏览器通知和点击回传。
- 当前 tab 信息读取。
- 页面摘要。
- 下载摘要。
- 用户确认弹窗。
- MV3 keepalive / 快速重连。
- Gateway protocol 4 兼容，`node-compatible` 握手声明 `minProtocol/maxProtocol = 4`。
- `node-compatible` 心跳使用 `node.presence.alive`，不再调用 node role 无权访问的 RPC `ping`。
- paired 与 online 生命周期分离：
  - `paired` 只表示设备已授权。
  - `online/offline` 才表示当前 WebSocket 状态。
  - 重连不应弹“已配对”类用户通知。
- zip 打包脚本和快速安装文档。
- Media to Notes 能力已复制到 `extension/plugins/media-to-notes`，作为插件内置能力模块。
- Popup 首页已收敛为当前页面主行动、最近处理/历史和二级设置入口。
- 历史页、通知卡片和处理记录的基础形态已落地。
- Pattern Memory 已有本地快照/建议/恢复的工程底座，但智能感知质量仍需继续打磨。

已验证：

- Chrome 能加载 unpacked extension。
- 插件能连接真实 OpenClaw Gateway。
- 本地通知测试通过。
- alpha.11 在 CLI/CDP 非默认 profile 中验证通过：service worker 版本 `0.1.11`，连接状态 `connected/registered/online=true`，并持续写入 `lastHeartbeatAt`。
- 静态检查和打包流程可跑通。

## 当前未完成

产品主线还没有达到可分发产品标准：

- “生成知识笔记”链路需要和本地 OpenClaw workspace 产物、TLDR、失败重试和通知卡片完全闭环。
- Media to Notes 依赖、env、token、输出目录需要形成安装/设置体验，而不是只放代码。
- Pattern Memory 需要从“手动保存/恢复”升级为可信自动感知，首页不应暴露抽象内部术语。
- 日常 Chrome Default profile 可能仍需用户在 `chrome://extensions` 手动 Reload，让 service worker 从旧版本切到 `0.1.11`。
- Chrome Web Store / Edge Add-ons、Native Messaging、本地安装器和多 Agent provider 都暂缓。

## 近期最高优先级

优先做 P0，不要过早做复杂品牌、多 Agent 或 Native Messaging。

### P0.1 页面智能服务闭环

目标：用户在浏览器里点击一次，即可把当前页面交给 OpenClaw 处理为本地知识笔记。

最小闭环：

1. Popup 主按钮固定为“生成知识笔记”。
2. 插件采集 URL、title、selectedText、textPreview 和页面类型。
3. 插件把请求交给 OpenClaw，并指定内置 `media-to-notes` 能力目录、env 和输出目录。
4. OpenClaw 在本地 workspace 写入 Markdown。
5. OpenClaw 回传处理中/完成/失败、TLDR 和文件路径。
6. 插件展示通知卡片，历史页可追溯。

### P0.2 Pattern Memory 智能感知

目标：让插件能可靠识别“这些网页通常一起打开”，并在低打扰场景下给出可恢复建议。

最小闭环：

1. 继续使用本地 tab/window 快照和保留策略。
2. 优化共现分析、过滤低价值页面和搜索结果页。
3. 将建议表达为“可恢复页面/相关页面”，不要在首页显示 Pattern Memory 内部概念。
4. 支持接受、忽略、稍后、不再提示。
5. 只有当自动建议足够可信后才放到首页。

约束：

- 必须用户主动触发。
- 页面正文读取继续走当前 activeTab / 用户授权路径。

### P0.3 Recap / Suggestion 协议

目标：OpenClaw 能主动向插件推送链接建议，插件能展示并回传用户反馈。

最小事件：

- `browser.pattern.snapshot`
- `browser.pattern.detected`
- `browser.pattern.opened`
- `browser.context.capture`
- `browser.suggestion.accepted`
- `browser.suggestion.dismissed`

最小 invoke：

- `browser.suggestion.show`
- `browser.pattern.open`

约束：

- 复用现有 OpenClaw node 传输。
- 不另起 WebSocket 协议。
- 首期只支持 OpenClaw，不实现 Harmony / Mercury。

## 关键文档

- 产品需求全貌：[product-requirements-2026-05-15.md](product-requirements-2026-05-15.md)
- 当前 TODO：[todo.md](todo.md)
- 架构方案：[architecture.md](architecture.md)
- 实施计划：[implementation-plan.md](implementation-plan.md)
- Gateway 协议：[gateway-protocol-notes.md](gateway-protocol-notes.md)
- 快速安装：[quick-install.md](quick-install.md)
- 本地烟测：[test-results/2026-05-14-local-smoke.md](test-results/2026-05-14-local-smoke.md)

## 关键代码

- Manifest：[../extension/manifest.json](../extension/manifest.json)
- Background service worker：[../extension/src/background.js](../extension/src/background.js)
- Popup：[../extension/src/popup.html](../extension/src/popup.html)、[../extension/src/popup.js](../extension/src/popup.js)
- Options：[../extension/src/options.html](../extension/src/options.html)、[../extension/src/options.js](../extension/src/options.js)
- Content script：[../extension/src/content.js](../extension/src/content.js)
- Shared styles：[../extension/src/styles.css](../extension/src/styles.css)

## 开发原则

- KISS：先做清楚的本地 MVP，不做复杂语义理解。
- YAGNI：不要提前实现多 Agent、Native Messaging、复杂安装器。
- DRY：Pattern storage、event upload、invoke result 走统一 helper。
- SOLID：把 Pattern Memory、Context Capture、Agent Connection 分开，不要把所有逻辑继续塞进一个巨大的 background 文件。
- 隐私优先：默认不采集页面正文，不上传完整浏览历史。
- 体验优先：主动建议要低打扰，可关闭，可忽略。

## 验证方式

静态检查：

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
```

打包：

```bash
./scripts/package-extension.sh
```

手工验证：

1. 打开 `chrome://extensions`。
2. Developer mode。
3. Load unpacked，选择 `extension/`。
4. 配置 Gateway。
5. 验证连接状态、通知、当前页、页面摘要、确认弹窗。
6. 新增功能需要同步补充 [browser-test-runbook.md](browser-test-runbook.md)。

## 不要做的事

- 不要把 `Paired` 当成用户通知。
- 不要默认申请 `<all_urls>`。
- 不要默认采集页面正文。
- 不要上传完整浏览历史。
- 不要为了未来多 Agent 先重写传输层。
- 不要把 Windows exe 路线能力直接搬进纯浏览器插件。
