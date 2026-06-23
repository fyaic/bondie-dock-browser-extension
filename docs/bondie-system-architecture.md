# Bondie System Architecture

日期：2026-06-23

## 三仓定位

Bondie 浏览器侧能力拆成三个独立仓库。三者必须分离，但命名、文档和接口要保持同一套语法。

| 层级 | 标准名称 | 标准仓库 | 职责 |
|---|---|---|---|
| 用户入口 | Bondie Dock | `fyaic/bondie-dock-browser-extension` | Chrome/Edge extension host、popup、options、host permissions、插件内插件系统 |
| 权限和聚合服务 | Bondie Control Plane | `fyaic/bondie-control-plane` | OAuth/user identity、Bondie instance registry、从属/沟通关系、bridge registry、session visibility projection |
| 设备侧桥 | Bondie OpenClaw Session Bridge | `fyaic/bondie-openclaw-session-bridge` | 每台 Bondie/OpenClaw 设备上的本地 sessions API，封装 OpenClaw runtime/Gateway |

## 调用链路

```text
Bondie Dock browser extension
  -> bondie-side-panel feature module
  -> Bondie Control Plane
  -> Bondie OpenClaw Session Bridge on each permitted device
  -> OpenClaw runtime / Gateway
```

## 插件的插件

Bondie Dock 是浏览器插件宿主。Side Panel 不是独立产品仓库，而是 Dock 内部的 feature module：

```text
extension/plugins/bondie-side-panel/plugin.json
extension/src/modules/bondie-side-panel/
extension/src/sidepanel/
```

这让 Dock 可以继续承载其他内置模块，例如 Media to Notes、Pattern Memory、Page Research。模块可以启用/禁用，但共享 Dock 的 storage、permissions、background message router 和 browser capability host。

## 命名规则

- 对用户和 worker 说：Bondie Dock、Bondie Control Plane、Bondie OpenClaw Session Bridge。
- 对底层 runtime 说：OpenClaw runtime、OpenClaw Gateway、OpenClaw node-compatible protocol。
- 对浏览器内模块说：`bondie-side-panel`。
- 不再新增 `OpenClaw Browser Host`、`openclaw-side-panel` 这类产品级名称；它们只可出现在历史迁移说明中。

## 权限模型

- 从属关系：`subordinate -> all_sessions`，用户可看该 Bondie instance 的全部 sessions。
- 沟通关系：`communication -> participant_sessions`，用户只看自己相关 sessions。
- Dock 只渲染 Control Plane 返回的授权投影。
- Control Plane 负责身份、关系和 bridge token 管理。
- Session Bridge 只相信服务侧传入的 scope 和 bearer token，不相信浏览器直接传来的身份。

## 当前本地路径

```text
/Users/fuyo-aic/Projects/bondie-dock-browser-extension
/Users/fuyo-aic/Projects/bondie-control-plane
/Users/fuyo-aic/Projects/openclaw-session-bridge
```

Session Bridge 当前本地运行服务仍由 launchd 引用旧路径 `/Users/fuyo-aic/Projects/openclaw-session-bridge`。为避免打断正式 `100.79.143.105:8766`，本轮只统一远端仓库和文档命名；本地路径迁移应在更新 launchd plist 后单独执行。

