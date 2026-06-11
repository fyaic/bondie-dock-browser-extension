# OpenClaw Browser Side Panel Harness INIT

日期：2026-06-11

## 任务身份

本目录是 `feature/openclaw-browser-side-panel-plugin` 分支的新主线 harness。目标是在当前浏览器插件基础上规划并推进 OpenClaw Side Panel 能力，脱离企业微信自建应用环境，形成可拆卸的浏览器插件内模块。

## 深层目标

把旧的企业微信 Side Panel session 控制体验迁移到浏览器插件：

- 用户在浏览器侧获得类似主流 AI 对话软件的会话列表、当前会话、新建会话、切换会话能力。
- OpenClaw session mutation 仍由可信 OpenClaw/Session Bridge 控制面执行，浏览器 UI 只表达用户意图和展示确认状态。
- Side Panel 能作为可安装、可禁用、可替换的 extension module，而不是与 popup、page intelligence、pattern memory 硬耦合。
- 后续可扩展到 Edge；Safari 需要单独适配评估，不进入第一阶段硬承诺。

## 当前分支

```text
repo: /Users/fuyo-aic/Projects/openclaw-browser-host-extension
branch: feature/openclaw-browser-side-panel-plugin
github: https://github.com/fyaic/openclaw-browser-host-extension.git
```

## 已读旧项目

```text
/Users/fuyo-aic/Projects/wecom-sidepanel-probe
/Users/fuyo-aic/Projects/openclaw-session-bridge
```

关键结论：

- 旧 A 侧 `wecom-sidepanel-probe` 负责 WeCom OAuth、JS-SDK、窄栏 UI、panel token、scope 转发。
- 旧 B 侧 `openclaw-session-bridge` 负责 OpenClaw route/session 解析、授权过滤、switch/new、Gateway read-back confirmation。
- 可复用的是 B 的 session API 语义、confirmation 规则、route/generation 边界。
- 必须替换的是 WeCom OAuth、JS-SDK、企业可信域名、客户联系/上下游入口、panel_token、WeCom operator 重建逻辑。

## 预授权决策

本 harness 预授权以下决策，执行者不要反复请示：

- OpenClaw first：第一阶段只服务 OpenClaw，不实现完整多 Agent provider。
- Side Panel 第一阶段作为 Chrome/Edge Chromium 能力推进，复用当前 `minimum_chrome_version: "116"` 基线。
- Safari 不阻塞 MVP，只写适配差异和后续评估。
- UI 模块采用“插件的插件”形式：extension core 提供 transport/storage/capability host，`openclaw-side-panel` 作为内置 feature module 注册。
- Session Bridge 先复用 HTTP contract，后续再评估是否直接走 OpenClaw Gateway 或 Native Messaging。
- 浏览器页面、DOM、active tab payload 都不作为 session 授权源；session 授权必须来自 pairing/device identity、用户选择的 workspace/scope、bridge/OpenClaw read-back。
- `new-session` 仍是 route-level action，不发送 `session_id`。
- `switch-session` 仍是 generation-level action，必须携带目标 `session_id` 或等价 generation id。
- UI 完成态必须看 `new_conversation_confirmed=true` 或 `route_switch_confirmed=true`，不能只看 HTTP 200。

## 需要人类确认的重大决策

只有这些事项需要升级给人：

- 第一阶段是否把本地 `openclaw-session-bridge` 保持为独立进程，还是直接让 extension 通过 OpenClaw Gateway 调 session API。
- 是否引入 Native Messaging host。该决定会显著改变安装、权限和分发路线。
- Side Panel 产品名称、品牌表达和是否从 Browser Host 改名。
- Safari 是否进入同一期交付。
- 需要外部生产环境 token、真实用户数据、真实 OpenClaw route 写操作时。

## 跳过并继续规则

- 旧项目文件不可读：记录到 `99-deviation-log.md`，继续基于已读 README/docs/tests 推进。
- Chrome Side Panel API 细节不确定：先按 `sidePanel` permission 规划，标记为待官方文档复核，不阻塞文档。
- Session Bridge 新版本 API 与本地旧文档不一致：以现场代码和 contract tests 为准，记录偏差。
- 真实 OpenClaw Gateway 不可达：先用 mock/session bridge fixture 设计契约和 UI 状态。

## 启动顺序

1. 读 `00-README.md` 获取全局地图。
2. 读 `01-PRD.md` 确认产品范围。
3. 读 `02-legacy-system-analysis.md` 理解旧 A/B 边界。
4. 读 `03-browser-side-panel-architecture.md` 获取新架构。
5. 读 `04-plugin-module-contract.md` 获取“插件的插件”接口。
6. 按 `05-implementation-sequence.md` 推进实现。
7. 每次提交前跑 `10-self-checklist.md`。
8. 更新 `TODO.md` 和 `99-deviation-log.md`。

