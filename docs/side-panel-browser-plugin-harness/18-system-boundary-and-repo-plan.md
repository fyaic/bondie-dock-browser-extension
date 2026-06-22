# System Boundary and Repo Plan

日期：2026-06-22

## 背景

本文件回答三个边界问题：

- `Control Plane` 到底是不是页面前端。
- 是否应该维护一套面向 OpenClaw/Bondie 的标准 Session Bridge。
- `bridge secret store` 是什么，以及为什么不能放在浏览器插件里。

用户已明确：登录授权系统接入文档会后续提供。因此本文件不设计 OAuth 细节，只冻结系统边界和仓库拆分方向。

## 核心结论

### 1. Control Plane 不是 Side Panel 页面前端

在本主线中，命名应保持清晰：

```text
Browser Side Panel
  = 浏览器插件里的页面前端
  = 用户看到的会话列表、实例切换、合集视图、按钮交互

Bondie Control Plane
  = 服务侧 API / 控制面
  = OAuth identity、权限关系、实例 registry、bridge registry、session proxy、health 聚合

OpenClaw Session Bridge
  = 每台 Bondie/OpenClaw 设备旁边的本地服务
  = 把本地 OpenClaw Gateway / session store 封装成标准 HTTP API
```

Control Plane 未来可以有一个 admin dashboard，但那只是控制面的管理前端，不是当前浏览器插件的 Side Panel。

### 2. 应该维护标准 OpenClaw Session Bridge

建议维护一套我们自己的、标准分发的 `OpenClaw Session Bridge`。原因：

- ABC 不同 Bondie/OpenClaw 设备都需要用同一种协议暴露 sessions/new/switch/health。
- 浏览器插件不应直接知道每台设备的 Tailscale 地址和 token。
- Control Plane 可以统一调用多台 bridge，并按用户关系过滤 session。
- 标准分发可以沉淀 launchd/systemd、`.env`、smoke、版本号、回滚、日志和诊断。

推荐运行拓扑：

```text
Browser Side Panel
  -> Bondie Control Plane
    -> permission registry
    -> bridge registry
      -> Bondie A Session Bridge -> Bondie A OpenClaw
      -> Bondie B Session Bridge -> Bondie B OpenClaw
      -> Bondie C Session Bridge -> Bondie C OpenClaw
```

用户 Veil 同时能看到 A/B/C 的前提是：Control Plane 查到 Veil 对这三个 instance 都有 active relationship。A 是从属关系时返回全量 sessions；B/C 是沟通关系时只返回 Veil 自己相关的 sessions。

### 3. Bridge Secret Store 是服务端密钥保存位置

`bridge secret store` 指 Control Plane 保存每台 Session Bridge 调用凭证的地方。

它不是：

- 不是浏览器插件的 `chrome.storage`。
- 不是 Options 页面里让用户填三台设备 token。
- 不是 Side Panel payload 里返回给前端的字段。
- 不是 Tailscale 本身。

它保存的是：

- 每台 bridge 的 `SESSION_BRIDGE_TOKEN` 或 token 引用。
- token hash、轮换时间、过期时间等元数据。
- `bridge_id -> secret_ref` 的映射。

典型调用方式：

```text
Browser Side Panel
  -> GET /v1/bondie-instances/bondie-a/sessions
  -> Control Plane 验证 viewer 对 bondie-a 的 relationship
  -> Control Plane 从 secret store 取 bondie-a bridge token
  -> Control Plane 调用 http://bondie-a.tailnet:8766/v1/sessions
  -> Control Plane 过滤并返回授权后的 sessions projection
```

浏览器只拿到授权后的 projection，不拿到 bridge endpoint、bridge token、secret ref、Tailscale node key。

## 推荐仓库拆分

### Browser Extension Repo

当前仓库：

```text
https://github.com/fyaic/openclaw-browser-host-extension.git
```

职责：

- Chrome/Edge/Safari extension 外壳。
- Side Panel UI。
- popup/options/history/confirm UI。
- extension background message contract。
- Control Plane client adapter。
- 本地开发直连 legacy Session Bridge 的兼容路径。

不承担：

- OAuth 服务端。
- relationship registry。
- 多 bridge token 保存。
- bridge 标准分发。

