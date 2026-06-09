# 🤖 视频转笔记自动化工作流 (Video-to-Note Protocol)

> **版本**: 1.0
> **最后更新**: 2025-12-23
> **适用场景**: Bilibili/YouTube 视频 -> 语音转写 -> 智能总结 -> Obsidian 知识库同步

## 1. 核心流程 (Core Workflow)

### 第一阶段：采集 (Ingestion)
*   **输入**: 视频链接 (URL)。
*   **工具**: `yt-dlp`。
*   **操作**:
    *   提取最佳音频格式 (`m4a` 优先)。
    *   命名规范: `video_raw.m4a` (临时文件)。

### 第二阶段：智能处理 (Intelligence)
*   **工具**: `Deepgram MCP` + `run_transcribe.py`。
*   **配置**:
    *   Model: `nova-2`。
    *   Language: `zh` (强制中文，避免混合语种识别为空) 或 `auto`。
    *   Features: `smart_format`, `diarize`, `punctuate`。
*   **产出**:
    *   原始逐字稿 (`transcript.txt`)。
    *   **结构化笔记** (Markdown): 包含来源、痛点、解决方案、核心价值。

### 第三阶段：归档与集成 (Integration) - **重点规则**
 (The "Orphan" Rule)
在创建新文件之前，**必须**执行以下检查：

1.  **搜索目标**: 扫描 Obsidian 仓库 (`AIC-000`)。
2.  **优先级策略**:
    *   **第一优先级 (Orphan Check)**: 检查 **根目录**。
        *   *特征*: 未归类文件、空文件、仅有标题的草稿 (Stubs)。
        *   *逻辑*: "这些通常是用户随手记下但未完成的想法"。
    *   **第二优先级 (Topic Check)**: 检查 `AI News` 等主题文件夹。
3.  **决策分支**:
    *   **命中根目录孤儿文件**:
        *   👉 **询问用户**: "发现根目录存在相关草稿 `[文件名.md]`，是否将内容合并进去？"
        *   👉 **执行合并**: 将新生成的笔记追加 (Append) 到该文件末尾。
        *   *(可选建议)*: 询问是否将其移动到正确的主题文件夹。
    *   **未命中**:
        *   👉 **新建归档**: 直接将笔记同步到 `AI News/智能体架构` (或指定目录)。

## 2. 脚本工具箱 (Toolbox)
*   `run_transcribe.py`: 执行音频转写。
*   `find_note.py`: 扫描 Vault 寻找关键词匹配的现有笔记。
*   `merge_notes.py`: 执行内容追加合并。
*   `sync_obsidian.py`: 执行新文件同步。

---
*Created by Trae via Pair Programming Session*
