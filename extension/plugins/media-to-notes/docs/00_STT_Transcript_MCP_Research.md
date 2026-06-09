# STT / 音视频转写 MCP 解决方案深度调研

## 1. 概述
本此调研针对 Model Context Protocol (MCP) 生态中的语音转文字 (STT) 和音视频转写解决方案。我们深入搜索了开源社区（GitHub）、MCP 注册表（Smithery/Glama）以及相关的技术实现。

目前的解决方案主要分为两大类：
1. **本地模型方案 (Local Models):** 依赖 `whisper.cpp` 或 `faster-whisper`，完全免费，隐私性强，但对本地硬件（CPU/GPU/内存）有一定要求。
2. **云端 API 方案 (Cloud APIs):** 依赖 Deepgram、OpenAI 等服务商，精度极高，无需本地算力，适合处理长音频，但需要支付 API 费用。

---

## 2. 推荐解决方案列表

### 2.1 本地隐私优先方案 (Local/Privacy-First)

#### **A. local-stt-mcp (推荐 Mac 用户)**
*   **仓库:** [https://github.com/SmartLittleApps/local-stt-mcp](https://github.com/SmartLittleApps/local-stt-mcp)
*   **核心技术:** `whisper.cpp` (C++ port of OpenAI Whisper)
*   **特点:**
    *   **100% 本地运行:** 无需联网，数据不出设备。
    *   **Apple Silicon 优化:** 在 M1/M2/M3 芯片上速度极快（声称比实时快 15 倍）。
    *   **功能:** 支持说话人分离 (Speaker Diarization)、多种音频格式转换 (通过 ffmpeg)。
*   **适用场景:** 拥有 Mac 电脑，对隐私要求极高，希望免费使用的用户。
*   **配置示例:**
    ```json
    "whisper-mcp": {
      "command": "node",
      "args": ["path/to/local-stt-mcp/mcp-server/dist/index.js"]
    }
    ```

#### **B. Speech MCP (by Kvadratni)**
*   **仓库:** [https://github.com/Kvadratni/speech-mcp](https://github.com/Kvadratni/speech-mcp)
*   **核心技术:** `faster-whisper` (Python) + `Kokoro TTS`
*   **特点:**
    *   **双向交互:** 不仅支持 STT，还支持高质量 TTS (文字转语音)，可用于构建语音交互 Agent。
    *   **可视化:** 提供基于 PyQt 的音频波形可视化界面。
    *   **依赖:** 需要安装 PortAudio。
*   **适用场景:** 需要语音对话交互，或者在 Windows/Linux 上寻求比 whisper.cpp 更易配置的 Python 方案。

#### **C. Fast-Whisper-MCP-Server**
*   **仓库:** [https://github.com/BigUncle/Fast-Whisper-MCP-Server](https://github.com/BigUncle/Fast-Whisper-MCP-Server)
*   **核心技术:** `faster-whisper`
*   **特点:** 轻量级 Python 实现，专注于快速转写。
*   **适用场景:** 通用 PC 用户，熟悉 Python 环境。

---

### 2.2 云端 API 方案 (High Performance/Cloud)

#### **D. Deepgram MCP Server**
*   **仓库:** [https://github.com/ctaylor86/deepgram-mcp-server](https://github.com/ctaylor86/deepgram-mcp-server)
*   **核心技术:** Deepgram API
*   **特点:**
    *   **异步处理:** 解决了 MCP 连接通常有的超时限制（Claude 默认 10-60秒超时），适合转写 **长视频/长播客**。
    *   **高精度:** Deepgram 的 Nova 模型通常比标准 Whisper 更快且精度相当。
    *   **多功能:** 支持情感分析、摘要、话题检测。
*   **适用场景:** 需要转写 1小时以上的长会议录音，或者本地电脑性能较弱的用户。

#### **E. Audio Transcriber MCP**
*   **仓库:** [https://github.com/ichigo3766/audio-transcriber-mcp](https://github.com/ichigo3766/audio-transcriber-mcp)
*   **核心技术:** OpenAI Whisper API
*   **特点:** 标准的 OpenAI 接口封装。
*   **适用场景:** 已经有 OpenAI Key，不想折腾其他账号的用户。

---

## 3. 综合集成方案

#### **F. Ultimate MCP Server**
*   **仓库:** [https://github.com/Dicklesworthstone/ultimate_mcp_server](https://github.com/Dicklesworthstone/ultimate_mcp_server)
*   **特点:** 这是一个 "全家桶" 类型的 MCP 服务器，集成了 STT、网页浏览、SQL 数据库、Excel 处理等几十种工具。
*   **评价:** 如果你不仅需要转写，还需要 Agent 进行其他复杂操作，可以使用此方案。但如果只需转写，可能略显臃肿。

---

## 4. 个人使用推荐 (针对 音频/视频 输入)

针对您提出的 **"个人使用、不需企业级、录音/视频输入"** 的需求，我为您分析并推荐以下两个最佳路径。

### 核心考量点
1.  **视频支持:** 原生 Whisper 模型通常只接受音频文件。要支持视频（MP4/MOV等），必须在处理前从视频中提取音频。
    *   `local-stt-mcp` 明确集成了 `ffmpeg` 自动转换功能，体验最好。
    *   `Deepgram` API 端原生支持多种视频格式上传，最为省心。
2.  **个人成本:**
    *   **本地方案:** 免费，但吃电脑性能。
    *   **Deepgram:** 虽然是付费服务，但提供 **$200 的新用户免费额度**，且单价极低（每小时约 $0.26），对于个人用户来说几乎等同于免费。

### 推荐方案 A：如果不排斥少量付费/注册 —— **Deepgram MCP** (首选)
*   **推荐理由:**
    *   **视频友好:** 直接丢进去视频文件也能识别（Deepgram 服务器端解码），省去了本地安装 `ffmpeg` 的麻烦。
    *   **不占资源:** 视频转写非常耗 CPU/内存，交给云端处理可以让您的电脑不卡顿。
    *   **速度极快:** 云端集群处理，1小时的视频可能只需要几分钟。
    *   **长音频支持:** 专门针对长录音优化，不会因为超时而失败。
*   **操作:**
    1.  去 Deepgram 官网注册账号拿到 Key。
    2.  安装 `ctaylor86/deepgram-mcp-server`。

### 推荐方案 B：如果拥有 Mac 且希望完全免费 —— **local-stt-mcp**
*   **推荐理由:**
    *   **隐私:** 您的私人录音/视频完全不出电脑。
    *   **内置转换:** 只要您安装了 `ffmpeg` (一条命令 `brew install ffmpeg`)，它就能自动把视频里的声音提取出来转写。
    *   **性能:** 利用 Apple Silicon 的神经引擎，不怎么发热。
*   **操作:**
    1.  安装 `ffmpeg`。
    2.  Clone 并运行 `SmartLittleApps/local-stt-mcp`。

### 推荐方案 C：如果是 Windows/Linux 且希望免费 —— **Speech MCP**
*   **推荐理由:**
    *   **Python 生态:** 比起 Node.js/C++，在 Windows 上 Python 环境更容易配置（特别是 CUDA 显卡加速）。
    *   **可视化:** 有界面可以看到波形，体验较好。
*   **注意:** Windows 上处理视频可能需要手动用工具先把视频转成 mp3/wav，或者确认该 MCP 是否内置了 ffmpeg 调用。

---

## 5. 工作流集成分析 (Agent Workflow)

针对您的需求：**"给 Agent 一个链接/文件 -> Agent 调用 MCP -> 获取文字稿 -> 后续工作流"**。

以下是方案 1 (Deepgram) 和方案 3 (Speech MCP) 的具体支持情况对比：

### 5.1 Deepgram MCP (云端方案)
*   **是否支持 URL 链接:** **完美支持**。
    *   Deepgram 的 API 原生设计就是接受 URL。您只需在对话框发一个音频/视频链接，Agent 调用工具 `transcribe_url(url="...")`，Deepgram 服务器会自动去下载并转写。
*   **是否支持本地文件:** 支持。Agent 需要先读取文件二进制流，或者通过 MCP 的文件上传接口。
*   **工作流体验:** **最流畅**。特别是对于网络上的播客、会议录音链接，无需 Agent 先下载到本地再处理，一步到位。

### 5.2 Speech MCP / Local STT (本地方案)
*   **是否支持 URL 链接:** **间接支持 (需要 Agent 介入)**。
    *   大多数本地 MCP (包括 `local-stt-mcp`) 的 `transcribe` 工具参数通常是 `file_path`。
    *   **流程:** 您给链接 -> Agent (Trae) **先调用网络工具下载文件**到本地临时目录 -> Agent 调用 MCP `transcribe(file_path="...")` -> 获取结果。
    *   **结论:** 也可以实现，但比 Deepgram 多了一个"下载"步骤。
*   **是否支持本地文件:** **完美支持**。直接给路径即可。

### 总结建议
如果您经常需要处理 **URL 链接** (如在线会议录音、播客链接)，**Deepgram MCP** 体验会更丝滑，因为它把"下载+转码+转写"全包了。如果您主要处理 **本地录好的文件**，两者体验差异不大。

---

## 6. 选型建议表

| 需求场景 | 推荐方案 | 硬件要求 | 成本 | 复杂度 |
| :--- | :--- | :--- | :--- | :--- |
| **Mac 用户 / 极致隐私** | `local-stt-mcp` | M1/M2/M3 芯片最佳 | 免费 | 中 (需 Node.js) |
| **Windows 用户 / 离线** | `Fast-Whisper-MCP` | NVIDIA 显卡推荐 | 免费 | 中 (需 Python/CUDA) |
| **长视频 / 会议记录** | `Deepgram MCP` | 无 (云端处理) | 付费 (API) | 低 (需 API Key) |
| **全能型 Agent 开发** | `Ultimate MCP` | 取决于具体模块 | 混合 | 高 |

---

## 7. 下一步建议

如果您希望开始尝试，建议从以下路径入手：

1.  **如果您是 Mac 用户:** 请尝试部署 `local-stt-mcp`，体验极速本地转写。
2.  **如果您需要处理长视频:** 建议申请一个 Deepgram Key (通常有免费额度)，部署 `Deepgram MCP`。

---

## 8. 安装与配置指南 (Deepgram MCP - Simplified)

根据您的选择，我们采用了 **Deepgram MCP** 方案，并精选了配置更为简洁的 `reddheeraj/deepgram-mcp` 版本（相比原方案无需部署 Cloudflare Worker，更适合个人使用）。

### 8.1 安装状态
*   **仓库:** `reddheeraj/deepgram-mcp` (已 Clone 到本地 `音视频MCP/reddheeraj-deepgram-mcp`)
*   **依赖:** 已安装 (`npm install`)
*   **构建:** 已完成 (`npm run build`)

### 8.2 配置步骤
1.  **获取 API Key:**
    *   访问 [Deepgram Console](https://console.deepgram.com/) 注册并创建一个 API Key。
    *   新用户通常有 $200 的免费额度。
2.  **设置环境变量:**
    *   在 `音视频MCP/reddheeraj-deepgram-mcp` 目录下找到 `.env` 文件。
    *   填入您的 Key: `DEEPGRAM_API_KEY=您的key粘贴在这里`
3.  **在 Trae/IDE 中配置 MCP:**
    *   请将以下 JSON 配置添加到您的 MCP 配置文件中 (通常在 Settings -> MCP 或 `claude_desktop_config.json`)：

    ```json
    {
      "mcpServers": {
        "deepgram": {
          "command": "node",
          "args": [
            "c:/Users/ryshi/.trae/research-test/音视频MCP/reddheeraj-deepgram-mcp/dist/index.js",
            "--stdio"
          ]
        }
      }
    }
    ```
    *(提示：由于代码中会加载本地 `.env` 文件，请确保您在步骤 2 中填好了 Key。如果 IDE 无法读取该目录的 .env，您也可以直接在 JSON 中添加 `"env": { "DEEPGRAM_API_KEY": "sk-..." }` 字段)*

### 8.3 使用方法
*   **输入:** 该 MCP 支持 `transcribe_audio` 工具，接受 `audioUrl` (链接) 或 `audioData` (Base64)。
*   **示例:** 直接对 Agent 说 "帮我把这个视频链接转成文字：https://example.com/video.mp4"