### OpenClaw Session Bridge Repo

已创建 private 独立仓库：

```text
https://github.com/fyaic/bondie-openclaw-session-bridge.git
```

当前本地参考仓库：

```text
/Users/fuyo-aic/Projects/openclaw-session-bridge
current remote: https://github.com/veil-chow-fyaic/openclaw-session-bridge.git
new remote: https://github.com/fyaic/bondie-openclaw-session-bridge.git
```

职责：

- 每设备本地 HTTP bridge。
- `/health`、`/v1/bridge`、`/v1/sessions`、`/v1/sessions/new`、`/v1/switch-session`。
- OpenClaw Gateway adapter。
- session list 性能、timeout、debug timing。
- launchd/systemd 标准分发。
- `.env.production.example`、smoke 脚本、回滚 runbook。

该仓库已按 private 创建，但本地提交和 push 仍需按 git 操作确认节奏执行。

### Bondie Control Plane Repo

建议后续独立仓库：

```text
https://github.com/fyaic/bondie-control-plane.git
```

职责：

- OAuth user identity 接入。
- `user_instance_relationships` 权限关系。
- `bondie_instances` 实例 registry。
- `bridge_devices` / `instance_bridge_bindings` bridge registry。
- bridge secret store 集成。
- Control Plane API：
  - `GET /v1/me`
  - `GET /v1/bondie-instances`
  - `GET /v1/bondie-instances/{instance_id}/sessions`
  - `POST /v1/bondie-instances/{instance_id}/sessions/new`
  - `POST /v1/bondie-instances/{instance_id}/sessions/switch`
- health/readiness 聚合。
- audit log。

不承担：

- 浏览器插件 UI。
- 每台设备上的 OpenClaw Gateway adapter 细节。

## 文档互索引规则

三个仓库必须互相索引，避免工程现场断裂。

Browser Extension 文档应链接：

- Control Plane contract：`docs/side-panel-browser-plugin-harness/12-control-plane-contract.md`
- Bridge registry schema：`docs/side-panel-browser-plugin-harness/13-bridge-registry-schema.md`
- Device onboarding：`docs/side-panel-browser-plugin-harness/14-device-onboarding-checklist.md`
- 本文件：`docs/side-panel-browser-plugin-harness/18-system-boundary-and-repo-plan.md`

Session Bridge 仓库本地已新增并应持续维护：

- `/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/browser-side-panel-integration.md`：说明 browser/control-plane 如何调用 bridge。
- `/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/control-plane-registration.md`：说明 `bridge_id`、endpoint、token、capabilities 如何注册。
- `docs/standard-distribution.md`：安装、升级、回滚、smoke。

Control Plane 仓库应新增：

- `docs/browser-side-panel-api.md`：面向 extension 的 API contract。
- `docs/bridge-registry.md`：bridge registry 和 secret store。
- `docs/session-visibility-policy.md`：从属/沟通关系过滤规则。
- `docs/repo-cross-index.md`：三仓互链。

## 最小落地顺序

1. 浏览器插件继续保持 `bondie-control-plane` provider fail closed，等待 OAuth token provider 文档。
2. Session Bridge 仓库先标准化现有代码、补发布文档和 smoke，确认能部署到多台 Bondie 设备。
3. Control Plane 仓库建最小 API：OAuth stub、relationship fixtures、bridge registry fixtures、sessions proxy。
4. 浏览器插件接入 Control Plane runtime adapter，但默认只在 OAuth ready 和 Control Plane URL 配好时启用。
5. 用 A/B/C 三个 fixture + 至少一台真实 bridge 做端到端 smoke。
6. 将 Session Bridge 本地文档和标准分发更新提交，并按发布节奏 push 到 `fyaic/bondie-openclaw-session-bridge`。

## 禁止混淆

- 不把 Control Plane 当作浏览器前端。
- 不把 Browser Side Panel 当作权限最终裁决者。
- 不把 Session Bridge token 下发到浏览器作为多 Bondie 方案。
- 不用 device pairing 代替 OAuth user identity。
- 不让 browser direct Tailscale to every bridge 成为默认产品拓扑。
- 不用 `instance_id`、URL、route label 或用户手填字段提升权限。
