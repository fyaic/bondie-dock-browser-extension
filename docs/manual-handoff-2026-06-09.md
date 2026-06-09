# OpenClaw Browser Host Extension 人工接手整理

日期：2026-06-09

## 一句话结论

这个项目的主线应该回到“OpenClaw 的浏览器触手”：低侵入、易分发、能把当前网页上下文交给本地 OpenClaw 处理，并把处理结果以可见、可追溯的方式返回给用户。

当前问题不是没有代码，而是多轮 agent 叠加后出现了三类混乱：

- 本地有多个工作副本，修复没有回流到 Chrome 实际加载的目录。
- popup UI 同时塞入连接、知识笔记、Pattern、通知、开发工具、实验服务，主任务不清晰。
- 分发和验收链路没有闭环，用户拿到的仍是 unpacked/zip 内测形态。

## 项目来龙去脉

### 1. Windows 宿主程序路线

最早目标是给 OpenClaw 提供一个客户侧宿主程序。第一版走 Windows exe/Bondie 路线：

- 打包为 Windows 下可运行程序。
- 通过 Tailscale 连接远程 OpenClaw。
- 承担通知、宿主在线、OpenClaw 远程触达等能力。

这条路线适合系统级能力，比如托盘、开机自启动、本地文件、Toast 通知。但分发侵入性更高，也更像传统客户端。

相关归档：`archive/windows-exe-route.md`

### 2. Browser extension 路线

后续为了降低分发成本和系统侵入，项目转向浏览器插件：

- 用户安装 Chrome/Edge extension。
- 插件通过 WebSocket 连接本地或远程 OpenClaw gateway。
- 插件作为 browser node，上报当前页面上下文、接收 OpenClaw 指令、展示通知或结果。

这个方向的核心价值不是“再做一个独立工具”，而是让 OpenClaw 长出浏览器里的触手。

### 3. 智能工作流 Agent 方向

2026-05-15 会议后，需求进一步扩展到浏览器智能工作流：

- Pattern Memory：识别用户经常一起打开的页面组合。
- 页面智能服务：把文章、GitHub 仓库、YouTube/Bilibili/Douyin/TikTok 等页面交给 OpenClaw 处理。
- 处理结果回到本地 workspace，并在插件里形成通知/历史记录。

这部分方向是对的，但当前实现把太多概念堆到首页，导致用户看不出主线。

## 当前本地事实

### Source of truth

后续人工介入应以这个目录为唯一主工作目录：

```text
/Users/fuyo-aic/Projects/openclaw-browser-host-extension
```

远端仓库唯一：

```text
https://github.com/veil-chow-fyaic/openclaw-browser-host-extension.git
```

当前分支：

```text
liev/ai-handoff-browser-workflow-agent-20260525
```

注意：不要再把 Liev worker 目录或 `_archive` 目录当成主开发入口。

### Chrome 当前加载目录

本机 Chrome 的扩展 `cljflebfgmekmnojaiaonfdjcmoonbpf` 当前加载的是：

```text
/Users/fuyo-aic/Projects/openclaw-browser-host-extension/extension
```

也就是说，只有主工作目录里的 `extension/` 会影响当前 Chrome 实测。

### 当前版本分裂

主工作目录已回流 protocol 4、鉴权恢复和 node role 心跳修复：

```text
version_name = 0.1.0-alpha.11
NODE_PROTOCOL_VERSION = 4
```

Liev worker 目录保留为修复来源证据，不再作为开发入口：

```text
/Users/fuyo-aic/code/liev-symphony-workspaces-openclaw-browser-host-extension/AIC-2735
version_name = 0.1.0-alpha.8
NODE_PROTOCOL_VERSION = 4
```

历史归档目录：

```text
/Users/fuyo-aic/Projects/_archive/liev-symphony-kit/AIC-2587-openclaw-in-review-workspace-20260526-170000
version_name = 0.1.0-alpha.7
NODE_PROTOCOL_VERSION = 3
```

