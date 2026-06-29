# Migration Handoff Audit - Bondie Dock / Control Plane / Session Bridge

日期：2026-06-29

本文件用于迁移交付前的全链路盘点。目标是让后续团队不会丢失本地代码、运行现场、远端仓库状态、权限模型边界和未完成事项。

## 1. 核心结论

当前 Bondie 浏览器 Side Panel 主线由三个仓库组成：

| 层级 | 标准名称 | 本地路径 | 标准远端 | 当前交付状态 |
|---|---|---|---|---|
| 用户入口 | Bondie Dock | `/Users/fuyo-aic/Projects/bondie-dock-browser-extension` | `https://github.com/fyaic/bondie-dock-browser-extension.git` | 当前分支新增本审计文档，随本次交付提交推送 |
| 权限和聚合服务 | Bondie Control Plane | `/Users/fuyo-aic/Projects/bondie-control-plane` | `https://github.com/fyaic/bondie-control-plane.git` | private 远端已创建，`main` 已推送，测试通过 |
| 设备侧桥 | Bondie OpenClaw Session Bridge | `/Users/fuyo-aic/Projects/openclaw-session-bridge` | `https://github.com/fyaic/bondie-openclaw-session-bridge.git` | Session 可见性修复已提交并推送到 `main` |

设计边界仍保持：

```text
Bondie Dock browser extension
  -> bondie-side-panel feature module
  -> Bondie Control Plane
  -> Bondie OpenClaw Session Bridge on each permitted device
  -> OpenClaw runtime / Gateway
```

本地手测仍有 legacy direct Bridge 路径，但生产目标是 Dock 通过 Control Plane 聚合多 Bondie instance。不要把 legacy 直连当成最终产品架构。

## 2. 核心仓库 Git 状态

### 2.1 Bondie Dock

```text
Path: /Users/fuyo-aic/Projects/bondie-dock-browser-extension
Branch: feature/bondie-multi-instance-permissions
Upstream: origin/feature/bondie-multi-instance-permissions
HEAD: 593c2fa 2026-06-24 16:58:34 +0800 Clarify side panel route index semantics
Remote: https://github.com/fyaic/bondie-dock-browser-extension.git
Ahead/behind before this audit doc: 0 / 0
Stash: none
```

注意：本次交付会把该审计文档提交到当前 Side Panel 主线分支，作为后续团队接手入口。

验证命令：

```bash
node --check "extension/src/background.js"
node --check "extension/src/modules/bondie-side-panel/module.js"
node --check "extension/src/modules/bondie-side-panel/session-adapter.js"
node --check "extension/src/modules/bondie-side-panel/control-plane-adapter.js"
node "scripts/test-control-plane-contract.mjs"
```

结果：

```text
{"ok":true,"instances":2,"sessions":1,"adapterCalls":4,"moduleFailClosed":true,"moduleControlPlaneCalls":6}
```

### 2.2 Bondie Control Plane

```text
Path: /Users/fuyo-aic/Projects/bondie-control-plane
Branch: main
Upstream: origin/main
HEAD: defa070 2026-06-23 17:57:58 +0800 Document Bondie repository architecture
Remote: https://github.com/fyaic/bondie-control-plane.git
Working tree: clean
Stash: none
```

远端修复记录：

```text
2026-06-29 created private repo: https://github.com/fyaic/bondie-control-plane
origin/main: defa070af04903f3dceaeb96aeaa3af0d80a56b9
```

验证命令：

```bash
npm test
npm run check
```

结果：

```text
tests 5, pass 5
node --check src/server.mjs src/registry.mjs src/bridge-client.mjs src/health.mjs passed
```

### 2.3 Bondie OpenClaw Session Bridge

