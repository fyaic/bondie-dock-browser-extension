# Git Branch Consolidation Archive

日期：2026-06-09

## 目标

仓库只保留一条最新主线：`main`。

本次收口先归档旧分支，再把当前 `0.1.0-alpha.11` 浏览器插件成果推进到 `main`，最后删除历史 Liev 分支。

## 归档对象

| 对象 | 提交 | 归档 tag | 说明 |
| --- | --- | --- | --- |
| `main` / `origin/main` | `c74e5e6095490677ad8c4b83588dd1637de3cc00` | `archive/main-alpha7-20260609` | consolidation 前的旧 `main`，版本仍是 `0.1.0-alpha.7`。 |
| `origin/liev/aic-2587` | `96810f9ddbcfd9f807ce6a3257862125149d4b1d` | `archive/liev-aic-2587-20260609` | 早期 Pattern Memory MVP 分支，保留为历史证据。 |
| `liev/ai-handoff-browser-workflow-agent-20260525` | consolidation 当天最新提交 | `archive/liev-ai-handoff-alpha11-20260609` | `0.1.0-alpha.11` 主线来源，合入 `main` 前先打 tag。 |

## 保留策略

- 保留 `main` 作为唯一长期分支。
- 删除远端 `liev/aic-2587`。
- 删除远端 `liev/ai-handoff-browser-workflow-agent-20260525`。
- 删除本地 `liev/ai-handoff-browser-workflow-agent-20260525`。
- 不删除归档 tag。

## 当前有效主线

最终 `main` 应包含：

- `0.1.0-alpha.11` manifest 和 service worker entrypoint。
- Gateway protocol 4 / `node.presence.alive` 心跳。
- stale deviceToken 自动恢复。
- 页面智能服务主入口。
- `extension/plugins/media-to-notes` 内置能力模块。
- 通知 / 历史页 / TLDR / 产物路径展示。
- Pattern Memory 工程底座。
- 最新 README、WORKFLOW、安装、协议、手工测试和交接文档。

## 恢复方式

如果删除分支后需要追溯旧工作，使用 tag 查看：

```bash
git show archive/main-alpha7-20260609
git show archive/liev-aic-2587-20260609
git show archive/liev-ai-handoff-alpha11-20260609
```

如需临时恢复分支：

```bash
git switch -c restore/aic-2587 archive/liev-aic-2587-20260609
```