结论：protocol 4 修复已移植到 Chrome 当前加载的主目录；alpha.11 还包含 stale deviceToken 自动恢复和 `node.presence.alive` 心跳修复。仍需 reload Chrome extension 并跑 gateway 60 秒验收，确认 Chrome 实际 service worker 版本等于 `0.1.11`。

### 最新连接证据

本机 Chrome 的 Secure Preferences 显示当前加载路径已经是主工作目录：

```text
/Users/fuyo-aic/Projects/openclaw-browser-host-extension/extension
```

2026-06-09 实测已经确认：

- protocol mismatch 已从当前连接链路中消失。
- stale deviceToken 会被清理并回退到 gateway token 重新配对。
- Chrome storage 曾记录 `connected=true`、`registered=true`、`online=true`。
- Gateway 接收到 `system.notify`，说明插件已能完成 node-compatible register/online 主链路。

2026-06-09 12:21 新增 CLI/CDP 验证结果：

- 日常 Default profile 不能直接开启 CDP。Chrome 149 返回 `DevTools remote debugging requires a non-default data directory`。
- 使用非默认最小 profile 复制当前扩展安装状态后，Chrome 成功启动 CDP。
- 该 profile 的目标扩展 service worker 已加载为 `chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf/src/background-entry.js`。
- 该 profile 的 Secure Preferences 已更新为 `service_worker_registration_info.version = 0.1.11`。
- 扩展 storage 记录 `connected=true`、`registered=true`、`online=true`，并连续更新 `lastHeartbeatAt`。
- alpha.11 运行后未再观察到新的 `protocol mismatch` 或 `unauthorized role: node`。

当前仍需人工注意的验收点：

- 日常 Default profile 曾显示 service worker `0.1.10`，说明用户日常浏览器仍可能需要在 `chrome://extensions` 手动 Reload 一次。
- alpha.10 会继续用 RPC `ping` 做心跳，Gateway 返回 `unauthorized role: node`；看到这个错误时，优先确认 Chrome 实际加载版本。
- alpha.11 已在 CLI/CDP profile 中验证通过，但不要把 Default profile 的状态和 CLI profile 混为一谈。

因此后续验收要分两层表述：代码包和 alpha.11 运行链路已通过；用户日常 Chrome profile 是否已升级，需要以扩展详情页或 Secure Preferences 显示 `0.1.11` 为准。

## 当前实现地图

### Extension 基础

```text
extension/manifest.json
extension/src/background.js
extension/src/popup.html
extension/src/popup.js
extension/src/options.html
extension/src/options.js
extension/src/content.js
extension/src/styles.css
```

Manifest 目前权限控制还算克制：

- `activeTab`
- `alarms`
- `downloads`
- `notifications`
- `scripting`
- `storage`
- `tabs`
- `host_permissions: []`
- `optional_host_permissions: http/https`

这个方向应保留，避免默认 `<all_urls>`。

### Background 现状

`extension/src/background.js` 当前约 2150 行，职责过重，已经同时承担：

- OpenClaw gateway WebSocket 连接。
- Ed25519 identity / pairing / deviceToken。
- node-compatible invoke/result/event。
- Pattern Memory 调度和建议。
- 页面服务和 context capture。
- `agent.request` 构造。
- handoff/通知/历史记录。
- suggestion accept/dismiss。
- 用户确认弹窗。

这是当前工程混乱的核心文件。短期可以先修 bug，但中期必须拆分。

### Popup 现状

当前首页结构：

- 顶部状态栏。
- 当前页面面板。
- 主按钮：`入库为知识笔记`。
- 三个次级按钮：`找库内关联`、`发起深研`、`Issue 草案`。
- 通知列表。
- 可恢复页面/Pattern 建议。
- 设置页里再放连接、知识能力、保存工作流、开发工具。

问题：

- 首页仍然有太多并列概念。
- 三个次级按钮不是用户马上能理解的浏览器插件核心功能。
- Pattern Memory 当前表现更像“保存/恢复页面”，还没有达到用户期待的智能感知。
- 开发工具已经放到二级页，这是正确方向，但整体视觉仍像工程调试面板。

### Media to Notes