```text
Path: /Users/fuyo-aic/Projects/openclaw-session-bridge
Branch: main
Upstream: origin/main
HEAD: b3bfcee 2026-06-29 +0800 Fix bridge session visibility timeouts
Remote origin: https://github.com/fyaic/bondie-openclaw-session-bridge.git
Remote legacy-origin: https://github.com/veil-chow-fyaic/openclaw-session-bridge.git
Ahead/behind: 0 / 0
Stash: none
Working tree: clean
```

已提交修复：

```text
b3bfcee Fix bridge session visibility timeouts
```

修复意图：

- `visibility_policy=all_sessions` 从属关系优先读取本机 OpenClaw `sessions.json` route index，不再走慢的 Gateway 全量 `sessions.list`。
- 默认关闭列表页逐条 `chat.history` 预览 enrichment，避免服务关系卡到前端 20s timeout。
- 增加 `OPENCLAW_ENRICH_SESSION_HISTORY=false/true` 开关。
- 增加测试，证明从属关系不会触发 Gateway full scan。

验证命令：

```bash
"/Users/fuyo-aic/Projects/openclaw-session-bridge/.venv/bin/python" -m unittest discover -s tests
```

结果：

```text
Ran 38 tests in 0.050s
OK
```

真实接口 smoke：

```text
communication / participant_sessions:
  HTTP 200
  sessions: 46
  collection_kind: generation_list
  history_enrichment_ms: 0
  total time: about 4.44s

subordinate / all_sessions:
  HTTP 200
  sessions: 30
  collection_kind: route_index
  method: sessions.json
  total time: about 0.008s
```

当前运行中的正式 `100.79.143.105:8766` 服务仍健康。该服务进程加载的是同一份本地工作区代码；修复已提交到标准远端，后续团队重启/换机不会丢失该修复。

## 3. 当前运行现场

### 3.1 Session Bridge

```text
Address: http://100.79.143.105:8766
Process: python3.1 PID 5299
Command: /Users/fuyo-aic/Projects/openclaw-session-bridge/.venv/bin/uvicorn app.main:app --host 100.79.143.105 --port 8766
Health: OK
```

`/health` 返回：

```json
{"status":"ok","bridge_id":"mac-mini-session-bridge","adapter":{"adapter":"gateway","ready":true,"cli_bin":"/opt/homebrew/bin/openclaw","agent_id":"main","gateway_call":"sessions.list"}}
```

### 3.2 Control Plane

```text
Default local URL: http://127.0.0.1:8790
Current runtime state: not listening
```

后续团队若要验证 Control Plane 路径，需要在 `/Users/fuyo-aic/Projects/bondie-control-plane` 启动：

```bash
cp .env.example .env
cp config/registry.example.json config/registry.local.json
node src/server.mjs
```

### 3.3 Browser Host / Gateway

```text
Dummy test gateway ws://127.0.0.1:9876 currently not listening
```

legacy direct Bridge 手测时，Bondie Dock 仍要求 paired/online gate。没有真实 Gateway 或 dummy Gateway 时，即使 `8766` Bridge 健康，Side Panel 也会停在未配对/离线状态。

### 3.4 Chrome 手测状态

本轮未发现仍在运行的 Chrome for Testing unpacked extension 进程。要复测，应重新加载：

```text
Extension path: /Users/fuyo-aic/Projects/bondie-dock-browser-extension/extension
Bridge URL: http://100.79.143.105:8766
Route organization: 弗忧联盟
Route type: direct
Route key: wecom-default-弗忧联盟-veil（周威）
Route label: Veil（周威）
Operator id: ZhouWei
```

关系切换验收：

- `communication` -> `participant_sessions` -> 只显示 Veil（周威）相关 generations。
- `subordinate` -> `all_sessions` -> 显示当前 bridge 的 route index，不一次性把所有 transcript 全量丢给前端。

## 4. 权限与数据边界

必须继续遵守这些边界：

