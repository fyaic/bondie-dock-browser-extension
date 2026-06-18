# Session Bridge 504 修复 Runbook

日期：2026-06-17

## 目标

修复当前真实 Side Panel 会话列表被 B 侧 `/v1/sessions` HTTP 504 阻断的问题，同时保留可回退记录。

## 当前结论

已确认：

- Browser extension host permission 已授权。
- Side Panel status 可读到 Bridge available。
- B `/health` 正常。
- B `/v1/bridge` 正常。
- B `/v1/sessions` 使用同一 token/scope 直连也返回 HTTP 504。
- OpenClaw Gateway 进程可用，但 `sessions.list` 存在慢响应和 timeout。

因此当前阻断在：

```text
openclaw-session-bridge
  -> openclaw gateway call sessions.list
  -> timeout / slow response
```

不是浏览器权限、fetch adapter 或 UI 映射问题。

## 回退基线

修复前必须记录：

```bash
git -C /Users/fuyo-aic/Projects/openclaw-session-bridge status --short --branch
git -C /Users/fuyo-aic/Projects/openclaw-session-bridge rev-parse HEAD
git -C /Users/fuyo-aic/Projects/openclaw-session-bridge diff --stat
```

当前已知基线：

```text
branch: main
head: aaad93c docs: add standard bridge distribution guide
status: clean
```

如果修复失败，回退方式：

```bash
git -C /Users/fuyo-aic/Projects/openclaw-session-bridge diff > /tmp/openclaw-session-bridge-fix.patch
git -C /Users/fuyo-aic/Projects/openclaw-session-bridge restore app/adapters.py tests/test_gateway_adapter.py docs/todo.md
```

如果已经启动了新服务进程，停止测试进程，不改 launchd 生产服务。

## 不做什么

- 不改 OpenClaw transcript JSONL。
- 不改 `sessions.json` route 指针。
- 不执行真实 switch/new mutation。
- 不打印 token。
- 不把 timeout 单纯调大作为唯一修复。
- 不把授权模型从 scoped route 改成全局/fuzzy session search。
- 不让浏览器端兜底展示全局 sessions。

## 最小修复方案

### 1. exact key 命中后短路

当前 Gateway adapter 会对多个 lookup terms 串行调用 `sessions.list`。真实环境里 raw key 约 8.6s，agent key 约 11.1s，后者会踩 `OPENCLAW_GATEWAY_TIMEOUT=10000`。

修复：

- 每次 `sessions.list` 返回后，立即执行现有 `_filter_rows_by_keys` 和 `_filter_rows_by_wecom_scope`。
- 若得到 scoped rows，停止继续查询后续 terms。
- 仍保留 fail closed：必须通过 account/org/chatType/chatLabel/session_key 校验。

### 2. debug timing

在 `debug=true` 返回中增加：

```json
{
  "timings": {
    "lookup_terms": [
      {
        "term": "wecom-default-...",
        "method": "sessions.list",
        "elapsed_ms": 8573,
        "raw_count": 1,
        "candidate_count": 1,
        "filtered_count": 1,
        "short_circuited": true
      }
    ],
    "history_enrichment_ms": 120,
    "generation_scan_ms": 20,
    "total_ms": 8800
  }
}
```

普通 UI 不展示 debug timing。

### 3. 测试

新增 tests：

- exact key 第一项命中后只调用一次 `sessions.list`。
- 第一项无 scoped match 时继续 fallback 到下一 term。
- debug 输出包含 lookup timing。
- 现有 scope mismatch / unresolved tests 不回归。

## 验证命令

```bash
cd /Users/fuyo-aic/Projects/openclaw-session-bridge
".venv/bin/python" -m unittest tests.test_gateway_adapter
".venv/bin/python" -m unittest tests.test_api_contract
".venv/bin/python" -m compileall app tests
git diff --check
```

真实 smoke：

```bash
curl -sS --max-time 5 http://100.79.143.105:8766/health
```

使用 `.env` 中 token 调 `/v1/sessions?debug=true`，但不要打印 token。

## 2026-06-17 执行记录

B 侧已完成最小源码修复：