当前已经把能力复制到插件目录：

```text
extension/plugins/media-to-notes
```

大小约 712K，包含 Python pipeline、Deepgram MCP server、Obsidian scripts、配置模板和 plugin metadata。

这个方向符合“插件的插件”思路，应该保留。但需要明确：

- 它不是浏览器 extension 内直接执行的 JS 能力。
- 它需要 OpenClaw 本地侧执行。
- 插件负责把页面上下文、插件路径、env 文件、输出目录等交给 OpenClaw。
- 产物应写入 OpenClaw workspace，例如 `~/.openclaw/workspace/browser-notes`。
- 处理完成后，OpenClaw 回传 TLDR、状态和 Markdown 路径，插件显示通知卡片/历史记录。

## 保留、暂停、移除

### 应保留

- OpenClaw node-compatible WebSocket 主线。
- Ed25519 identity、pairing、deviceToken。
- 小权限策略和用户主动触发页面读取。
- `入库为知识笔记` 作为最核心的页面智能服务入口。
- Media to Notes 作为插件内置能力模块。
- handoff/历史记录/通知卡片的产品方向。
- Options 中的 gateway、token、能力目录、输出目录配置。

### 应暂停

- 多 Agent provider。
- Native Messaging。
- 复杂 Pattern 语义分析。
- 品牌切换到 The Tailor/Bondie 的视觉工程。
- 商店上架文案和官网，等 MVP 稳定后再做。

### 应收敛或删除

- 首页的 `找库内关联`、`发起深研`、`Issue 草案` 暂时不应作为 P0 并列按钮。
- `browser-inbox` 不应作为用户可见主概念，应改为“OpenClaw 本地通道”或隐藏到高级设置。
- Liev worker 目录里的修复不能长期孤立存在。
- `_archive` 目录只能作为历史证据，不能继续开发。

## 建议的人工推进顺序

### Phase 0：冻结入口和事实

目标：先停止继续分散。

- 唯一开发入口固定为 `/Users/fuyo-aic/Projects/openclaw-browser-host-extension`。
- 暂停安排新 agent 做大改。
- Liev worker 目录只用于提取 protocol 4 修复，不再继续演进。
- 所有人工改动都在当前非 main 分支完成，不碰 main。

### Phase 1：先修连通性

目标：让当前 Chrome extension 能重新连上 OpenClaw gateway。

需要把 AIC-2735 worker 里的最小补丁回流到主目录：

- `extension/src/background.js`: `NODE_PROTOCOL_VERSION = 4`
- `extension/manifest.json`: bump 到新的 alpha 版本
- `extension/src/background-entry.js`: 作为 MV3 service worker 入口，用于打破旧 background worker 缓存
- `extension/src/background.js`: stale deviceToken 自动恢复，node role 心跳改为 `node.presence.alive`
- docs 里记录 protocol 4 gateway 要求

然后验证：

```bash
python3 -m json.tool "extension/manifest.json" >/dev/null
node --check "extension/src/background.js"
node --check "extension/src/background-entry.js"
node --check "extension/src/content.js"
node --check "extension/src/options.js"
node --check "extension/src/popup.js"
node --check "extension/src/confirm.js"
test ! -f "extension/src/history.js" || node --check "extension/src/history.js"
test ! -f "extension/src/pattern-memory.js" || node --check "extension/src/pattern-memory.js"
./scripts/package-extension.sh
```

Chrome 验收：

1. `chrome://extensions`
2. 找到 `cljflebfgmekmnojaiaonfdjcmoonbpf`
3. Reload
4. 等 60 秒
5. 确认扩展详情页或 Chrome Secure Preferences 中的 service worker 版本是 `0.1.11`
6. 确认 `gateway.err.log` 没有新的 protocol mismatch，也没有新的 `unauthorized role: node`

### Phase 2：重新定义 P0 UI

目标：把首页变成真正可用的插件，而不是控制台。

建议 P0 首页只保留四块：

1. 连接状态：OpenClaw 是否在线、最近一次错误。
2. 当前页面：标题、类型、是否支持知识笔记。
3. 主行动：`生成知识笔记`。
4. 最近处理：处理中/完成/失败通知卡片，支持关闭和进入历史。

