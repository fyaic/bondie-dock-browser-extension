"""
视频采集与理解链路。

架构原则：
1. 优先 Gemini+Deepgram 音视频双轨处理
2. 除非完全无法获取视频，才 fallback 到纯音频
3. 不手动抽帧 - 直接传视频给 Gemini 自动处理

调用追踪：
- 通过 WEB_FETCH_INVOCATION_ID 环境变量追踪每次调用
- 防止重复执行和便于调试
"""

import base64
import json
import mimetypes
import os
import secrets
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import requests

from config import config, get_video_config_diagnostics
from models import ContentAsset

PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)

YOUTUBE_HOST_MARKERS = (
    "youtube.com",
    "youtu.be",
)

GIT_BASH_CANDIDATES = (
    Path("D:/Git/bin/bash.exe"),
    Path("D:/Git/usr/bin/bash.exe"),
    Path("C:/Program Files/Git/bin/bash.exe"),
    Path("C:/Program Files/Git/usr/bin/bash.exe"),
)


def fetch_video_asset(url: str, output_dir: Path) -> tuple[ContentAsset, dict[str, Any]]:
    """
    音视频双轨处理流程：
    1. 优先同时获取视频（Gemini 视觉分析）+ 音频（Deepgram 转写）
    2. 如果视频完全无法获取，fallback 到纯音频
    """
    import os
    invocation_id = os.getenv("WEB_FETCH_INVOCATION_ID", "unknown")
    print(f"[video_pipeline] 开始处理: invocation_id={invocation_id}, url={url}", file=sys.stderr)

    yt_dlp_path = shutil.which(config.video.yt_dlp_command)
    if not yt_dlp_path:
        raise RuntimeError("未找到 yt-dlp，可通过 WEB_FETCH_YT_DLP 指定命令路径")

    output_dir.mkdir(parents=True, exist_ok=True)
    temp_root = config.video.temp_root
    temp_root.mkdir(parents=True, exist_ok=True)
    temp_path = temp_root / f"job-{secrets.token_hex(4)}"
    temp_path.mkdir(parents=True, exist_ok=True)

    video_path: Path | None = None
    audio_path: Path | None = None

    try:
        # 1. 获取元数据
        metadata = _extract_video_metadata(yt_dlp_path, url)

        warnings: list[str] = []
        body_markdown = ""
        summary_source = ""
        transcript = ""

        # 2. 双轨下载：同时尝试获取视频和音频
        if _visual_api_ready():
            try:
                video_path = _download_video(yt_dlp_path, url, temp_path)
            except Exception as exc:
                warnings.append(f"视频下载失败: {exc}")

        # 音频始终尝试获取（作为 fallback 或补充）
        if config.video.deepgram_api_key:
            try:
                audio_path = _download_audio(yt_dlp_path, url, temp_path)
            except Exception as exc:
                if not video_path:
                    # 如果连音频也拿不到，才报错
                    raise RuntimeError(f"无法获取视频或音频: {exc}")
                warnings.append(f"音频下载失败（将只用视频分析）: {exc}")

        # 3. 双轨处理
        vision_result = ""
        transcript_result = ""

        # 3.1 视觉分析（Gemini）
        if video_path and _visual_api_ready():
            try:
                vision_result = _analyze_video_with_vlm(metadata, video_path)
                summary_source = "video_vision"
            except Exception as exc:
                warnings.append(f"视觉分析失败: {exc}")

        # 3.2 音频转写（Deepgram）
        if audio_path and config.video.deepgram_api_key:
            try:
                transcript_result = _transcribe_audio(audio_path)
                transcript = transcript_result
                if not summary_source:
                    summary_source = "transcript"
            except Exception as exc:
                warnings.append(f"音频转写失败: {exc}")

        # 4. 合并结果
        if vision_result and transcript_result:
            # 双轨都有结果，合并
            body_markdown = _merge_vision_and_transcript(metadata, vision_result, transcript_result)
            summary_source = "video_vision+transcript"
        elif vision_result:
            # 只有视觉
            body_markdown = vision_result
            if warnings:
                body_markdown += f"\n\n> 注：{'；'.join(warnings)}"
        elif transcript_result:
            # 只有音频
            body_markdown = _build_transcript_markdown(metadata, transcript_result)
        else:
            # 都失败了
            raise RuntimeError(f"视觉和音频处理均失败: {'；'.join(warnings)}")
    finally:
        _cleanup_temp_dir(temp_path)

    title = metadata.get("title") or metadata.get("webpage_url") or url
    asset = ContentAsset(
        source_url=url,
        resolved_url=metadata.get("webpage_url") or url,
        content_type="video",
        source_platform=metadata.get("extractor_key") or metadata.get("extractor") or "视频平台",
        title=title,
        author=metadata.get("uploader", ""),
        published_at=_normalize_upload_date(metadata.get("upload_date", "")),
        body_markdown=body_markdown,
        transcript=transcript,
        metadata={
            "duration": metadata.get("duration"),
            "view_count": metadata.get("view_count"),
            "like_count": metadata.get("like_count"),
            "comment_count": metadata.get("comment_count"),
            "channel": metadata.get("channel"),
            "tags": metadata.get("tags") or [],
            "description": metadata.get("description", ""),
        },
        canonical_id=str(metadata.get("id", "")),
        source_kind="video",
        summary_source=summary_source,
        attachments=[],
        extra_context={
            "video_metadata": {
                "duration": metadata.get("duration"),
                "channel": metadata.get("channel"),
                "view_count": metadata.get("view_count"),
                "like_count": metadata.get("like_count"),
                "comment_count": metadata.get("comment_count"),
                "uploader_id": metadata.get("uploader_id"),
                "tags": metadata.get("tags") or [],
                "description": metadata.get("description", ""),
            }
        },
    )
    return asset, {
        "fetcher_type": "video-vision+deepgram" if summary_source == "video_vision+transcript" else ("video-vision" if summary_source == "video_vision" else "yt-dlp+deepgram"),
        "word_count": len((transcript or body_markdown)),
        "images_count": 0,
        "warnings": warnings,
        "image_status": "not_supported",
    }


