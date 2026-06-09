"""
Web-Fetch v2 配置管理
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


LOADED_ENV_FILES: list[Path] = []


def _iter_dotenv_candidates() -> list[Path]:
    root = Path(__file__).resolve()
    return [
        root.parents[3] / ".env",
        root.parents[3] / "workspace" / ".env",
        root.parents[2] / ".env",
        root.parents[1] / ".env",
        Path.cwd() / ".env",
    ]


def _load_dotenv() -> None:
    seen: set[Path] = set()
    candidates: list[Path] = []
    for candidate in _iter_dotenv_candidates():
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        candidates.append(resolved)
    for path in candidates:
        if not path.exists():
            continue
        LOADED_ENV_FILES.append(path)
        for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def _resolve_path(env_var: str, default: Path) -> Path:
    """从环境变量或默认值解析路径，支持 ~ 展开和相对路径"""
    value = os.getenv(env_var, "")
    if value:
        # 展开 ~ 为 home 目录
        if value.startswith("~"):
            value = str(Path.home()) + value[1:]
        path = Path(value)
    else:
        path = default
    # 如果是相对路径，相对于 skill 根目录
    if not path.is_absolute():
        skill_root = Path(__file__).resolve().parent.parent
        path = skill_root / path
    return path.expanduser().resolve()


_load_dotenv()


def get_loaded_env_files() -> list[str]:
    return [str(path) for path in LOADED_ENV_FILES]


def get_video_config_diagnostics() -> dict[str, object]:
    env_keys = {
        "MEDIA_API_KEY": bool(os.getenv("MEDIA_API_KEY")),
        "MEDIA_API_BASE_URL": bool(os.getenv("MEDIA_API_BASE_URL")),
        "MEDIA_API_MODEL": bool(os.getenv("MEDIA_API_MODEL")),
        "WEB_FETCH_VIDEO_VLM_API_KEY": bool(os.getenv("WEB_FETCH_VIDEO_VLM_API_KEY")),
        "WEB_FETCH_VIDEO_VLM_BASE_URL": bool(os.getenv("WEB_FETCH_VIDEO_VLM_BASE_URL")),
        "WEB_FETCH_VIDEO_VLM_MODEL": bool(os.getenv("WEB_FETCH_VIDEO_VLM_MODEL")),
        "DEEPGRAM_API_KEY": bool(os.getenv("DEEPGRAM_API_KEY")),
    }
    return {
        "loaded_env_files": get_loaded_env_files(),
        "env_keys": env_keys,
    }


@dataclass
class OutputConfig:
    """输出配置"""

    base_dir: Path = field(default_factory=lambda: _resolve_path(
        "WEB_FETCH_OUTPUT_DIR",
        Path.home() / "Documents" / "AIC-000" / "Web Clippings"
    ))
    vault_root: Path = field(default_factory=lambda: _resolve_path(
        "WEB_FETCH_VAULT_ROOT",
        Path.home() / "Documents" / "AIC-000"
    ))
    include_raw: bool = False
    raw_in_details: bool = False
    raw_html_comment: bool = False


@dataclass
class FetchConfig:
    """抓取配置"""

    timeout: int = 30
    wait_time: int = 3
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    retry_count: int = 2


@dataclass
class ImageConfig:
    """图片配置"""

    download: bool = True
    base_dir: Path = field(default_factory=lambda: _resolve_path(
        "WEB_FETCH_IMAGE_DIR",
        Path.home() / "Documents" / "AIC-000" / "图片集"
    ))
    max_size_mb: int = 10
    convert_webp: bool = False
    lazy_load_attrs: List[str] = field(
        default_factory=lambda: ["data-src", "data-original", "src", "data-lazy-src"]
    )
    skip_data_uri: bool = True


@dataclass
class ExtractionConfig:
    """内容提取配置"""

    default_engine: str = "readability"
    fallback: bool = True
    min_content_length: int = 100


@dataclass
class VideoConfig:
    """视频链路配置"""

    yt_dlp_command: str = os.getenv("WEB_FETCH_YT_DLP", "yt-dlp")
    ffmpeg_command: str = os.getenv("WEB_FETCH_FFMPEG", "ffmpeg")
    temp_dir_name: str = "web-fetch-video"
    temp_root: Path = field(default_factory=lambda: _resolve_path(
        "WEB_FETCH_VIDEO_TEMP_ROOT",
        Path.home() / ".cache" / "web-fetch-video"
    ))
    audio_format: str = "mp3"
    vlm_api_key: str = os.getenv("WEB_FETCH_VIDEO_VLM_API_KEY", os.getenv("MEDIA_API_KEY", ""))
    vlm_base_url: str = os.getenv(
        "WEB_FETCH_VIDEO_VLM_BASE_URL",
        os.getenv("MEDIA_API_BASE_URL", "https://118api.cn/v1"),
    )
    vlm_model: str = os.getenv(
        "WEB_FETCH_VIDEO_VLM_MODEL",
        os.getenv("MEDIA_API_MODEL", "gemini-3-flash-preview"),
    )
    vlm_timeout: int = int(os.getenv("WEB_FETCH_VIDEO_VLM_TIMEOUT", "120"))
    vlm_chunk_target_size_mb: int = int(os.getenv("WEB_FETCH_VIDEO_VLM_CHUNK_TARGET_MB", "24"))
    vlm_chunk_min_seconds: int = int(os.getenv("WEB_FETCH_VIDEO_VLM_CHUNK_MIN_SECONDS", "90"))
    vlm_chunk_max_seconds: int = int(os.getenv("WEB_FETCH_VIDEO_VLM_CHUNK_MAX_SECONDS", "480"))
    # 视频下载限制（默认 0 表示无限制）
    max_video_duration_seconds: int = int(os.getenv("WEB_FETCH_MAX_VIDEO_DURATION_SECONDS", "0"))
    max_video_size_mb: int = int(os.getenv("WEB_FETCH_MAX_VIDEO_SIZE_MB", "0"))
    # 以下配置已弃用（不再手动抽帧）
    max_frames: int = int(os.getenv("WEB_FETCH_VIDEO_MAX_FRAMES", "6"))  # 保留兼容
    metadata_timeout: int = int(os.getenv("WEB_FETCH_VIDEO_METADATA_TIMEOUT", "300"))
    download_timeout: int = int(os.getenv("WEB_FETCH_VIDEO_DOWNLOAD_TIMEOUT", "1800"))
    ffmpeg_timeout: int = int(os.getenv("WEB_FETCH_VIDEO_FFMPEG_TIMEOUT", "600"))
    metadata_retries: int = int(os.getenv("WEB_FETCH_VIDEO_METADATA_RETRIES", "2"))
    network_mode: str = os.getenv("WEB_FETCH_VIDEO_NETWORK_MODE", "direct").strip().lower()
    yt_dlp_shell: str = os.getenv("WEB_FETCH_YT_DLP_SHELL", "git_bash").strip().lower()
    deepgram_api_key: str = os.getenv("DEEPGRAM_API_KEY", "")
    deepgram_model: str = os.getenv("WEB_FETCH_DEEPGRAM_MODEL", "nova-2")
    deepgram_language: str = os.getenv("WEB_FETCH_DEEPGRAM_LANGUAGE", "zh")
    deepgram_timeout: int = int(os.getenv("WEB_FETCH_DEEPGRAM_TIMEOUT", "120"))


@dataclass
class GitHubConfig:
    """GitHub 采集配置"""

    api_base_url: str = os.getenv("WEB_FETCH_GITHUB_API", "https://api.github.com")
    token: str = os.getenv("GITHUB_TOKEN", "")
    timeout: int = int(os.getenv("WEB_FETCH_GITHUB_TIMEOUT", "20"))


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


SITE_SELECTORS = {
    "wechat": {
        "domain": "mp.weixin.qq.com",
        "content": "#js_content",
        "title": "#activity_name",
        "author": "#js_name",
        "date": "#publish_time",
    },
    "zhihu": {
        "domain": "zhuanlan.zhihu.com",
        "content": ".RichContent-inner, .Post-RichTextContainer",
        "title": "h1",
        "author": ".AuthorInfo-name",
    },
    "zhihu_answer": {
        "domain": "www.zhihu.com/question",
        "content": ".RichContent-inner",
        "title": "h1",
        "author": ".AuthorInfo-name",
    },
    "juejin": {
        "domain": "juejin.cn",
        "content": ".article-content",
        "title": "h1",
        "author": ".username",
    },
    "medium": {
        "domain": "medium.com",
        "content": "article",
        "title": "h1",
        "author": '[data-testid="authorName"]',
    },
    "substack": {
        "domain": ".substack.com",
        "content": ".available-content, .post-content",
        "title": "h1",
        "author": ".subscriber-journey",
    },
}


class Config:
    """统一配置类"""

    def __init__(self):
        self.output = OutputConfig()
        self.fetch = FetchConfig()
        self.images = ImageConfig()
        self.extraction = ExtractionConfig()
        self.video = VideoConfig()
        self.github = GitHubConfig()
        self.llm = LLMConfig()
        self.sites = SITE_SELECTORS

    def detect_site(self, url: str) -> Optional[str]:
        """检测网站类型"""

        url_lower = url.lower()
        for site_type, site_config in self.sites.items():
            if site_config["domain"] in url_lower:
                return site_type
        return None


config = Config()
