# 浏览器插件手工测试 Runbook

日期：2026-05-25
版本：0.1.0-alpha.7

## 目标

验证 OpenClaw Browser Host Extension 能在 Chrome / Edge 中作为 unpacked extension 加载，并完成浏览器侧宿主 PoC 与浏览器智能工作流 Agent P0 能力测试。

## 前置条件

- Chrome 116+ 或 Edge 116+。
- 本地仓库已拉取：

```text
/Users/fuyo-aic/Projects/openclaw-browser-host-extension
```

## 加载插件

注意：Chrome/Edge 的 `manifest.version` 必须是数字版本号，仓库使用 `version: 0.1.0` 和 `version_name: 0.1.0-alpha.7`。

## 自动化测试备注

本地 Google Chrome Stable 会忽略部分命令行扩展加载参数，例如 `--disable-extensions-except`。因此自动化烟测更适合使用 Chrome for Testing / Playwright Chromium。

当前仓库已完成：

- `manifest.json` JSON 校验。
- 所有 JS 文件语法检查。
- Playwright Chrome for Testing 加载 extension 烟测。
- Popup 当前 Tab、下载摘要、通知路径烟测。

真实加载验证仍以 Chrome/Edge 的 Developer mode 手工加载为准。

已知自动化限制：

- 页面摘要首次请求站点权限时会出现浏览器权限确认 UI，自动化脚本不会代替用户点击授权。
- 手工测试时需要允许当前站点访问后，再验证页面摘要结果。

Chrome:

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择：

```text
/Users/fuyo-aic/Projects/openclaw-browser-host-extension/extension
```

Edge:

1. 打开 `edge://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择 `extension/` 目录。

## 基础测试

### 配置页

1. 打开插件 Options。
2. 填写 Gateway URL、Token、Node name。
3. 点击保存。
4. 重新打开 Options，确认配置仍在。

### Popup 自测

打开任意普通网页后，点击插件图标：

- 点击“测试通知”，浏览器应出现通知。
- 点击“当前 Tab”，结果应包含当前页面 title/url。
- 点击“页面摘要”，结果应包含 title/url/selection/textPreview。
  - 第一次对某个站点使用时，浏览器会要求授予该站点访问权限。
- 点击“下载摘要”，结果应返回最近下载元数据。
- 点击“确认弹窗”，应弹出确认窗口，点击允许/拒绝后返回结果。

### Pattern Memory

1. 打开两个或更多普通网页。
2. 打开插件 Popup，点击“保存窗口 Pattern”。
3. 在 Patterns 区域确认新增 Pattern，显示链接数量和 origin 摘要。
4. 点击 Pattern 的“打开”，应新建窗口并打开该 Pattern 内的链接。
5. 打开 Options，确认“启用本地 Pattern Memory”已勾选，保留数量可保存。
6. 点击“清空本地 Pattern 数据”，重新打开 Popup，Patterns 和候选列表应为空。

隐私预期：

- Pattern 只保存 URL、origin、title、windowId、tabId、active、pinned、timestamp。
- 不读取页面正文。
- “允许上传 Pattern 摘要事件”默认关闭；开启后也只上传摘要，不上传完整历史。

### Context Capture

1. 打开普通网页并选中一段文本。
2. 点击 Popup 的“发送当前页”。
3. 如果浏览器要求站点权限，允许后再次点击。
4. 连接 OpenClaw 时，结果应显示 `sent: true`，并通过 `browser.context.capture` 上报。
5. 未连接 OpenClaw 时，应显示明确失败，同时 payload 中保留 URL、title、selectedText、textPreview、capturedAt 便于排查。

Context Capture 只能由用户点击触发；插件不会在后台静默读取页面正文。

### Suggestion / Recap 协议

通过 OpenClaw node-compatible invoke 发送：

```json
{
  "command": "browser.suggestion.show",
  "args": {
    "title": "继续处理当前工作",
    "message": "这些链接可能属于同一工作流",
    "urls": ["https://example.com/one", "https://example.com/two"]
  }
}
```

预期：

- Popup 的“OpenClaw 建议”区域展示建议。
- 点击“接受”会打开建议链接，并回传 `browser.suggestion.accepted`。
- 点击“忽略”会移除建议，并回传 `browser.suggestion.dismissed`。
- `browser.pattern.open` invoke 可按 `patternId` 或 `urls` 打开 Pattern，并回传 `browser.pattern.opened`。

### 定时快照和候选

1. 安装或重新加载扩展后，service worker 会确保 `openclaw-pattern-snapshot` alarm 存在。
2. 每小时快照只采集窗口和 Tab 元数据，不采集页面正文。
3. 当相同 origin 组合至少达到 Options 中的“候选共现阈值”时，候选 Pattern 会出现在 Popup 的候选区域。

## Gateway 测试

当前 Gateway 消息格式仍是 PoC，尚未对齐真实 OpenClaw browser node 协议。

可先验证：

- Gateway URL 为空时，连接按钮返回明确错误。
- Gateway URL 指向可用 WebSocket echo/server 时，状态可进入连接。
- 断开按钮会关闭连接。
- node-compatible 模式下，`node.event` 应承载 `browser.context.capture`、`browser.pattern.opened`、`browser.suggestion.accepted`、`browser.suggestion.dismissed`。

## 预期限制

- 页面摘要仅在用户点击 popup 后触发。
- Context Capture 仅在用户点击 popup 后触发。
- 不默认请求 `<all_urls>`。
- 浏览器关闭后插件不常驻。
- 不能读取任意本地目录。
- 下载摘要只返回下载记录元数据。
- Pattern 自动快照默认只保存在本地；Pattern 摘要上传开关默认关闭。

## 失败排查

- 如果“页面摘要”失败，确认当前页面不是 `chrome://`、`edge://`、扩展商店、PDF viewer 等受限页面。
- 如果通知不出现，检查系统通知权限和浏览器通知权限。
- 如果 service worker 异常，打开扩展详情页，点击 service worker inspect 查看 Console。