def _extract_video_metadata(yt_dlp_path: str, url: str) -> dict[str, Any]:
    command = [
        yt_dlp_path,
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--extractor-retries",
        str(config.video.metadata_retries),
        "--socket-timeout",
        "30",
        url,
    ]
    last_error = ""
    for env in _iter_yt_dlp_envs(url):
        for _ in range(max(config.video.metadata_retries, 1)):
            try:
                completed = _run_yt_dlp_command(
                    command,
                    url=url,
                    env=env,
                    timeout=config.video.metadata_timeout,
                )
            except subprocess.TimeoutExpired as exc:
                last_error = f"yt-dlp 元数据提取超时: {exc}"
                continue
            if completed.returncode == 0:
                return json.loads(completed.stdout)
            last_error = completed.stderr.strip() or completed.stdout.strip()
    raise RuntimeError(last_error or "yt-dlp 元数据提取失败")


def _download_video(yt_dlp_path: str, url: str, temp_path: Path) -> Path:
    """下载完整视频文件，优先拿到任何可供视觉模型消费的本地视频。"""
    output_template = str(temp_path / "video.%(ext)s")
    base_command = [
        yt_dlp_path,
        "--no-playlist",
        "-o", output_template,
    ]

    max_duration = getattr(config.video, "max_video_duration_seconds", None)
    if max_duration and max_duration > 0:
        base_command.extend(["--download-sections", f"*0-{max_duration}"])

    attempts = [
        [
            *base_command,
            "-f", "bv*+ba/b",
            "--merge-output-format", "mp4",
            url,
        ],
        [
            *base_command,
            "-f", "bestvideo*+bestaudio/best",
            "--merge-output-format", "mp4",
            url,
        ],
        [
            *base_command,
            "-f", "best",
            url,
        ],
    ]

    return _download_with_fallbacks(
        attempts=attempts,
        url=url,
        temp_path=temp_path,
        stem="video",
        timeout=config.video.download_timeout,
        failure_message="视频下载失败",
    )