- 不在中间层维护 `周威 -> Veil（周威）` 这类 alias 列表。
- canonical route label 由 OpenClaw/上游路由事实提供，Bridge 不自行发明。
- 从属关系：`subordinate -> all_sessions`，可看该 Bondie instance 的全部 route/session projection。
- 沟通关系：`communication -> participant_sessions`，只能看用户相关 scope。
- Dock 只渲染 Control Plane 或 legacy Bridge 返回的 projection。
- Control Plane 管 OAuth/user identity、instance relationship、bridge registry 和 bridge token。
- Session Bridge 只接收服务侧 bearer token 和 scoped route payload，不做 OAuth，也不维护用户关系库。
- Browser extension 不应持有多 bridge endpoint/token。

## 5. 邻接仓库和交付风险

### 5.1 SynapseHub

```text
Path: /Users/fuyo-aic/Projects/synapsehub
Branch: main
Remote: https://github.com/veil-chow-fyaic/synapsehub.git
HEAD: b6d055f docs: clarify synapsehub handoff paths
Working tree: clean
Status after fetch: behind origin/main by 70 commits
```

结论：本地 SynapseHub 是干净但严重落后的副本。若本次交付包含统一授权/Auth0/SynapseHub 标准分发，不能直接把该本地目录当最新版交付；必须先决定是否 fast-forward 或另行 clone 最新远端。

### 5.2 DocFerry / Obsidian share plugin auth worktree

```text
Path: /Users/fuyo-aic/Projects/obsidian-share-plugin-synapsehub-auth
Remote: https://github.com/fyaic/Docferry-Private-Src.git
Branch: feature/docferry-synapsehub-auth
Upstream: origin/main
Status: behind 29, dirty
```

存在大量未提交代码和迁移文件，包括：

```text
plugin/src/auth-service.ts
plugin/src/api-client.ts
server/app/auth.py
server/migrations/versions/0006_synapsehub_auth.py
server/migrations/versions/0007_remove_legacy_user_table.py
docs/product/regression-evidence/
```

结论：这是 DocFerry/Auth 相关邻接工作，不属于 Bondie Dock 三仓核心交付。若团队要接管 SynapseHub/Auth0 标准分发，也必须单独处理该 dirty worktree，不能和 Bondie Dock 混交付。

### 5.3 Bondie runtime repositories

```text
/Users/fuyo-aic/Projects/Bondie
  HEAD detached at f438a88
  clean
  remote contains origin/0623-meeting-quality and other branches

/Users/fuyo-aic/Bondie
  branch main
  behind origin/main by 24
  dirty
```

`/Users/fuyo-aic/Projects/Bondie` 是干净但 detached 的运行快照，不是 canonical main 工作区。

`/Users/fuyo-aic/Bondie` 有未提交 WeCom/plugin routing 改动：

```text
M extensions/wecom-common/src/security.ts
M extensions/wecom/openclaw.plugin.json
M extensions/wecom/src/bridge/tool.ts
M extensions/wecom/src/channel.ts
M extensions/wecom/src/config-schema.ts
M extensions/wecom/src/monitor.test.ts
M extensions/wecom/src/monitor.ts
M extensions/wecom/src/outbound.test.ts
M extensions/wecom/src/outbound.ts
?? extensions/wecom/src/bridge/tool.test.ts
?? extensions/wecom/src/routing.ts
?? .vite/
```

结论：如果迁移范围包含 Bondie runtime / WeCom extension，需要另起清理任务；不要把这两个目录都当作同一个干净主仓交付。

### 5.4 OpenClaw ops docs duplicates

```text
/Users/fuyo-aic/Projects/openclaw-ops-docs
  clean
  behind origin/main by 7

/Users/fuyo-aic/openclaw-ops-docs
  dirty
  behind origin/main by 7
```

结论：存在重复本地副本。若要交付 ops 文档，先确认哪个副本是有效编辑来源，再处理 behind 和 dirty。

### 5.5 OpenClaw Command Kit