设置页放：

- gateway/token/auto connect。
- Media to Notes 路径、env、输出目录。
- Pattern Memory 开关。
- 开发工具。

Pattern Memory 不应在首页以“工作流感知”抽象词出现。等它真的能自动产生可信建议后，再以“可恢复页面”或“相关页面”展示。

### Phase 3：把页面智能服务做成闭环

目标：用户点击一次后能看到全过程。

最小闭环：

```text
用户点击 生成知识笔记
-> 插件采集 URL/title/selectedText/textPreview
-> 插件发给 OpenClaw agent.request
-> OpenClaw 调用 extension/plugins/media-to-notes
-> Markdown 写入 ~/.openclaw/workspace/browser-notes
-> OpenClaw 回传完成消息、TLDR、路径
-> 插件显示通知卡片
-> 历史页可查
```

当前代码已有 handoff/通知/历史雏形，但需要和 OpenClaw 的真实返回协议对齐。

### Phase 4：工程整理

目标：降低后续维护成本。

建议把 `background.js` 拆成几个模块：

```text
extension/src/openclaw-transport.js
extension/src/page-services.js
extension/src/handoffs.js
extension/src/suggestions.js
extension/src/pattern-memory.js
extension/src/config.js
```

拆分原则：

- 不做新架构大爆炸。
- 每次只移动一类纯函数/一类消息处理。
- 每次移动后都跑 `node --check` 和手工 popup 烟测。

### Phase 5：分发

目标：让非开发用户可以稳定安装。

短期：

- 继续 zip 分发，但版本号和实际 Chrome 加载目录必须一致。
- README/quick-install 明确用户应解压到固定目录。
- 提供更新步骤：替换目录后在 `chrome://extensions` reload。

中期：

- 准备 Chrome Web Store 所需材料：
  - 图标和截图
  - 简洁描述
  - 隐私政策
  - 权限解释
  - 数据流说明

暂时不要做复杂安装器。

## 人工验收清单

### 连接验收

- Chrome 加载目录是主工作目录的 `extension/`。
- popup 显示在线。
- gateway 不再出现 protocol mismatch。
- 重新打开 Chrome 后 autoConnect 行为符合预期。

### 页面服务验收

- 普通文章页面能触发知识笔记请求。
- GitHub repo 页面能触发知识笔记请求。
- YouTube/Bilibili/Douyin/TikTok 页面能被识别为 media/video。
- 未配置 Media to Notes 路径时，UI 明确提示缺口。
- 配置完成后，OpenClaw 能产出 Markdown 文件路径。

### UI 验收

- 用户打开 popup 后 3 秒内能明白主按钮做什么。
- 首页没有开发工具。
- 首页不出现 `browser-inbox` 这类内部概念。
- 通知卡片可关闭。
- 历史页可查看已处理记录。

### 分发验收

- `./scripts/package-extension.sh` 产物版本与 manifest `version_name` 一致。
- zip 解压后能直接 Load unpacked。
- quick-install 文档与真实路径/版本一致。

## 当前关键风险

- 主目录和 worker 目录版本分裂，容易导致“代码修了但 Chrome 不生效”。
- `background.js` 继续膨胀会让任何小改都高风险。
- Pattern Memory 当前不能被描述成“智能感知已完成”。
- Media to Notes 需要本地执行环境，不能让用户误以为纯 extension 能独立跑完。
- 分发仍是开发者模式 unpacked extension，不是可分发产品形态。

## 后续决策建议

短期不要再扩大能力面。先按下面顺序收敛：

1. protocol 4 回流到主目录并通过 Chrome 实测。
2. popup 首页只服务一个主工作流：当前页生成知识笔记。
3. handoff/通知/历史闭环。
4. 再恢复 Pattern Memory，但只在有真实自动建议后展示到首页。
5. 最后处理商店分发和品牌包装。

这个顺序符合 KISS/YAGNI：先把一条核心路径做通，再扩展为智能工作流产品。