def _visual_api_ready() -> bool:
    return bool(config.video.vlm_api_key and config.video.vlm_base_url and config.video.vlm_model)


def _analyze_video_with_vlm(metadata: dict[str, Any], video_path: Path) -> str:
    """
    直接传视频文件给 Gemini 分析（不手动抽帧）
    """
    file_size_bytes = video_path.stat().st_size
    max_size_mb = getattr(config.video, "max_video_size_mb", 0)
    if max_size_mb and max_size_mb > 0 and file_size_bytes > max_size_mb * 1024 * 1024:
        raise RuntimeError(f"视频文件过大 ({file_size_bytes/1024/1024:.1f}MB > {max_size_mb}MB)")

    chunk_target_bytes = max(getattr(config.video, "vlm_chunk_target_size_mb", 24), 1) * 1024 * 1024
    if file_size_bytes <= chunk_target_bytes:
        text = _analyze_video_blob_with_vlm(
            metadata=metadata,
            video_path=video_path,
            prompt=_build_vlm_prompt(metadata),
        )
        return _wrap_vision_markdown(metadata, text)

    chunk_paths = _split_video_for_vlm(metadata, video_path, chunk_target_bytes)
    chunk_texts: list[str] = []
    for index, chunk_path in enumerate(chunk_paths, 1):
        prompt = _build_vlm_prompt(metadata, chunk_index=index, chunk_total=len(chunk_paths))
        chunk_text = _analyze_video_blob_with_vlm(
            metadata=metadata,
            video_path=chunk_path,
            prompt=prompt,
        )
        chunk_texts.append(chunk_text)
    return _wrap_chunked_vision_markdown(metadata, chunk_texts)


def _analyze_video_blob_with_vlm(metadata: dict[str, Any], video_path: Path, prompt: str) -> str:
    with open(video_path, "rb") as f:
        video_bytes = f.read()

    encoded = base64.b64encode(video_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{encoded}"

    content: list[dict[str, Any]] = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]

    payload = {
        "model": config.video.vlm_model,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": content}],
    }

    response = _post_json(
        f"{config.video.vlm_base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {config.video.vlm_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=config.video.vlm_timeout,
    )

    if response.status_code >= 400:
        body = response.text.strip()
        snippet = body[:300] if body else ""
        raise RuntimeError(
            f"视觉模型接口调用失败: HTTP {response.status_code}"
            + (f"，响应片段: {snippet}" if snippet else "")
        )

    data = response.json()
    message = data["choices"][0]["message"]["content"]
    if isinstance(message, list):
        text = "\n".join(item.get("text", "") for item in message if isinstance(item, dict))
    else:
        text = str(message)
    text = text.strip()
    if not text:
        raise RuntimeError("视觉视频解析未返回有效内容")
    return text


def _build_vlm_prompt(metadata: dict[str, Any], chunk_index: int | None = None, chunk_total: int | None = None) -> str:
    description = (metadata.get("description") or "").strip()
    tags = ", ".join(metadata.get("tags") or [])
    chunk_hint = ""
    if chunk_index is not None and chunk_total is not None:
        chunk_hint = (
            f"当前处理的是第 {chunk_index}/{chunk_total} 个视频片段。"
            "请只忠实描述当前片段看到和听到的内容，不要臆测未出现的片段。"
        )
    return (
        "请根据这个视频，整理一份中文 Markdown 知识笔记草稿。"
        "目标不是描述画面好看不好看，而是判断这是什么内容，以及它与标题中提到的产品到底是什么关系。"
        "你必须优先判断：这是项目本体介绍、第三方案例演示、蹭热点广告、教程，还是单纯资讯。"
        "如果视频简介、标签、UP 主身份里出现试用链接、GitHub/Gitee、客服微信、品牌导流等信号，要明确指出这是推广或广告，不要误写成标题里的项目本体。"
        "如果是产品演示视频，优先提炼产品定位、主要功能、工作流、用户价值，以及它与被蹭热点对象的真实关系。"
        "输出结构必须包含：\n"
        "## 视频摘要\n"
        "## 关键信号\n"
        "## 详细观察\n"
        "## 适用场景\n"
        "## 需要确认\n\n"
        f"标题：{metadata.get('title') or '未知'}\n"
        f"作者：{metadata.get('uploader') or '未知'}\n"
        f"平台：{metadata.get('extractor_key') or metadata.get('extractor') or '未知'}\n"
        f"时长：{_format_duration(metadata.get('duration'))}\n"
        f"播放：{metadata.get('view_count')}\n"
        f"点赞：{metadata.get('like_count')}\n"
        f"评论：{metadata.get('comment_count')}\n"
        f"标签：{tags or '无'}\n"
        f"简介：{description or '无'}\n"
        f"原链接：{metadata.get('webpage_url') or ''}\n"
        f"{chunk_hint}\n"
    )


