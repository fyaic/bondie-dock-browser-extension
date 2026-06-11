# Browser Side Panel Harness 总纲

本目录把“OpenClaw Side Panel 从企业微信迁移到浏览器插件”的需求拆成可执行 harness。它不是最终实现代码，而是新主线后续实现、拆 issue、交给 agent 执行的入口。

## 文件地图

| 文件 | 用途 |
|---|---|
| `INIT.md` | 任务背景、预授权决策、跳过规则、启动顺序 |
| `01-PRD.md` | 产品目标、用户故事、范围边界、验收标准 |
| `02-legacy-system-analysis.md` | 旧 WeCom A/B 项目的关键结论和迁移取舍 |
| `03-browser-side-panel-architecture.md` | 新浏览器插件 side panel 架构、数据流、信任边界 |
| `04-plugin-module-contract.md` | “插件的插件”模块契约、manifest、background API |
| `05-implementation-sequence.md` | 分阶段实施计划、测试 gate、风险处理 |
| `10-self-checklist.md` | 执行者自检清单 |
| `TODO.md` | 动态任务状态 |
| `99-deviation-log.md` | 偏差、阻塞和已跳过事项 |

## 一句话方案

在当前 Browser Host Extension 内新增可拆卸的 `openclaw-side-panel` feature module：它用 Chrome/Edge Side Panel 展示 OpenClaw 会话控制 UI，通过 background 的 session adapter 调本地/远程 Session Bridge 或 OpenClaw Gateway，严格复用旧 B 侧的 scoped session、route-level new、generation-level switch 和 confirmation 语义。

## 新旧链路对比

旧链路：

```text
WeCom Side Panel
  -> X backend / A: OAuth, JS-SDK, panel token, WeCom scope
  -> Tailscale/private network
  -> Z bridge / B: OpenClaw session resolution and mutation
  -> OpenClaw
```

新链路：

```text
Browser Side Panel UI
  -> extension background / side-panel module host
  -> session adapter
  -> local or private Session Bridge, or OpenClaw Gateway
  -> OpenClaw
```

## 关键原则

- 不把 WeCom 的身份模型照搬到浏览器。
- 不让网页 DOM、URL 或用户手填 label 直接决定 session 授权。
- 不为了未来 Agent 过早抽象；先 OpenClaw first。
- 不把 Side Panel 做成 popup 的一个大分支；它应是可启用/禁用的模块。
- 不把 HTTP 200 当作切换完成；必须看 OpenClaw/Bridge 的 confirmed 字段。
- 不默认请求 `<all_urls>` 或静默读取页面正文。

## 与当前仓库的关系

当前仓库已有：

- MV3 background service worker。
- OpenClaw node-compatible WebSocket、pairing/deviceToken、capability dispatcher。
- Popup/Options/History/Confirm UI。
- Page intelligence、Media to Notes、Pattern Memory。
- `extension/plugins/media-to-notes` 作为外部脚本型内置插件。

Side Panel 新主线应新增第二类插件形态：extension UI module。它复用核心连接和存储，不复制 Gateway client。

## 第一阶段交付定义

第一阶段不追求完整聊天 App。只交付可验证的 session 控制 MVP：

- Side Panel 可打开。
- 显示连接/配对/session bridge 状态。
- 显示当前 OpenClaw workspace/scope。
- 列出当前 scope 下可切换 sessions。
- 支持新开对话。
- 支持选择历史 generation 并二次确认切换。
- 完成态严格基于 `new_conversation_confirmed` / `route_switch_confirmed`。
- 所有失败/空态可解释，且不会展示未授权的全局 session。

