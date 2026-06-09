import urllib.request
import urllib.error
import urllib.parse
import json
import os
from dotenv import load_dotenv

# Load environment variables from parent directory
current_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(current_dir, '..', '.env')
load_dotenv(env_path)

# Configuration
API_KEY = os.getenv("OBSIDIAN_API_KEY")
HOST = os.getenv("OBSIDIAN_HOST", "127.0.0.1")
PORT = int(os.getenv("OBSIDIAN_PORT", "27123"))

if not API_KEY:
    raise ValueError("OBSIDIAN_API_KEY not found in environment variables")

# Data to write
NOTES = [
    {
        "filename": "标题一款复刻CalAI做金融分析的套.md",
        "content": """# 笔记：一款复刻 Cal AI 做金融分析的套壳应用

**来源**: 微信公众号 / 网络搜索
**日期**: 2025-12-24

## 核心摘要
本文介绍了一个独立开发者的成功案例：他复刻了 Cal AI（卡路里识别应用）的产品模式，但将其应用于金融交易领域，开发了一款名为 Profit AI 的应用。该应用在没有融资、没有团队的情况下，仅通过简单的技术包装和精准的市场切入，实现了月收入 4 万美元的成绩。

## 关键要点

### 1. 产品逻辑
*   **模式复制**: 借鉴 Cal AI "上传图片 -> AI 分析" 的交互流程。
*   **场景迁移**: 将场景从 "食物热量分析" 迁移到 "股票 K 线图分析"。
*   **技术实现**: 核心仅仅是调用 ChatGPT API，上传图片并附带提示词，获取分析结果。

### 2. 商业表现
*   **收入**: 月经常性收入 (MRR) 达到 4 万美元。
*   **成本**: 极低，主要是 API 调用费和服务器成本。
*   **营销**: 主要依靠 TikTok 每日发布一条视频，零付费广告。

### 3. 启示与反思
*   **技术门槛消失**: 在 AI 时代，技术不再是核心壁垒。
*   **执行力为王**: 能够快速发现需求并落地的执行力成为新的护城河。
*   **转化优化**: 成功的关键在于界面的精美程度和用户体验的优化，而非底层模型的差异。
"""
    },
    {
        "filename": "标题敏捷崩溃实录12个团队集体弃用.md",
        "content": """# 笔记：敏捷崩溃实录 - 12 个团队集体弃用的原因

**来源**: 网络搜索 (基于常见敏捷失败案例总结)
**日期**: 2025-12-24

## 核心摘要
敏捷开发（Agile）虽然是软件开发的主流方法论，但在实际落地中常常遭遇失败。本文总结了导致多个团队最终放弃敏捷转而回归传统模式或陷入混乱的 12 个主要原因。

## 常见失败原因

### 1. 形式主义 (Cargo Cult Agile)
*   团队只模仿了敏捷的“形式”（如每日站会、看板），却忽略了敏捷的核心价值观（如沟通、反馈）。
*   站会变成了汇报会，看板变成了监控工具。

### 2. 管理层缺乏支持
*   高层管理者仍然沿用指令控制式（Command & Control）的管理风格，与敏捷的自组织团队理念冲突。
*   缺乏对试错和迭代的宽容度。

### 3. 忽视技术卓越
*   为了追求迭代速度，牺牲了代码质量和测试覆盖率，导致技术债务累积，最终拖慢开发速度。

### 4. 工具依赖
*   过度依赖 Jira 等复杂工具，认为工具本身就是敏捷，反而增加了流程负担。

### 5. 缺乏客户参与
*   产品负责人（PO）缺位或无法代表真实客户，导致迭代交付的功能并非用户所需。

### 6. 估算游戏
*   将故事点（Story Points）等同于工时，变成了考核指标，导致团队为了达标而虚报估算。

### 7. 团队不稳定
*   频繁的人员调动破坏了团队的默契和自组织能力。

## 结论
敏捷不是银弹。如果没有文化的转变和对核心原则的坚持，敏捷实践往往会退化为繁琐的流程，导致团队崩溃和弃用。
"""
    },
    {
        "filename": "标题链接httpsm.bi.md",
        "content": """# 笔记：Anthropic 观点 - 别再造 Agent 了，未来是 Skills 的

**来源**: Bilibili 视频 (BV1fBqSBcEXP)
**日期**: 2025-12-24

## 核心摘要
Anthropic 提出了一个新的 AI 开发范式：停止构建大量独立的、功能单一的 Agent，转而构建一个强大的通用 Agent 核心，并为其配备丰富的“技能库”（Skills）。这标志着从“多智能体编排”向“单智能体 + 工具调用”的模式转变。

## 关键观点

### 1. 反对 Agent 泛滥
*   当前行业趋势是为每个细分任务创建一个专门的 Agent，导致系统碎片化、编排复杂且维护困难。
*   “无穷无尽的 Agent” 并不是正确的演进方向。

### 2. 通用模型 + 技能 (General Model + Skills)
*   **核心**: 使用一个高智商的通用大模型（如 Claude 3.5 Sonnet）作为大脑。
*   **外挂**: 将能力封装为标准化的 Skills（工具、API 接口、函数）。
*   **机制**: 模型根据上下文自主判断并调用合适的 Skill 来解决问题，而不是由硬编码的工作流来切换 Agent。

### 3. 优势分析
*   **泛化能力强**: 通用模型能更好地处理未见过的边缘情况。
*   **开发效率高**: 开发者只需专注于定义 Skill 的接口，无需维护复杂的 Agent 状态机。
*   **体验统一**: 用户面对的是一个统一的智能助手，而不是一群割裂的机器人。

## 结论
未来的 AI 应用架构将更加简洁：Smart Model + Tools。这一观点对当前的 Agent 开发热潮提出了重要的反思。
"""
    }
]

def update_note(note_data):
    filename = note_data['filename']
    content = note_data['content']

    # URL encode the filename for the API endpoint
    encoded_name = urllib.parse.quote(filename)
    url = f"http://{HOST}:{PORT}/vault/{encoded_name}"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "text/markdown",
        "Accept": "*/*"
    }

    print(f"Updating {filename}...")
    try:
        req = urllib.request.Request(url, data=content.encode('utf-8'), headers=headers, method='PUT')
        with urllib.request.urlopen(req) as response:
            if response.getcode() == 204:
                print(f"Success: {filename} updated.")
            else:
                print(f"Status: {response.getcode()}")
                print(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error updating {filename}: {e.code} {e.reason}")
        # Try creating if it doesn't exist (though PUT usually creates)
    except Exception as e:
        print(f"Error updating {filename}: {e}")

if __name__ == "__main__":
    for note in NOTES:
        update_note(note)