def _wrap_vision_markdown(metadata: dict[str, Any], text: str) -> str:
    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 发布时间: {_normalize_upload_date(metadata.get('upload_date', '')) or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 播放: {metadata.get('view_count') or '未知'}",
        f"- 点赞: {metadata.get('like_count') or '未知'}",
        f"- 评论: {metadata.get('comment_count') or '未知'}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
    ]
    tags = metadata.get("tags") or []
    if tags:
        lines.append(f"- 标签: {', '.join(tags)}")
    description = (metadata.get("description") or "").strip()
    if description:
        lines.extend(["", "## 视频简介", "", description])
    lines.extend(["", "## 视觉解析", "", text])
    return "\n".join(lines).strip() + "\n"


def _wrap_chunked_vision_markdown(metadata: dict[str, Any], chunk_texts: list[str]) -> str:
    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 发布时间: {_normalize_upload_date(metadata.get('upload_date', '')) or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 播放: {metadata.get('view_count') or '未知'}",
        f"- 点赞: {metadata.get('like_count') or '未知'}",
        f"- 评论: {metadata.get('comment_count') or '未知'}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
        "",
        "## 视觉解析",
        "",
        f"> 注：视频已按片段顺序解析，共 {len(chunk_texts)} 段，以避免大文件上传导致内存爆炸。",
    ]
    for index, chunk_text in enumerate(chunk_texts, 1):
        lines.extend(["", f"### 片段 {index}", "", chunk_text.strip()])
    return "\n".join(lines).strip() + "\n"


def _merge_vision_and_transcript(metadata: dict[str, Any], vision_text: str, transcript: str) -> str:
    """合并视觉分析和音频转写结果"""
    # 提取视觉解析部分
    vision_content = vision_text
    if "## 视觉解析" in vision_text:
        vision_content = vision_text.split("## 视觉解析")[1].strip()

    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 发布时间: {_normalize_upload_date(metadata.get('upload_date', '')) or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 播放: {metadata.get('view_count') or '未知'}",
        f"- 点赞: {metadata.get('like_count') or '未知'}",
        f"- 评论: {metadata.get('comment_count') or '未知'}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
    ]
    tags = metadata.get("tags") or []
    if tags:
        lines.append(f"- 标签: {', '.join(tags)}")
    description = (metadata.get("description") or "").strip()
    if description:
        lines.extend(["", "## 视频简介", "", description])

    lines.extend([
        "",
        "## 视觉解析（Gemini）",
        "",
        vision_content,
        "",
        "## 音频转写（Deepgram）",
        "",
        transcript.strip(),
        "",
        "## 综合理解",
        "",
        "*本笔记结合了视频画面分析和音频转写，如两者有冲突请以画面为准。*",
    ])
    return "\n".join(lines).strip() + "\n"


