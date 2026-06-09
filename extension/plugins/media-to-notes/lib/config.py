"""组件化配置 - 共享配置读取"""

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> None:
    """从候选位置加载 .env 文件"""
    candidates = [
        Path(__file__).resolve().parent.parent / ".env",
        Path.cwd() / ".env",
    ]
    seen: set = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        for raw_line in resolved.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()


@dataclass
class LLMConfig:
    """LLM 写作配置"""

    api_key: str = os.getenv("OPENAI_API_KEY", os.getenv("MEDIA_API_KEY", ""))
    base_url: str = os.getenv(
        "OPENAI_BASE_URL",
        os.getenv("MEDIA_API_BASE_URL", "https://118api.cn/v1"),
    )
    model: str = os.getenv(
        "OPENAI_MODEL",
        os.getenv("MEDIA_API_MODEL", "gemini-3-flash-preview"),
    )
    enabled: bool = bool(os.getenv("OPENAI_API_KEY") or os.getenv("MEDIA_API_KEY"))
    timeout: int = int(os.getenv("OPENAI_TIMEOUT", "45"))
    max_input_chars: int = int(os.getenv("OPENAI_MAX_INPUT_CHARS", "12000"))


llm_config = LLMConfig()
