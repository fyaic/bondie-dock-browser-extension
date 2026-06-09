# 快速安装 OpenClaw Browser Host

日期：2026-06-09

适用版本：0.1.0-alpha.11

## 安装包

内测分发使用 zip 包：

```text
openclaw-browser-host-extension-0.1.0-alpha.11.zip
```

用户拿到 zip 后先解压到一个固定目录，例如：

Windows:

```text
C:\OpenClaw\BrowserHost
```

macOS:

```text
~/Applications/OpenClawBrowserHost
```

注意：Chrome / Edge 加载的是解压后的目录，不是 zip 文件本身。

## Chrome 安装

1. 打开 Chrome。
2. 地址栏输入：

```text
chrome://extensions
```

3. 打开右上角 Developer mode。
4. 点击 Load unpacked。
5. 选择解压后的插件目录。
6. 确认扩展列表里出现：

```text
OpenClaw Browser Host
```

## Edge 安装

1. 打开 Edge。
2. 地址栏输入：

```text
edge://extensions
```

3. 打开 Developer mode。
4. 点击 Load unpacked。
5. 选择解压后的插件目录。
6. 确认扩展列表里出现：

```text
OpenClaw Browser Host
```

## 首次配置

点击插件图标，进入配置页，填写：

```text
Gateway URL: wss://<openclaw-gateway>
Token mode: GatewayToken / manual approve
Token: <gateway-token>
Node name: OpenClaw Browser Host
Protocol: OpenClaw Node compatible
```

保存后点击插件 popup 里的连接。

0.1.0-alpha.11 起，`OpenClaw Node compatible` 会按 Gateway protocol 4 发送 `minProtocol/maxProtocol = 4`，并使用 `node.presence.alive` 做 node role 心跳。本地验证使用的 Chrome 扩展 ID 是 `cljflebfgmekmnojaiaonfdjcmoonbpf`；旧版本在 Gateway 日志中的典型失败症状是 `code=1002 reason=protocol mismatch`，并伴随 `min=3 max=3 expected=4 probeMin=4`。

如果 Gateway 要求配对，服务侧批准该 browser node 后，插件会保存 deviceToken；后续重连不需要再次输入 GatewayToken。

## 验证

安装后可以先点：

- 测试通知
- 当前 Tab
- 下载摘要

如果这些能返回结果，说明插件本地能力正常。

远端联调时，再从 OpenClaw / Gateway 侧调用：

```text
browser.notify
browser.current_tab.info
browser.current_tab.extract
browser.downloads.summary
user.confirm
```

## 常见问题

### 为什么正常 Chrome 里看不到测试插件？

自动化测试使用的是 Chrome for Testing 的临时 profile，不会安装到用户日常 Chrome。要在日常 Chrome 里使用，必须按上面的步骤手动 Load unpacked。

### 为什么不是双击安装？

Chrome / Edge 对浏览器插件有安全限制。当前内测阶段使用 unpacked extension；产品化分发建议走 Chrome Web Store、Edge Add-ons，或企业策略分发。

### zip 更新后怎么升级？

1. 关闭浏览器或停用旧扩展。
2. 用新 zip 解压覆盖旧目录。
3. 在 `chrome://extensions` 或 `edge://extensions` 点击插件卡片上的 Reload。
4. 确认扩展详情页显示的 service worker 版本已经更新到当前 `version_name`。
