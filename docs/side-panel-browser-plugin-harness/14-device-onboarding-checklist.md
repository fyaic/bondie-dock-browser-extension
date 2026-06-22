# Bondie Device Onboarding Checklist

日期：2026-06-18

## 目标

把一台新的 OpenClaw/Bondie 设备接入多实例 Side Panel。完成后，Control Plane 可以通过 Tailscale/private network 调用该设备的 Session Bridge，但浏览器 extension 不需要知道设备 endpoint 或 token。

## 输入

- Bondie instance id，例如 `bondie-a`。
- 设备稳定名，例如 `openclaw-a-mac-mini`。
- Control Plane 可访问的 Tailscale IP 或 MagicDNS。
- 目标用户和 relationship：`subordinate/all_sessions` 或 `communication/participant_sessions`。

## 0. 不允许跳过的边界

- 不把 `SESSION_BRIDGE_TOKEN` 写入浏览器 Options。
- 不把 Tailscale endpoint 下发到 extension。
- 不用 device pairing 给用户提权。
- 不复制旧 bridge 的本地用户/session 映射。
- 不在 scoped session smoke 失败后用全局 session list 代替。

## 1. 准备 OpenClaw 设备

在目标设备上确认 OpenClaw/Gateway 可用：

```bash
openclaw --version
openclaw gateway call sessions.list --params '{"limit":1}'
```

如果这里失败，先修 OpenClaw。Session Bridge 只做本地 OpenClaw 能力封装，不应该模拟 session 数据。

## 2. 加入私网

- 安装并登录 Tailscale 或等价私网。
- 记录 Tailscale IP 或 MagicDNS。
- 确认 Control Plane 所在机器能访问目标设备端口。

```bash
curl -s http://<tailscale-ip-or-magicdns>:8766/health
```

如果 timeout，优先检查：

- Tailscale ACL。
- bridge listen address。
- 本机防火墙。
- 端口是否被其他进程占用。

## 3. 安装 Session Bridge

```bash
cd ~/projects
git clone https://github.com/fyaic/bondie-openclaw-session-bridge.git
cd openclaw-session-bridge
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.production.example .env
```

生成强 token：

```bash
python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
```

`.env` 最小配置：

```env
SESSION_BRIDGE_TOKEN=<strong-random-token>
SESSION_BRIDGE_ID=<stable-device-id>
SESSION_BRIDGE_NAME=Bondie Bridge - <device-name>

OPENCLAW_ADAPTER=gateway
OPENCLAW_GATEWAY_TIMEOUT=10000
OPENCLAW_SESSION_LIST_LIMIT=50
OPENCLAW_INCLUDE_LAST_MESSAGE=true
OPENCLAW_INCLUDE_SESSION_GENERATIONS=true
```

## 4. 本机启动和 smoke

手动启动：

```bash
. .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8766
```

本机 smoke：

```bash
SESSION_BRIDGE_TOKEN=<strong-random-token> \
./scripts/smoke_check.sh
```

验收：

- `/health` HTTP 200。
- `/v1/bridge` HTTP 200。
- 返回的 `bridge_id` 等于 `.env` 的 `SESSION_BRIDGE_ID`。
- adapter 为 `gateway`。

## 5. 安装长期服务

macOS：

- 使用 `deploy/launchd.fun.fuyo.openclaw-session-bridge.plist.example`。
- 生产重启优先使用 `launchctl kickstart -k`。

Linux：

- 使用 `deploy/systemd.openclaw-session-bridge.service.example`。
- 设置 `User`、`WorkingDirectory`、`EnvironmentFile`、`ExecStart`。

Linux 常用命令：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-session-bridge
sudo systemctl status openclaw-session-bridge --no-pager
```

## 6. Control Plane 侧验证

从 Control Plane 所在机器执行：

```bash
BRIDGE_BASE_URL=http://<tailscale-ip-or-magicdns>:8766 \
SESSION_BRIDGE_TOKEN=<strong-random-token> \
./scripts/smoke_check.sh
```

可选 scoped session smoke：

```bash
BRIDGE_BASE_URL=http://<tailscale-ip-or-magicdns>:8766 \
SESSION_BRIDGE_TOKEN=<strong-random-token> \
SMOKE_WECOM_USER_ID=<operator-id> \
SMOKE_EXTERNAL_USER_ID=<route-key> \
SMOKE_CONVERSATION_KEY=<route-key> \
SMOKE_ACCOUNT_ID=default \
SMOKE_ORGANIZATION=弗忧联盟 \
SMOKE_CHAT_TYPE=direct \
SMOKE_CHAT_LABEL=<route-label> \
./scripts/smoke_check.sh
```

验收：

- token 正确时 `/v1/bridge` 通过。
- token 错误时返回 401。
- scoped sessions 只返回对应 route 的 sessions，或明确 unresolved empty。
- 不允许出现全局/fuzzy sessions fallback。

## 7. 写入 Bridge Registry

写入或更新：

- `bridge_devices`
- `bridge_secrets`
- `bondie_instances`
- `instance_bridge_bindings`
- `user_instance_relationships`

最小示例：

```json
{
  "instance": {
    "instance_id": "bondie-a",
    "display_name": "Bondie A",
    "workspace_id": "default",
    "status": "active"
  },
  "relationship": {
    "user_id": "veil",
    "relationship_type": "subordinate",
    "visibility_policy": "all_sessions",
    "roles": ["owner"],
    "status": "active"
  },
  "bridge": {
    "bridge_id": "openclaw-a",
    "bridge_name": "Bondie Bridge - A",
    "endpoint": "http://bondie-a.tailnet:8766",
    "network_type": "tailscale",
    "adapter": "gateway",
    "status": "online"
  },
  "binding": {
    "role": "primary",
    "status": "active"
  }
}
```

## 8. Browser Side Panel 验收

当 Control Plane adapter 接入后，用浏览器验证：

1. OAuth 未登录：`identity_required`，不列 sessions。
2. 登录后：`GET /v1/bondie-instances` 只返回当前用户有关系的 instances。
3. 从属关系实例展示 `查看全部`。
4. 沟通关系实例展示 `仅相关`。
5. 沟通关系无法通过手写 `instanceId/sessionId` 查看他人 session。
6. new/switch 只有 explicit confirmation 才显示完成。

## 9. 回滚

如果新设备接入失败：

1. 将 `instance_bridge_bindings.status` 改回旧 primary bridge。
2. 将新 bridge 标记为 `disabled` 或 `degraded`。
3. 不删除 relationship，除非这是权限授予错误。
4. 保留 health/error 记录用于排查。
5. 浏览器侧无需改配置。

## 完成定义

- Control Plane 能从私网访问 bridge。
- Registry 中 instance、relationship、bridge、binding 一致。
- Browser projection 不包含 endpoint/token。
- `subordinate/all_sessions` 与 `communication/participant_sessions` 均通过自动化或手工 smoke。
- 失败路径 fail closed，不 fallback legacy/global sessions。
