# Control Plane Chrome Manual Gate

日期：2026-06-24

## 目的

本文件是 Bondie Dock 进入真实 Chrome 手动验收前的最小 gate。它验证：

- Bondie Dock 使用 `bondie-control-plane` provider，而不是 legacy direct Session Bridge。
- Control Plane dev token 能代表当前用户读取有权限的 Bondie instances。
- 从属关系显示 `all_sessions`，沟通关系显示 `participant_sessions`。
- 浏览器端不会拿到 bridge endpoint 或 bridge token。

生产 OAuth 不在本 gate 内；等登录授权系统文档到位后，用正式 token provider 替换 dev token provider。

## 前置条件

- 本仓库路径：`/Users/fuyo-aic/Projects/bondie-dock-browser-extension`
- Control Plane 仓库路径：`/Users/fuyo-aic/Projects/bondie-control-plane`
- Session Bridge 正式服务健康：`http://100.79.143.105:8766/health`
- 本地 `.env` 中有 `SESSION_BRIDGE_TOKEN`。
- 本次 smoke 使用开发 token，示例变量名为 `BONDIE_DEV_TOKEN`。不要把真实 token 写入文档或提交。

## 1. 启动 Control Plane

在 `bondie-control-plane` 仓库执行：

```bash
cd "/Users/fuyo-aic/Projects/bondie-control-plane"
set -a
test -f "/Users/fuyo-aic/Projects/openclaw-session-bridge/.env" && source "/Users/fuyo-aic/Projects/openclaw-session-bridge/.env"
test -f ".env" && source ".env"
set +a
BONDIE_DEV_TOKEN="${BONDIE_DEV_TOKEN:-test-secret}" \
BONDIE_CONTROL_PLANE_PORT="${BONDIE_CONTROL_PLANE_PORT:-8790}" \
npm start
```

说明：

- `SESSION_BRIDGE_TOKEN` 只供 Control Plane 服务端调用 Session Bridge。
- `BONDIE_DEV_TOKEN` 只供本地 smoke 和 Chrome 手测使用。
- 若端口被占用，改 `BONDIE_CONTROL_PLANE_PORT`，同时更新扩展 Options 中的 URL。

## 2. 运行模块级 Smoke

另开终端，在浏览器仓库执行：

```bash
cd "/Users/fuyo-aic/Projects/bondie-dock-browser-extension"
BONDIE_CONTROL_PLANE_URL="http://127.0.0.1:8790" \
BONDIE_CONTROL_PLANE_TOKEN="${BONDIE_DEV_TOKEN:-test-secret}" \
node "scripts/smoke-control-plane-runtime.mjs" \
  --expect-instance "bondie-a" \
  --expect-min-sessions "1"
```

通过标准：

- `status` 为 `ready`。
- `bridge.adapter` 为 `bondie-control-plane`。
- `bridge.available` 为 `true`。
- `instances` 至少包含 `bondie-a`。
- `bondie-a` 的 `visibility` 为 `all_sessions`。

常见失败：

| 失败 | 判断 |
|---|---|
| `identity_required` | dev token 缺失或与 Control Plane 不一致 |
| `permission_required` | Chrome 手测时未授权 Control Plane origin；模块 smoke 默认授予 |
| `control_plane_http_error` | Control Plane 未启动或 token 被拒绝 |
| `bridge_unavailable` | Control Plane 能启动，但后端 Session Bridge 不健康或 token 错 |

## 3. 加载最新扩展

在 Chrome 打开：

```text
chrome://extensions
```

操作：

1. 打开 Developer mode。
2. 选择 Load unpacked。
3. 选择目录：`/Users/fuyo-aic/Projects/bondie-dock-browser-extension/extension`
4. 如果已加载旧版本，点击 Reload，确保 service worker 使用最新代码。
5. 打开扩展 Options。

## 4. 配置 Options

在 Options 中设置：

| 字段 | 值 |
|---|---|
| Side Panel enabled | 开启 |
| Identity mode | `OAuth / Control Plane` |
| Instance provider | `Bondie Control Plane` |
| Control Plane URL | `http://127.0.0.1:8790` |
| Control Plane dev token | 与 `BONDIE_DEV_TOKEN` 相同 |

legacy Session Bridge 字段可以保留原配置；Control Plane 模式不会回退到 legacy direct Bridge。

## 5. 打开 Side Panel

操作：

1. 从扩展 popup 点击打开 Side Panel，或从 Chrome 侧栏打开。
2. 如果出现 Control Plane origin 授权按钮，点击授权。
3. 刷新 Side Panel。

通过标准：

- 顶部状态为 `Ready`。
- 诊断里 `instance_provider` 为 `bondie-control-plane`。
- 诊断里 `adapter` 为 `bondie-control-plane`。
- 实例切换器能看到 `全部` 和至少一个 Bondie instance。
- 从属实例显示 `查看全部`。
- 沟通实例显示 `仅相关`。
- 会话列表按 instance 分组，不出现跨实例混排且无法辨认来源。

## 6. 不通过时的处理顺序

1. 先跑 `scripts/smoke-control-plane-runtime.mjs`，确认不是服务端问题。
2. 再检查 Chrome Options 是否保存了 Control Plane URL/token。
3. 再检查 Chrome host permission 是否授权 `http://127.0.0.1:8790/*`。
4. 再检查 `chrome://extensions` 中扩展是否 Reload 到最新版本。
5. 最后检查正式 Session Bridge `/health` 和 Control Plane server 终端日志。

## 本轮不做

- 不执行真实 `new/switch` mutation。
- 不接生产 OAuth。
- 不把 bridge token 写入浏览器配置。
- 不让浏览器直连多台 Bondie Session Bridge。