def _download_audio(yt_dlp_path: str, url: str, temp_path: Path) -> Path:
    output_template = str(temp_path / "audio.%(ext)s")
    attempts = [
        [
            yt_dlp_path,
            "--extract-audio",
            "--audio-format", config.video.audio_format,
            "--audio-quality", "0",
            "--no-playlist",
            "-o", output_template,
            url,
        ],
        [
            yt_dlp_path,
            "-f", "bestaudio/best",
            "--no-playlist",
            "-o", output_template,
            url,
        ],
    ]
    return _download_with_fallbacks(
        attempts=attempts,
        url=url,
        temp_path=temp_path,
        stem="audio",
        timeout=900,
        failure_message="yt-dlp 未产出音频文件",
    )


def _transcribe_audio(audio_path: Path) -> str:
    content_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
    with open(audio_path, "rb") as f:
        response = _post_request(
            "POST",
            "https://api.deepgram.com/v1/listen",
            params={
                "model": config.video.deepgram_model,
                "language": config.video.deepgram_language,
                "punctuate": "true",
                "diarize": "true",
                "paragraphs": "true",
                "smart_format": "true",
            },
            headers={
                "Authorization": f"Token {config.video.deepgram_api_key}",
                "Content-Type": content_type,
            },
            data=f.read(),
            timeout=config.video.deepgram_timeout,
        )
    response.raise_for_status()
    payload = response.json()
    transcript = (
        payload.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("transcript", "")
        .strip()
    )
    if not transcript:
        raise RuntimeError("Deepgram 未返回有效 transcript")
    return transcript


def _build_transcript_markdown(metadata: dict[str, Any], transcript: str) -> str:
    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 发布时间: {_normalize_upload_date(metadata.get('upload_date', '')) or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 播放: {metadata.get('view_count') or '未知'}",
        f"- 点赞: {metadata.get('like_count') or '未知'}",
        f"- 评论: {metadata.get('comment_count') or '未知'}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
    ]
    tags = metadata.get("tags") or []
    if tags:
        lines.append(f"- 标签: {', '.join(tags)}")
    description = (metadata.get("description") or "").strip()
    if description:
        lines.extend(["", "## 视频简介", "", description])
    lines.extend([
        "",
        "## 音频转写",
        "",
        "> 注：视频画面获取失败，仅通过音频转写生成笔记。",
        "",
        transcript.strip(),
    ])
    return "\n".join(lines).strip() + "\n"


def _format_duration(value: Any) -> str:
    if not isinstance(value, (int, float)) or value < 0:
        return "未知"
    total_seconds = int(round(value))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _normalize_upload_date(value: str) -> str:
    if len(value) != 8 or not value.isdigit():
        return value
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"


def _build_direct_network_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in PROXY_ENV_KEYS:
        env.pop(key, None)
    return env


def _build_system_network_env() -> dict[str, str]:
    return os.environ.copy()


def _iter_yt_dlp_envs(url: str) -> list[dict[str, str]]:
    mode = config.video.network_mode
    is_youtube = any(marker in url.lower() for marker in YOUTUBE_HOST_MARKERS)
    if mode == "system":
        return [_build_system_network_env()]
    if mode == "auto" and is_youtube:
        return [_build_system_network_env(), _build_direct_network_env()]
    return [_build_direct_network_env()]


def _run_yt_dlp_command(
    command: list[str],
    url: str,
    env: dict[str, str],
    timeout: int,
) -> subprocess.CompletedProcess[str]:
    mode = config.video.yt_dlp_shell
    if _should_use_git_bash(url):
        bash_path = _find_git_bash()
        if not bash_path and mode == "git_bash":
            raise RuntimeError("已配置强制使用 Git Bash，但未找到 bash.exe")
        if bash_path:
            bash_command = " ".join(shlex.quote(part) for part in command)
            completed = subprocess.run(
                [str(bash_path), "-lc", bash_command],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=timeout,
                check=False,
            )
            if not _is_git_bash_boot_failure(completed):
                return completed
            if mode == "git_bash":
                raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "Git Bash 启动失败")
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=timeout,
        check=False,
    )


def _should_use_git_bash(url: str) -> bool:
    mode = config.video.yt_dlp_shell
    is_youtube = any(marker in url.lower() for marker in YOUTUBE_HOST_MARKERS)
    if mode == "git_bash":
        return True
    if mode == "auto" and is_youtube:
        return True
    return False