```text
Path: /Users/fuyo-aic/Projects/openclaw-command-kit
Branch: main
Remote: https://github.com/veil-chow-fyaic/openclaw-command-kit.git
HEAD: 97901e6 docs: add command kit takeover brief
Working tree: dirty because of untracked docs/04-reference/migration-handoff-audit-2026-06-29.md
```

该未跟踪文档偏 Command Kit 迁移审计，不是 Bondie Dock 三仓主线；可作为 broader OpenClaw 交付参考。

### 5.6 OpenClaw Deep Research

```text
Path: /Users/fuyo-aic/Projects/openclaw-deep-research
Branch: master
Remote: https://github.com/veil-chow-fyaic/openclaw-deep-research.git
Status: ahead 4, dirty
```

包含 tracked `__pycache__` 变更、skill 脚本变更和 untracked `evals/`。若迁移范围包含 deep research skill，必须单独清理。

## 6. 交付优先级

### P0 - 不能丢

1. Bondie Dock 本分支 `feature/bondie-multi-instance-permissions` 是当前浏览器 Side Panel 主线，不是 README 里旧写的 main。
2. 交付时必须附上这份文档和 `docs/bondie-system-architecture.md`，否则三仓边界容易被误解。
3. `openclaw-session-bridge` 修复已落地 `b3bfcee`，迁移接手方应从 `fyaic/bondie-openclaw-session-bridge` 的 `main` 拉取。
4. `bondie-control-plane` private 远端已补齐，迁移接手方应确认 GitHub 账号权限后 clone。

### P1 - 迁移前应确认

1. 是否把 SynapseHub/Auth0 标准分发也纳入本次交付。如果纳入，先更新 `/Users/fuyo-aic/Projects/synapsehub` 到远端最新版并审计 DocFerry dirty worktree。
2. 是否把 Bondie runtime / WeCom extension 纳入本次交付。如果纳入，先处理 `/Users/fuyo-aic/Bondie` dirty worktree。
3. 是否把 ops docs 纳入交付。如果纳入，解决两个 `openclaw-ops-docs` 副本的来源冲突。

### P2 - 后续产品化

1. 接入生产 OAuth token provider，替代 Control Plane dev token。
2. 将 Control Plane 部署为稳定服务，补充真实 bridge registry 和 server-side secret store。
3. 建立标准设备分发流程：每台 OpenClaw/Bondie 设备部署 Session Bridge，Control Plane 只保存 secret reference，不向浏览器下发 bridge token。
4. 继续 Chrome manual gate，并补 Edge 近线验证。

## 7. 后续团队启动顺序

推荐顺序：

1. Clone/确认三个标准远端仓库可访问。
2. 在 Session Bridge 仓库运行测试，确认 `b3bfcee` 已包含在本地 `main`。
3. 在 Control Plane 仓库运行 `npm test && npm run check`。
4. 在 Control Plane 本地 `127.0.0.1:8790` 启动 dev 服务。
5. 在 Bondie Dock Options 中配置 Control Plane provider，验证 `/v1/bondie-instances` 和 Side Panel session list。
6. 再切 legacy direct Bridge 路径验证本机 `communication/subordinate` 两种权限。
7. 最后再接 OAuth/Auth0 文档，不要先改权限模型。

## 8. 禁止事项

- 不要把 `bondie-control-plane` 当作浏览器插件前端；它是服务侧聚合和权限控制面。
- 不要把 `openclaw-session-bridge` 的历史仓库名继续外传为标准名称；标准名称是 `bondie-openclaw-session-bridge`。
- 不要把 `/Users/fuyo-aic/Projects/Bondie` detached snapshot 当作 canonical main。
- 不要把 `/Users/fuyo-aic/Bondie` dirty worktree 和 `/Users/fuyo-aic/Projects/Bondie` clean snapshot 混淆。
- 不要恢复中间层 alias list。
- 不要让浏览器插件直接持有多 bridge token。
- 不要用 device pairing 替代 OAuth/user identity。
