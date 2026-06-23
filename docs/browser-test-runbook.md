# 浏览器插件手工测试 Runbook

日期：2026-06-09
版本：0.1.0-alpha.12

## 目标

验证 Bondie Dock 能在 Chrome / Edge 中作为 unpacked extension 加载，完成 OpenClaw node-compatible protocol 4 连接，并覆盖当前页面智能服务、通知/历史、Pattern Memory 建议、Side Panel 和二级开发工具的基础测试。

## 前置条件

- Chrome 116+ 或 Edge 116+。
- 本地仓库已拉取：

```text
/Users/fuyo-aic/Projects/bondie-dock-browser-extension
```

## 加载插件

注意：Chrome/Edge 的 `manifest.version` 必须是数字版本号，当前仓库使用 `version: 0.1.12` 和 `version_name: 0.1.0-alpha.12`。

## 自动化测试备注

本地 Google Chrome Stable 会忽略部分命令行扩展加载参数，例如 `--disable-extensions-except`。因此自动化烟测更适合使用 Chrome for Testing / Playwright Chromium。

当前仓库已完成：

- `manifest.json` JSON 校验。
- 所有 JS 文件语法检查。
- Playwright Chrome for Testing 加载 extension 烟测。
- Popup 当前 Tab、下载摘要、通知路径烟测。
- Popup 页面/工作流/记录三段式导航、二级设置页和 Options 分组设置页视觉检查。

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
/Users/fuyo-aic/Projects/bondie-dock-browser-extension/extension
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
5. 页面智能里的“任务超时分钟数”应保存并在重新打开 Options 后保持。

### Popup

打开任意普通网页后，点击插件图标：

- 顶部状态应显示“在线 / 已配对，重连中 / 等待配对”等连接状态。
- “页面”栏应显示当前页面标题或 URL，并识别普通网页、文章、视频或 GitHub 仓库。
- 点击主按钮，应按页面类型显示“解析当前页 / 解析文章为知识笔记 / 解析视频内容 / 解析 GitHub 仓库”等文案，并把当前页面交给 OpenClaw / Media to Notes 页面智能服务。
- 点击“深度调研”“知识关联”“Issue 草案”，应生成对应 OpenClaw 任务请求，并在“记录”页出现处理中或完成反馈。
- 如果 OpenClaw 没有在任务超时窗口内回传结果，该记录应转为失败，并在 popup / 历史页提供“重试”。
- 第一次对某个站点读取页面内容时，浏览器会要求授予该站点访问权限。
- “记录”栏应展示最近处理记录；点击单条记录的关闭按钮后，该记录应从当前 popup 中消失。
- 点击“全部历史”应打开历史页，能看到之前处理过的记录、TLDR、产物路径、失败原因和重试入口。
- “工作流”栏的“可恢复页面”应展示 Pattern Memory 的本地建议；点击刷新按钮应重新扫描当前页面关联。

### 设置和开发工具

点击右上角设置按钮：

- 连接通道应显示当前 OpenClaw 本地通道状态。
- 知识能力应显示 Media to Notes / 页面智能服务配置状态。
- 在“工作流”页点击“固定当前窗口”应保存当前窗口的可恢复页面组合。
- “保存的组合”应展示本地保存的 Pattern。
- 开发工具区中的“测试通知”“当前 Tab”“页面摘要”“下载摘要”“确认弹窗”仍应可用。

## Gateway 测试

当前默认使用 OpenClaw node-compatible protocol 4。

可验证：

- Gateway URL 为空时，连接按钮返回明确错误。
- Gateway URL 指向本地 OpenClaw Gateway 时，扩展按 `minProtocol/maxProtocol = 4` 连接。
- service worker 日志不应再出现旧版 `protocol mismatch`。
- 断开按钮会关闭连接。

## 预期限制

- 页面摘要仅在用户点击 popup 后触发。
- 不默认请求 `<all_urls>`。
- 浏览器关闭后插件不常驻。
- 不能读取任意本地目录。
- 下载摘要只返回下载记录元数据。

## 失败排查

- 如果“页面摘要”失败，确认当前页面不是 `chrome://`、`edge://`、扩展商店、PDF viewer 等受限页面。
- 如果通知不出现，检查系统通知权限和浏览器通知权限。
- 如果 service worker 异常，打开扩展详情页，点击 service worker inspect 查看 Console。