def _find_git_bash() -> Path | None:
    for path in GIT_BASH_CANDIDATES:
        if path.exists():
            return path
    return None


def _is_git_bash_boot_failure(completed: subprocess.CompletedProcess[str]) -> bool:
    merged = f"{completed.stdout}\n{completed.stderr}".lower()
    return "fatal error - couldn't create signal pipe" in merged


def _post_json(url: str, **kwargs: Any) -> requests.Response:
    return _post_request("POST", url, **kwargs)


def _post_request(method: str, url: str, **kwargs: Any) -> requests.Response:
    with requests.Session() as session:
        session.trust_env = False
        return session.request(method, url, **kwargs)


def _build_missing_video_config_message() -> str:
    diagnostics = get_video_config_diagnostics()
    loaded_files = diagnostics.get("loaded_env_files") or []
    env_keys = diagnostics.get("env_keys") or {}
    searched = "、".join(str(item) for item in loaded_files) if loaded_files else "未命中任何 .env 文件"
    available = "；".join(
        f"{key}={'SET' if value else 'EMPTY'}" for key, value in env_keys.items()
    )
    return (
        "缺少视频视觉解析配置，且未提供 DEEPGRAM_API_KEY 作为降级路径。"
        f"已加载环境文件：{searched}。"
        f"检测结果：{available}"
    )


def _split_video_for_vlm(metadata: dict[str, Any], video_path: Path, chunk_target_bytes: int) -> list[Path]:
    ffmpeg_path = shutil.which(config.video.ffmpeg_command)
    if not ffmpeg_path:
        raise RuntimeError("未找到 ffmpeg，无法对大视频执行分片上传")

    duration = metadata.get("duration")
    if not isinstance(duration, (int, float)) or duration <= 0:
        raise RuntimeError("缺少有效视频时长，无法按片段切分大视频")

    bytes_per_second = max(video_path.stat().st_size / float(duration), 1)
    target_seconds = int(chunk_target_bytes / bytes_per_second)
    target_seconds = max(target_seconds, getattr(config.video, "vlm_chunk_min_seconds", 90))
    target_seconds = min(target_seconds, getattr(config.video, "vlm_chunk_max_seconds", 480))

    chunk_dir = video_path.parent / f"{video_path.stem}-chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    output_template = chunk_dir / "chunk-%03d.mp4"
    command = [
        ffmpeg_path,
        "-y",
        "-i", str(video_path),
        "-map", "0",
        "-c", "copy",
        "-f", "segment",
        "-segment_time", str(target_seconds),
        "-reset_timestamps", "1",
        str(output_template),
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=config.video.ffmpeg_timeout,
        check=False,
    )
    chunk_paths = sorted(path for path in chunk_dir.glob("chunk-*.mp4") if path.stat().st_size > 0)
    if completed.returncode != 0 or not chunk_paths:
        details = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"ffmpeg 视频分片失败: {details or '未产出任何片段'}")
    return chunk_paths


def _cleanup_temp_dir(path: Path) -> None:
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass


def _find_download_candidates(temp_path: Path, stem: str) -> list[Path]:
    exact = sorted(
        path for path in temp_path.glob(f"{stem}.*")
        if not path.name.endswith(".part")
    )
    partial = sorted(temp_path.glob(f"{stem}.*.part"))
    return exact or partial


def _download_with_fallbacks(
    attempts: list[list[str]],
    url: str,
    temp_path: Path,
    stem: str,
    timeout: int,
    failure_message: str,
) -> Path:
    last_error = ""
    for env in _iter_yt_dlp_envs(url):
        for command in attempts:
            completed = _run_yt_dlp_command(
                command,
                url=url,
                env=env,
                timeout=timeout,
            )
            candidates = _find_download_candidates(temp_path, stem)
            if candidates:
                return candidates[0]
            last_error = completed.stderr.strip() or completed.stdout.strip() or failure_message
    raise RuntimeError(last_error or failure_message)