- 修改 `GatewayOpenClawAdapter._lookup_sessions`，exact route 第一项返回并通过 WeCom scope 校验后短路。
- `debug=true` 增加 `timings.lookup_terms[]`、`history_enrichment_ms`、`generation_scan_ms`、`total_ms`。
- 新增 tests 覆盖“第一项 scoped 命中即短路”和“第一项无 scoped match 时继续 fallback”。
- B 侧修复记录：`/Users/fuyo-aic/Projects/openclaw-session-bridge/docs/session-bridge-504-fix-2026-06-17.md`。

已执行验证：

```text
tests.test_gateway_adapter: 26 tests OK
tests.test_api_contract: 6 tests OK
compileall app tests: OK
git diff --check: OK
真实 Gateway 只读 adapter smoke: session_count=26, reason=ok, raw route key 4115ms short_circuited=true, total=5904ms
```

注意：运行中的 `http://100.79.143.105:8766` 服务不会自动使用未重启源码。Chrome Side Panel real sessions UI smoke 需要在 B 服务重启/部署后再复测。

## 2026-06-18 执行记录

已进一步推进到 HTTP 和 UI 层：

```text
临时 patched Bridge:
  base_url: http://127.0.0.1:18766
  /health: 200
  /v1/bridge: 200
  /v1/sessions?debug=true: 200
  session_count: 26
  raw route key: 4998ms
  short_circuited: true
  total_ms: 7020

正式当前 Bridge:
  base_url: http://100.79.143.105:8766
  /health: 200
  /v1/bridge: 200
  /v1/sessions: 200
  session_count: 26
  debug timing: absent

Chrome for Testing UI:
  method: temporary extension copy + dummy gateway online gate + temp patched bridge
  state: Ready
  bridge: OpenClaw Mac mini Session Bridge
  rendered session cards: 26
  stable after one refresh cycle: yes
  horizontal overflow: false
  screenshot: /tmp/openclaw-sidepanel-real-sessions-stable-20260618.png
```

本轮还修复了 Side Panel 刷新时先清空 sessions list 的闪烁问题：已有 sessions 时刷新不再先渲染空 loading list，避免定时刷新期间列表短暂消失。

注意：正式 `100.79.143.105:8766` 当前可用，但没有 debug timing，说明运行中进程仍可能未加载本修复源码。后续应安排低风险重启/部署，让正式服务具备 exact-route short-circuit 和 timing 诊断。

## 2026-06-18 正式服务重启记录

用户确认后已重启正式服务并完成复测。

重启前：

```text
old_pid: 1281
listen: 100.79.143.105:8766
health: 200
```

正式服务由 launchd 管理：

```text
label: com.openclaw.session-bridge
plist: /Users/fuyo-aic/Library/LaunchAgents/com.openclaw.session-bridge.plist
working_directory: /Users/fuyo-aic/Projects/openclaw-session-bridge
program: /Users/fuyo-aic/Projects/openclaw-session-bridge/.venv/bin/uvicorn
args: app.main:app --host 100.79.143.105 --port 8766
stdout: /Users/fuyo-aic/Projects/openclaw-session-bridge/logs/session-bridge.log
stderr: /Users/fuyo-aic/Projects/openclaw-session-bridge/logs/session-bridge.err.log
```

重启后：

```text
new_pid: 65427
health: 200
/v1/sessions?debug=true: 200
session_count: 26
reason: ok
has_timings: true
raw route key: 4212ms
short_circuited: true
total_ms: 6003
```

Chrome Side Panel 指向正式 Bridge 复测：

```text
method: temporary extension copy + dummy gateway online gate + official Bridge 100.79.143.105:8766
state: Ready
bridge: OpenClaw Mac mini Session Bridge
rendered session cards: 26
stable after refresh cycle: yes
horizontal overflow: false
screenshot: /tmp/openclaw-sidepanel-real-prod-sessions-20260618.png
```

后续重启方式：

```bash
launchctl kickstart -k "gui/$(id -u)/com.openclaw.session-bridge"
```

不要并行手动 `nohup uvicorn`，避免和 launchd 自动重启产生端口竞争。

## 成功标准

- 单元测试通过。
- debug timing 能说明耗时在哪。
- ZhouWei/周威真实 scope 不再稳定 504。
- Side Panel real sessions UI smoke 可以继续。
- 如果真实 Gateway 仍慢，返回的错误能清楚区分是 Gateway timeout，而不是 extension 权限问题。

## 记录位置

- 本 runbook：修复计划和回退。
- `openclaw-session-bridge/docs/todo.md`：B 侧性能项。
- Linear `AIC-3045`：跟踪修复进展。
