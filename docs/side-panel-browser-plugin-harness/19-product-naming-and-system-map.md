# Bondie Dock 产品命名与系统边界

日期：2026-06-23

## 结论

浏览器插件面向用户的产品名定为 **Bondie Dock**。

原 `OpenClaw Browser Host` 继续作为历史工程名和迁移背景出现，但不再作为用户可见产品名。OpenClaw 仍是底层 agent/runtime 语义，Session Bridge 和 Control Plane 仍是服务边界名，不包装成用户品牌。

## 命名层级

| 层级 | 名称 | 说明 |
|---|---|---|
| 用户侧浏览器插件 | Bondie Dock | Chrome/Edge 插件、popup、side panel、安装文档使用这个名称 |
| 浏览器侧栏模块 | Bondie Dock Side Panel | 可拆卸 extension feature module，首期仍在本仓库内实现 |
| 中央权限与实例服务 | Bondie Control Plane | 已独立为 `fyaic/bondie-control-plane`，聚合 OAuth 身份、Bondie 实例、权限关系和 bridge registry |
| 每台 Bondie/OpenClaw 设备服务 | Bondie OpenClaw Session Bridge | 已独立在 `fyaic/bondie-openclaw-session-bridge`，负责该设备 sessions API |
| 底层运行时/协议 | OpenClaw / browser-host / node-compatible | 保留内部能力、capability、protocol、adapter 名称，避免破坏兼容性 |

## 为什么不是 OpenClaw Browser Host

- `Host` 更像后台进程，不像用户每天使用的产品入口。
- 当前主线已经从“浏览器宿主”升级为“会话侧栏 + 页面上下文 + 多 Bondie 权限视图”。
- 用户需要理解的是“我的 Bondie 会话停靠在这里”，不是“OpenClaw 有一个 host”。
- `Dock` 能覆盖会话切换、页面上下文、通知和任务状态停靠，后续扩展到多 Bondie ABC 实例也自然。

## 可用性初筛

`Bondie Dock` 作为组合名未见明显精确同名产品冲突；`Bondie` 单词本身已有其他商用项目使用。正式进入商店分发、域名、Logo 和商业材料前，需要单独做商标、域名、应用商店和 GitHub organization 的完整检索。本文只记录产品工程阶段的命名决策，不构成法律结论。

## 对外叙事

一句话：

> Bondie Dock 是 Bondie 的浏览器侧栏，让用户在浏览器里切换有权限访问的 Bondie 会话，并把当前网页安全交给 AI 处理。

面向内测用户：

- 安装浏览器插件后，用户可在 Side Panel 里看到自己有权限访问的 Bondie sessions。
- 从属关系下，用户可查看该 Bondie 实例的全部 sessions。
- 沟通关系下，用户只看到自己相关的 sessions。
- 当前网页可以直接发送给 Bondie 做总结、知识入库、深度调研或工作项草案。

## 仓库边界

- 当前仓库继续承载 Bondie Dock 浏览器插件：`fyaic/openclaw-browser-host-extension`。
- Session Bridge 标准分发仓库：`fyaic/bondie-openclaw-session-bridge`。
- Control Plane 标准仓库：`fyaic/bondie-control-plane`。

当前仓库暂不重命名，避免打断已有远端、Linear、安装文档和测试脚本引用。产品名先在 manifest、popup、options、side panel 和快速安装文档中落地。

## 下一步主线

1. 保持本地 Bondie 从属/沟通关系测试链路稳定。
2. 推进 `bondie-control-plane`：初始 dev token / registry / relationship resolver / bridge proxy / bridge health readiness / CI 骨架已创建；下一步补真实 OAuth token provider 和 Bondie Dock runtime adapter。
3. Bondie Dock 从 `legacy-session-bridge` 切到 `bondie-control-plane` provider 后，验证 ABC 多实例同时显示和权限过滤。
4. 标准化每台 Bondie/OpenClaw 设备部署 Session Bridge 的安装、健康检查、注册和回滚流程。
