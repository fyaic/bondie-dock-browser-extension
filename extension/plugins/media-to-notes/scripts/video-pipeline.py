#!/usr/bin/env python3
"""
video-pipeline.py - 独立 CLI 视频双轨处理工具
通过 yt-dlp 获取元数据 + Gemini 视觉分析 + Deepgram 音频转写。

优先 import 现有 scripts/video_pipeline.py 的 fetch_video_asset()；
如果 import 因依赖问题失败，回退到轻量独立实现。

Usage:
    python3 video-pipeline.py --url VIDEO_URL [--output-dir DIR]

stdout: JSON {"title", "content_markdown", "transcript", "content_type",
              "platform", "url", "duration", "author"}
stderr: 进度/错误信息
"""

import argparse
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# 辅助函数（独立实现，无项目内依赖）
# ---------------------------------------------------------------------------

YOUTUBE_HOST_MARKERS = ("youtube.com", "youtu.be")

DOUYIN_HOST_MARKERS = ("douyin.com", "iesdouyin.com")

PROXY_ENV_KEYS = (
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
)


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
    if not value or len(value) != 8 or not value.isdigit():
        return value
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"


# ---------------------------------------------------------------------------
# yt-dlp 封装
# ---------------------------------------------------------------------------

def _find_yt_dlp() -> str:
    """查找 yt-dlp 可执行文件路径。"""
    yt_dlp_path = os.getenv("WEB_FETCH_YT_DLP", "yt-dlp")
    resolved = shutil.which(yt_dlp_path)
    if not resolved:
        raise RuntimeError(f"未找到 yt-dlp: {yt_dlp_path}")
    return resolved


def _build_direct_network_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in PROXY_ENV_KEYS:
        env.pop(key, None)
    return env


def _build_system_network_env() -> dict[str, str]:
    return os.environ.copy()


def _iter_envs(url: str) -> list[dict[str, str]]:
    """根据 URL 判断是否需要代理环境。"""
    is_youtube = any(marker in url.lower() for marker in YOUTUBE_HOST_MARKERS)
    mode = os.getenv("VIDEO_NETWORK_MODE", "direct").lower()
    if mode == "system":
        return [_build_system_network_env()]
    if mode == "auto" and is_youtube:
        return [_build_system_network_env(), _build_direct_network_env()]
    return [_build_direct_network_env()]


def _run_command(command: list[str], url: str, env: dict[str, str], timeout: int) -> subprocess.CompletedProcess:
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


def extract_video_metadata(yt_dlp_path: str, url: str) -> dict[str, Any]:
    """使用 yt-dlp 提取视频元数据。"""
    command = [
        yt_dlp_path,
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--extractor-retries", "2",
        "--socket-timeout", "30",
        url,
    ]
    last_error = ""
    for env in _iter_envs(url):
        for _ in range(2):
            try:
                completed = _run_command(command, url, env, timeout=60)
            except subprocess.TimeoutExpired as exc:
                last_error = f"yt-dlp 元数据提取超时: {exc}"
                continue
            if completed.returncode == 0:
                return json.loads(completed.stdout)
            last_error = completed.stderr.strip() or completed.stdout.strip()
    raise RuntimeError(last_error or "yt-dlp 元数据提取失败")


def download_audio(yt_dlp_path: str, url: str, temp_dir: Path, audio_format: str = "wav") -> Path:
    """下载音频文件。"""
    output_template = str(temp_dir / "audio.%(ext)s")
    attempts = [
        [
            yt_dlp_path,
            "--extract-audio",
            "--audio-format", audio_format,
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
    for env in _iter_envs(url):
        for command in attempts:
            try:
                _run_command(command, url, env, timeout=900)
            except subprocess.TimeoutExpired:
                continue
            candidates = sorted(
                p for p in temp_dir.glob("audio.*") if not p.name.endswith(".part")
            )
            if candidates:
                return candidates[0]
    raise RuntimeError("yt-dlp 未产出音频文件")


def download_video(yt_dlp_path: str, url: str, temp_dir: Path, max_duration: int = 0) -> Path:
    """下载视频文件。"""
    output_template = str(temp_dir / "video.%(ext)s")
    base_command = [yt_dlp_path, "--no-playlist", "-o", output_template]

    if max_duration and max_duration > 0:
        base_command.extend(["--download-sections", f"*0-{max_duration}"])

    # 优先低分辨率（控制在 30MB 以内），再逐步 fallback
    attempts = [
        [*base_command, "-f", "bv*[height<=480]+ba/b[height<=480]/bv*[height<=720]+ba", "--merge-output-format", "mp4", url],
        [*base_command, "-f", "bv*+ba/b", "--merge-output-format", "mp4", url],
        [*base_command, "-f", "best", url],
    ]
    for env in _iter_envs(url):
        for command in attempts:
            try:
                _run_command(command, url, env, timeout=900)
            except subprocess.TimeoutExpired:
                continue
            candidates = sorted(
                p for p in temp_dir.glob("video.*") if not p.name.endswith(".part")
            )
            if candidates:
                return candidates[0]
    raise RuntimeError("yt-dlp 未产出视频文件")


# ---------------------------------------------------------------------------
# Deepgram 音频转写
# ---------------------------------------------------------------------------

def transcribe_audio(audio_path: Path, api_key: str, model: str = "nova-3", language: str = "multi") -> str:
    """使用 Deepgram API 转写音频。"""
    import mimetypes
    import requests

    content_type = mimetypes.guess_type(audio_path.name)[0] or "application/octet-stream"
    with open(audio_path, "rb") as f:
        response = requests.post(
            "https://api.deepgram.com/v1/listen",
            params={
                "model": model,
                "language": language,
                "punctuate": "true",
                "diarize": "true",
                "paragraphs": "true",
                "smart_format": "true",
            },
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": content_type,
            },
            data=f.read(),
            timeout=300,
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


# ---------------------------------------------------------------------------
# Gemini 视觉分析
# ---------------------------------------------------------------------------

def analyze_video_with_gemini(
    video_path: Path,
    metadata: dict[str, Any],
    api_key: str,
    base_url: str = "https://generativelanguage.googleapis.com/v1beta",
    model: str = "gemini-2.0-flash",
) -> str:
    """使用 Gemini API 分析视频内容。"""
    import base64
    import requests

    file_size = video_path.stat().st_size
    max_size_mb = int(os.getenv("VIDEO_MAX_SIZE_MB", "100"))
    if max_size_mb > 0 and file_size > max_size_mb * 1024 * 1024:
        raise RuntimeError(f"视频文件过大 ({file_size/1024/1024:.1f}MB > {max_size_mb}MB)")

    print(f"[GEMINI] 上传视频: {video_path.name} ({file_size/1024/1024:.1f}MB)", file=sys.stderr)

    with open(video_path, "rb") as f:
        video_bytes = f.read()

    encoded = base64.b64encode(video_bytes).decode("utf-8")

    prompt = _build_vlm_prompt(metadata)
    content = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:video/mp4;base64,{encoded}"}},
    ]

    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": content}],
    }

    endpoint = f"{base_url.rstrip('/')}/openai/chat/completions"
    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=int(os.getenv("VIDEO_VLM_TIMEOUT", "300")),
    )

    if response.status_code >= 400:
        snippet = response.text.strip()[:300]
        raise RuntimeError(f"Gemini API 调用失败: HTTP {response.status_code}, {snippet}")

    data = response.json()
    message = data["choices"][0]["message"]["content"]
    if isinstance(message, list):
        text = "\n".join(item.get("text", "") for item in message if isinstance(item, dict))
    else:
        text = str(message)
    text = text.strip()
    if not text:
        raise RuntimeError("Gemini 未返回有效内容")
    return text


def _find_media_understand_sh() -> Optional[str]:
    """查找 media-understand.sh 脚本路径。"""
    # 1. 项目本地 scripts/ 目录
    local_script = Path(__file__).parent / "media-understand.sh"
    if local_script.is_file():
        return str(local_script)
    # 2. ~/.openclaw/scripts/
    openclaw_script = Path.home() / ".openclaw" / "scripts" / "media-understand.sh"
    if openclaw_script.is_file():
        return str(openclaw_script)
    return None


def _analyze_video_via_script(video_path: Path, metadata: dict[str, Any]) -> str:
    """调用 media-understand.sh 分析视频 — 使用 OpenClaw 已验证的 curl 方案。

    优先使用 Bash + curl，因为 requests 通过 SOCKS 代理处理大 payload 不稳定。
    """
    script_path = _find_media_understand_sh()
    if not script_path:
        raise RuntimeError("未找到 media-understand.sh（本地 scripts/ 或 ~/.openclaw/scripts/）")

    print(f"[SCRIPT] 使用 media-understand.sh: {script_path}", file=sys.stderr)

    completed = subprocess.run(
        ["bash", script_path, str(video_path), "video", "0"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=int(os.getenv("VIDEO_VLM_TIMEOUT", "300")),
    )

    if completed.returncode != 0:
        raise RuntimeError(f"media-understand.sh 失败: {completed.stderr.strip()}")

    result = completed.stdout.strip()
    if not result:
        raise RuntimeError("media-understand.sh 未返回有效内容")
    return result


def _analyze_video_118api(
    video_path: Path,
    metadata: dict[str, Any],
    api_key: str,
    api_url: str = "https://118api.cn/v1/chat/completions",
    model: str = "gemini-3-flash-preview",
) -> str:
    """使用 118api 中转分析视频内容 — Python requests 降级方案。

    仅在 media-understand.sh 不可用时使用。
    关键：118api 中转不支持 video_url content type，必须用 image_url。
    Gemini 会根据 MIME type (video/mp4) 自动识别为视频。
    """
    import base64
    import requests as _req

    file_size = video_path.stat().st_size
    max_size_mb = int(os.getenv("VIDEO_MAX_SIZE_MB", "100"))
    if max_size_mb > 0 and file_size > max_size_mb * 1024 * 1024:
        raise RuntimeError(f"视频文件过大 ({file_size/1024/1024:.1f}MB > {max_size_mb}MB)")

    print(f"[118API] 上传视频: {video_path.name} ({file_size/1024/1024:.1f}MB)", file=sys.stderr)

    with open(video_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    prompt = _build_vlm_prompt(metadata)

    # 关键：用 image_url 而非 video_url，Gemini 根据 MIME type 识别
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:video/mp4;base64,{encoded}"
                        },
                    },
                ],
            }
        ],
        "temperature": 0.3,
    }

    # 写入临时文件避免 shell 参数长度限制
    tmp = Path(tempfile.mktemp(suffix=".json"))
    with open(tmp, "w", encoding="utf-8") as f:
        import json
        json.dump(payload, f, ensure_ascii=False)

    response = _req.post(
        api_url,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        data=tmp.read_bytes(),
        timeout=int(os.getenv("VIDEO_VLM_TIMEOUT", "300")),
    )
    tmp.unlink(missing_ok=True)

    if response.status_code >= 400:
        snippet = response.text.strip()[:500]
        raise RuntimeError(f"118api 调用失败: HTTP {response.status_code}, {snippet}")

    data = response.json()
    if "error" in data:
        raise RuntimeError(f"118api 返回错误: {data['error']}")

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        text = "\n".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        )
    else:
        text = str(content)
    text = text.strip()
    if not text:
        raise RuntimeError("118api 未返回有效内容")
    return text


def _build_vlm_prompt(metadata: dict[str, Any]) -> str:
    description = (metadata.get("description") or "").strip()
    tags = ", ".join(metadata.get("tags") or [])
    return (
        "请根据这个视频，整理一份中文 Markdown 知识笔记草稿。"
        "目标不是描述画面好看不好看，而是判断这是什么内容，以及它与标题中提到的产品到底是什么关系。"
        "你必须优先判断：这是项目本体介绍、第三方案例演示、蹭热点广告、教程，还是单纯资讯。"
        "如果视频简介、标签、UP 主身份里出现试用链接、GitHub/Gitee、客服微信、品牌导流等信号，"
        "要明确指出这是推广或广告，不要误写成标题里的项目本体。"
        "如果是产品演示视频，优先提炼产品定位、主要功能、工作流、用户价值，"
        "以及它与被蹭热点对象的真实关系。"
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
        f"标签：{tags or '无'}\n"
        f"简介：{description or '无'}\n"
    )


# ---------------------------------------------------------------------------
# 抖音专用处理（Playwright 辅助）
# yt-dlp 的 Douyin 提取器存在上游 bug（需要 X-Bogus JS 签名），
# 此模块使用 Playwright 浏览器加载页面并拦截 CDN 视频流 URL。
# ---------------------------------------------------------------------------

def _is_douyin_url(url: str) -> bool:
    """判断 URL 是否为抖音链接。"""
    return any(marker in url.lower() for marker in DOUYIN_HOST_MARKERS)


def _find_douyin_cookie_file() -> Optional[str]:
    """查找抖音 cookies 文件（Netscape 格式）。"""
    # 1. 环境变量指定
    env_path = os.getenv("DOUYIN_COOKIE_FILE", "")
    if env_path:
        p = Path(env_path).expanduser()
        if p.is_file():
            return str(p)
    # 2. skill 默认位置
    default_path = Path.home() / ".config" / "axia-multimedia-to-note" / "cookies" / "douyin.txt"
    if default_path.is_file():
        return str(default_path)
    # 3. OpenClaw 位置
    openclaw_path = Path.home() / ".openclaw" / "cookies" / "douyin.txt"
    if openclaw_path.is_file():
        return str(openclaw_path)
    return None


def _parse_netscape_cookies(cookie_path: str) -> list[dict[str, Any]]:
    """解析 Netscape cookies.txt 文件为 Playwright add_cookies 格式。"""
    cookies: list[dict[str, Any]] = []
    with open(cookie_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            entry: dict[str, Any] = {
                "name": parts[5],
                "value": parts[6],
                "domain": parts[0],
                "path": parts[2],
            }
            if parts[4] != "0":
                try:
                    entry["expires"] = int(parts[4])
                except ValueError:
                    pass
            cookies.append(entry)
    return cookies


def _intercept_douyin_media(url: str, temp_dir: Path) -> dict[str, Any]:
    """使用 Playwright 加载抖音页面，拦截 CDN 视频/音频 URL。

    Returns:
        dict with keys:
            video_url: 拦截到的视频流 CDN URL
            audio_url: 拦截到的音频流 CDN URL (可能为 None)
            metadata: 从 DOM 提取的元数据 dict
            screenshot: 页面截图 bytes (fallback 用)
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(
            "抖音专用处理器需要 Playwright: pip install playwright && playwright install chromium"
        )

    cookie_file = _find_douyin_cookie_file()
    pw_cookies: list[dict[str, Any]] = []
    if cookie_file:
        pw_cookies = _parse_netscape_cookies(cookie_file)
        print(f"[DOUYIN] Cookies: {cookie_file} ({len(pw_cookies)} 条)", file=sys.stderr)
    else:
        print("[DOUYIN] 无 cookie 文件，尝试无登录模式", file=sys.stderr)

    cdn_video_urls: list[str] = []
    cdn_audio_urls: list[str] = []
    metadata: dict[str, Any] = {}
    screenshot_bytes: bytes = b""

    page_timeout = int(os.getenv("DOUYIN_PAGE_TIMEOUT", "30")) * 1000

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
        )
        if pw_cookies:
            context.add_cookies(pw_cookies)

        page = context.new_page()

        def _on_request(request):
            """用 request 事件拦截 — 比 response 更早触发，不需要等下载完成。"""
            r_url = request.url
            if "douyinvod.com" in r_url or "douyincdn.com" in r_url:
                if "media-video" in r_url:
                    cdn_video_urls.append(r_url)
                elif "media-audio" in r_url:
                    cdn_audio_urls.append(r_url)

        def _on_response(response):
            """response 事件作为补充 — 有些请求可能被 request 遗漏。"""
            r_url = response.url
            if "douyinvod.com" in r_url or "douyincdn.com" in r_url:
                if "media-video" in r_url and r_url not in cdn_video_urls:
                    cdn_video_urls.append(r_url)
                elif "media-audio" in r_url and r_url not in cdn_audio_urls:
                    cdn_audio_urls.append(r_url)

        page.on("request", _on_request)
        page.on("response", _on_response)

        print(f"[DOUYIN] 加载页面: {url}", file=sys.stderr)
        page.goto(url, wait_until="domcontentloaded", timeout=page_timeout)

        # 等待基础 DOM 加载
        page.wait_for_timeout(3000)

        # 关闭登录弹窗 — 抖音 headless 模式下会出现登录遮挡
        try:
            # 方案 1: 查找并点击关闭按钮
            dismiss_selectors = [
                "[data-e2e='login-close']",
                "button.login-close",
                ".dy-account-close",
                ".login-panel .close",
                "[class*='login'] [class*='close']",
                "[class*='Login'] [class*='close']",
                "div[id*='login'] button",
                "svg[class*='close']",
            ]
            for selector in dismiss_selectors:
                try:
                    btn = page.query_selector(selector)
                    if btn and btn.is_visible():
                        btn.click(timeout=2000)
                        print(f"[DOUYIN] 关闭登录弹窗: {selector}", file=sys.stderr)
                        page.wait_for_timeout(1000)
                        break
                except Exception:
                    continue

            # 方案 2: 通过 JS 移除登录遮罩层
            page.evaluate("""() => {
                // 移除所有登录/弹窗遮罩
                const overlays = document.querySelectorAll(
                    '[class*="login"], [class*="Login"], [class*="modal"], [class*="Modal"], [class*="overlay"]'
                );
                for (const el of overlays) {
                    if (el.offsetWidth > 300 && el.offsetHeight > 200) {
                        el.style.display = 'none';
                    }
                }
                // 移除可能的半透明背景
                const masks = document.querySelectorAll('[class*="mask"], [class*="Mask"]');
                for (const el of masks) {
                    el.style.display = 'none';
                }
            }""")
            print("[DOUYIN] 已尝试移除登录遮罩", file=sys.stderr)
        except Exception as e:
            print(f"[DOUYIN] 关闭弹窗失败: {e}", file=sys.stderr)

        # 触发视频播放 — headless 模式不自动播放
        try:
            video_el = page.wait_for_selector("video", timeout=8000)
            if video_el:
                # 用 JS 强制播放 + 静音（浏览器策略要求）
                page.evaluate("""() => {
                    const v = document.querySelector('video');
                    if (v) {
                        v.muted = true;
                        v.autoplay = true;
                        v.play().catch(() => {});
                        // 有些播放器监听的是容器 click
                        v.click();
                    }
                }""")
                print("[DOUYIN] JS 触发视频播放", file=sys.stderr)
                page.wait_for_timeout(3000)
        except Exception:
            print("[DOUYIN] 未找到视频元素，继续等待", file=sys.stderr)

        # 等待 CDN 请求触发
        page.wait_for_timeout(5000)

        # 从 DOM 提取元数据
        try:
            raw_title = page.title() or ""
            metadata["title"] = raw_title.replace(" - 抖音", "").strip()
        except Exception:
            metadata["title"] = ""

        try:
            metadata["uploader"] = page.evaluate(
                '() => (document.querySelector("[data-e2e=\\"video-author\\"]") || {}).innerText || ""'
            ) or ""
        except Exception:
            metadata["uploader"] = ""

        try:
            metadata["description"] = page.evaluate(
                '() => (document.querySelector("[data-e2e=\\"video-desc\\"]") || {}).innerText || ""'
            ) or ""
        except Exception:
            metadata["description"] = ""

        try:
            metadata["duration"] = page.evaluate(
                '() => { const v = document.querySelector("video"); return v ? v.duration : 0; }'
            ) or 0
        except Exception:
            metadata["duration"] = 0

        metadata.setdefault("webpage_url", url)
        metadata.setdefault("extractor_key", "Douyin")
        metadata.setdefault("extractor", "douyin")

        # 从 video 元素提取 currentSrc — headless 模式下 CDN 拦截不可靠，
        # 但 video 元素的 currentSrc 在 cookie 认证后一定有值
        dom_video_url = ""
        try:
            dom_video_url = page.evaluate(
                '() => { const v = document.querySelector("video"); return v ? (v.currentSrc || v.src || "") : ""; }'
            ) or ""
        except Exception:
            pass
        if dom_video_url and "douyinvod.com" in dom_video_url:
            cdn_video_urls.append(dom_video_url)
            print(f"[DOUYIN] 从 DOM 提取 video URL: {dom_video_url[:100]}...", file=sys.stderr)

        # 截图前再次确保移除弹窗遮挡
        try:
            page.evaluate("""() => {
                const overlays = document.querySelectorAll(
                    '[class*="login"], [class*="Login"], [class*="modal"], [class*="Modal"], [class*="overlay"], [class*="mask"], [class*="Mask"]'
                );
                for (const el of overlays) {
                    if (el.offsetWidth > 300 && el.offsetHeight > 200) {
                        el.style.display = 'none';
                    }
                }
            }""")
        except Exception:
            pass

        # 截图 fallback — 优先截取 video 元素
        try:
            video_el = page.query_selector("video")
            if video_el:
                # 截取 video 元素本身，避开页面其他 UI
                box = video_el.bounding_box()
                if box:
                    screenshot_bytes = page.screenshot(
                        clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]}
                    )
                    print(f"[DOUYIN] 截取视频区域 ({box['width']:.0f}x{box['height']:.0f})", file=sys.stderr)
        except Exception:
            pass

        if not screenshot_bytes:
            try:
                screenshot_bytes = page.screenshot()
            except Exception:
                pass

        browser.close()

    print(f"[DOUYIN] 元数据: {metadata.get('title')}", file=sys.stderr)
    print(f"[DOUYIN] 拦截: {len(cdn_video_urls)} 视频, {len(cdn_audio_urls)} 音频 CDN URL", file=sys.stderr)

    return {
        "video_url": cdn_video_urls[-1] if cdn_video_urls else None,
        "audio_url": cdn_audio_urls[-1] if cdn_audio_urls else None,
        "metadata": metadata,
        "screenshot": screenshot_bytes,
    }


def _download_cdn_media(url: str, dest: Path, timeout: int = 0) -> Path:
    """使用 curl 下载 CDN 媒体文件（带 referer 和 cookie）。"""
    timeout = timeout or int(os.getenv("DOUYIN_CDN_TIMEOUT", "120"))
    cookie_file = _find_douyin_cookie_file()
    curl_args = [
        "curl", "-sL", "--max-time", str(timeout),
        "-H", "Referer: https://www.douyin.com/",
        "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ]
    if cookie_file:
        curl_args.extend(["-b", cookie_file])
    curl_args.extend(["-o", str(dest), url])
    result = subprocess.run(
        curl_args,
        capture_output=True, text=True, timeout=timeout + 60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"CDN 下载失败 (curl {result.returncode}): {result.stderr.strip()}")
    if not dest.exists() or dest.stat().st_size < 1000:
        raise RuntimeError(f"CDN 下载结果异常: {dest} ({dest.stat().st_size if dest.exists() else 0} bytes)")
    return dest


def _merge_dash_streams(video_path: Path, audio_path: Path, output_path: Path) -> Path:
    """使用 ffmpeg 合并 DASH 视频和音频流。"""
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        # 没有 ffmpeg，直接使用视频流
        return video_path
    result = subprocess.run(
        [ffmpeg_path, "-y", "-i", str(video_path), "-i", str(audio_path),
         "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", str(output_path)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 1000:
        return output_path
    # 合并失败，直接使用视频流
    return video_path


def _extract_audio_from_video(video_path: Path, output_path: Path) -> Optional[Path]:
    """使用 ffmpeg 从视频文件中提取音轨为 wav。"""
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return None
    try:
        subprocess.run(
            [ffmpeg_path, "-y", "-i", str(video_path), "-vn",
             "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(output_path)],
            capture_output=True, text=True, timeout=120,
        )
        if output_path.exists() and output_path.stat().st_size > 1000:
            return output_path
    except Exception:
        pass
    return None


def _run_douyin_pipeline(url: str, temp_dir: Path, warnings: list[str]) -> dict:
    """抖音视频专用处理流程 — Playwright 拦截 CDN URL 替代 yt-dlp。

    降级策略:
        1. Playwright 拦截失败 → 尝试 yt-dlp
        2. CDN URL 下载失败 → 截图发 Gemini 图片分析
        3. 音频获取失败 → 仅视觉分析
    """
    print("[DOUYIN] ===== 抖音专用流程启动 =====", file=sys.stderr)

    # --- A1: Playwright 拦截 ---
    try:
        douyin_result = _intercept_douyin_media(url, temp_dir)
    except Exception as e:
        print(f"[DOUYIN] Playwright 拦截失败: {e}", file=sys.stderr)
        warnings.append(f"Playwright 拦截失败: {e}")
        # 降级到 yt-dlp（可能因 X-Bogus 失败）
        print("[DOUYIN] 降级到 yt-dlp...", file=sys.stderr)
        return None  # 返回 None 让调用方走原有 yt-dlp 流程

    metadata = douyin_result["metadata"]
    print(f"[VIDEO] 标题: {metadata.get('title')}", file=sys.stderr)
    print(f"[VIDEO] 时长: {_format_duration(metadata.get('duration'))}", file=sys.stderr)

    # --- A2: 视频下载 + Gemini 视觉分析 ---
    vision_result = ""
    video_path: Optional[Path] = None
    api_key = os.getenv("MEDIA_API_KEY", "")
    api_url = os.getenv("MEDIA_API_BASE_URL", "https://118api.cn/v1/chat/completions")
    api_model = os.getenv("MEDIA_API_MODEL", "gemini-3-flash-preview")

    video_url = douyin_result.get("video_url")

    if video_url and (api_key or _find_media_understand_sh()):
        try:
            # 下载视频流
            raw_video = temp_dir / "video_raw.mp4"
            _download_cdn_media(video_url, raw_video)
            print(f"[DOUYIN] 视频流下载: {raw_video.name} ({raw_video.stat().st_size/1024/1024:.1f}MB)", file=sys.stderr)

            # 如果有独立音频流，合并
            audio_url = douyin_result.get("audio_url")
            if audio_url:
                try:
                    raw_audio = temp_dir / "audio_dash.mp4"
                    _download_cdn_media(audio_url, raw_audio)
                    merged = temp_dir / "video.mp4"
                    video_path = _merge_dash_streams(raw_video, raw_audio, merged)
                except Exception as e:
                    print(f"[DOUYIN] 音频流合并失败: {e}", file=sys.stderr)
                    video_path = raw_video
            else:
                video_path = raw_video

            file_size_mb = video_path.stat().st_size / 1024 / 1024
            print(f"[VIDEO] 视频下载成功: {video_path.name} ({file_size_mb:.1f}MB)", file=sys.stderr)

            # 大文件截取：Gemini API 有 100MB 限制，base64 后膨胀 ~33%
            # 保留前 N 秒，控制在 30MB 以内
            max_size_mb = int(os.getenv("VIDEO_MAX_SIZE_MB", "100"))
            max_duration = int(os.getenv("VIDEO_MAX_DURATION", "120"))
            if max_size_mb > 0 and (file_size_mb > max_size_mb or file_size_mb > 30):
                clipped = temp_dir / "video_clipped.mp4"
                ffmpeg_path = shutil.which("ffmpeg")
                if ffmpeg_path:
                    # 按 duration/filesize 比例估算截取秒数
                    duration = metadata.get("duration", 0) or 0
                    if duration > 0 and file_size_mb > 0:
                        target_seconds = min(max_duration, int(30 / file_size_mb * duration))
                    else:
                        target_seconds = max_duration
                    target_seconds = max(30, target_seconds)  # 至少 30 秒
                    print(f"[DOUYIN] 截取前 {target_seconds}s (原始 {file_size_mb:.1f}MB)", file=sys.stderr)
                    subprocess.run(
                        [ffmpeg_path, "-y", "-i", str(video_path),
                         "-t", str(target_seconds),
                         "-c:v", "libx264", "-crf", "28", "-preset", "fast",
                         "-c:a", "aac", "-b:a", "64k",
                         "-movflags", "+faststart", str(clipped)],
                        capture_output=True, text=True, timeout=120,
                    )
                    if clipped.exists() and clipped.stat().st_size > 1000:
                        video_path = clipped
                        print(f"[DOUYIN] 截取完成: {video_path.name} ({video_path.stat().st_size/1024/1024:.1f}MB)", file=sys.stderr)

            # Gemini 视觉分析（复用现有逻辑）
            script_path = _find_media_understand_sh()
            if script_path:
                vision_result = _analyze_video_via_script(video_path, metadata)
                print(f"[VIDEO] 视觉分析完成 via script ({len(vision_result)} chars)", file=sys.stderr)
            elif api_key:
                vision_result = _analyze_video_118api(
                    video_path, metadata, api_key, api_url, api_model,
                )
                print(f"[VIDEO] 视觉分析完成 via requests ({len(vision_result)} chars)", file=sys.stderr)

        except Exception as e:
            warnings.append(f"视觉分析失败: {e}")
            print(f"[VIDEO] 视觉分析失败: {e}", file=sys.stderr)

    # 截图 fallback：CDN 失败时用截图做 Gemini 图片分析
    if not vision_result and douyin_result.get("screenshot") and (api_key or _find_media_understand_sh()):
        try:
            screenshot_path = temp_dir / "screenshot.png"
            screenshot_path.write_bytes(douyin_result["screenshot"])
            print(f"[DOUYIN] 使用截图做视觉分析 ({len(douyin_result['screenshot'])} bytes)", file=sys.stderr)
            script_path = _find_media_understand_sh()
            if script_path:
                # 截图用 image 类型，不是 video
                completed = subprocess.run(
                    ["bash", script_path, str(screenshot_path), "image", "0"],
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=int(os.getenv("VIDEO_VLM_TIMEOUT", "300")),
                )
                if completed.returncode != 0:
                    raise RuntimeError(f"media-understand.sh 失败: {completed.stderr.strip()}")
                vision_result = completed.stdout.strip()
            elif api_key:
                vision_result = _analyze_video_118api(
                    screenshot_path, metadata, api_key, api_url, api_model,
                )
            if vision_result:
                vision_result = f"> 以下分析基于视频截图（视频流未能获取）\n\n{vision_result}"
                print(f"[VIDEO] 截图分析完成 ({len(vision_result)} chars)", file=sys.stderr)
        except Exception as e:
            warnings.append(f"截图分析失败: {e}")
            print(f"[VIDEO] 截图分析失败: {e}", file=sys.stderr)

    # --- A3: 音频转写（可选）---
    transcript_result = ""
    deepgram_key = os.getenv("DEEPGRAM_API_KEY", "")
    if deepgram_key:
        try:
            audio_for_deepgram: Optional[Path] = None

            # 优先：拦截到的独立音频流
            if douyin_result.get("audio_url"):
                try:
                    raw_audio = temp_dir / "audio_raw.mp4"
                    _download_cdn_media(douyin_result["audio_url"], raw_audio)
                    wav_path = temp_dir / "audio.wav"
                    extracted = _extract_audio_from_video(raw_audio, wav_path)
                    if extracted:
                        audio_for_deepgram = extracted
                except Exception:
                    pass

            # 次选：从视频提取音轨
            if not audio_for_deepgram and video_path and video_path.exists():
                wav_path = temp_dir / "audio.wav"
                audio_for_deepgram = _extract_audio_from_video(video_path, wav_path)

            if audio_for_deepgram:
                print(f"[VIDEO] 音频就绪: {audio_for_deepgram.name}", file=sys.stderr)
                transcript_result = transcribe_audio(audio_for_deepgram, deepgram_key)
                print(f"[VIDEO] Deepgram 转写完成 ({len(transcript_result)} chars)", file=sys.stderr)
            else:
                print("[DOUYIN] 无法获取音频", file=sys.stderr)
        except Exception as e:
            if not vision_result:
                raise RuntimeError(f"视觉和音频处理均失败: {e}")
            warnings.append(f"音频转写失败: {e}")
            print(f"[VIDEO] 音频转写失败: {e}", file=sys.stderr)

    # --- A4: 合并结果（复用现有函数）---
    if vision_result and transcript_result:
        content_md = _build_merged_markdown(metadata, vision_result, transcript_result)
    elif vision_result:
        content_md = _build_vision_markdown(metadata, vision_result)
    elif transcript_result:
        content_md = _build_transcript_markdown(metadata, transcript_result)
    else:
        raise RuntimeError(f"视觉和音频处理均失败: {'; '.join(warnings)}")

    title = metadata.get("title") or metadata.get("webpage_url") or url
    return {
        "title": title,
        "content_markdown": content_md,
        "transcript": transcript_result,
        "content_type": "video",
        "platform": metadata.get("extractor_key") or metadata.get("extractor") or "Douyin",
        "url": metadata.get("webpage_url") or url,
        "duration": _format_duration(metadata.get("duration")),
        "author": metadata.get("uploader", ""),
    }


# ---------------------------------------------------------------------------
# Markdown 组装
# ---------------------------------------------------------------------------

def _build_vision_markdown(metadata: dict[str, Any], vision_text: str) -> str:
    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
        "",
        "## 视觉解析",
        "",
        vision_text.strip(),
    ]
    return "\n".join(lines).strip() + "\n"


def _build_transcript_markdown(metadata: dict[str, Any], transcript: str) -> str:
    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
        "",
        "## 音频转写",
        "",
        transcript.strip(),
    ]
    return "\n".join(lines).strip() + "\n"


def _build_merged_markdown(metadata: dict[str, Any], vision_text: str, transcript: str) -> str:
    lines = [
        f"# {metadata.get('title') or '未命名视频'}",
        "",
        "## 视频元数据",
        "",
        f"- 平台: {metadata.get('extractor_key') or metadata.get('extractor') or '未知'}",
        f"- 作者: {metadata.get('uploader') or '未知'}",
        f"- 时长: {_format_duration(metadata.get('duration'))}",
        f"- 原链接: {metadata.get('webpage_url') or ''}",
        "",
        "## 视觉解析（Gemini）",
        "",
        vision_text.strip(),
        "",
        "## 音频转写（Deepgram）",
        "",
        transcript.strip(),
        "",
        "## 综合理解",
        "",
        "*本笔记结合了视频画面分析和音频转写，如两者有冲突请以画面为准。*",
    ]
    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------------------
# 轻量独立流程
# ---------------------------------------------------------------------------

def _run_lightweight_pipeline(url: str, output_dir: Optional[Path] = None) -> dict:
    """
    轻量独立视频处理流程 — 对齐 OpenClaw 已验证方案。
    使用 118api 中转 + Gemini 多模态（base64 编码 + image_url），
    与 ~/.openclaw/scripts/media-understand.sh 完全一致。
    """
    yt_dlp_path = _find_yt_dlp()
    print(f"[VIDEO] yt-dlp: {yt_dlp_path}", file=sys.stderr)

    # 创建临时目录
    temp_root = Path(os.getenv("VIDEO_TEMP_ROOT", "/tmp"))
    temp_root.mkdir(parents=True, exist_ok=True)
    temp_dir = temp_root / f"video-job-{secrets.token_hex(4)}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []

    try:
        # --- 抖音专用路由 ---
        # yt-dlp 的 Douyin 提取器有上游 bug（需要 X-Bogus JS 签名），
        # 使用 Playwright 拦截 CDN URL 替代
        if _is_douyin_url(url):
            douyin_result = _run_douyin_pipeline(url, temp_dir, warnings)
            if douyin_result is not None:
                return douyin_result
            # None = Playwright 失败，降级到 yt-dlp（可能仍然失败）
            print("[DOUYIN] Playwright 流程返回 None，降级到 yt-dlp", file=sys.stderr)

        # 1. 元数据
        metadata = extract_video_metadata(yt_dlp_path, url)
        print(f"[VIDEO] 标题: {metadata.get('title')}", file=sys.stderr)
        print(f"[VIDEO] 时长: {_format_duration(metadata.get('duration'))}", file=sys.stderr)

        # 2. 视频分析 — 优先使用已验证的 media-understand.sh（curl 方案）
        vision_result = ""
        api_key = os.getenv("MEDIA_API_KEY", "")
        api_url = os.getenv("MEDIA_API_BASE_URL", "https://118api.cn/v1/chat/completions")
        api_model = os.getenv("MEDIA_API_MODEL", "gemini-3-flash-preview")

        # 视频时长限制（秒）：长视频截取前 N 秒避免文件过大
        max_duration = int(os.getenv("VIDEO_MAX_DURATION", "120"))

        if api_key or _find_media_understand_sh():
            try:
                video_path = download_video(
                    yt_dlp_path, url, temp_dir, max_duration=max_duration,
                )
                file_size_mb = video_path.stat().st_size / 1024 / 1024
                print(f"[VIDEO] 视频下载成功: {video_path.name} ({file_size_mb:.1f}MB)", file=sys.stderr)

                # 优先：media-understand.sh（curl，已验证稳定）
                script_path = _find_media_understand_sh()
                if script_path:
                    vision_result = _analyze_video_via_script(video_path, metadata)
                    print(f"[VIDEO] 视觉分析完成 via script ({len(vision_result)} chars)", file=sys.stderr)
                elif api_key:
                    # 降级：Python requests
                    vision_result = _analyze_video_118api(
                        video_path, metadata, api_key, api_url, api_model,
                    )
                    print(f"[VIDEO] 视觉分析完成 via requests ({len(vision_result)} chars)", file=sys.stderr)
            except Exception as e:
                warnings.append(f"视觉分析失败: {e}")
                print(f"[VIDEO] 视觉分析失败: {e}", file=sys.stderr)
        else:
            print(f"[VIDEO] 跳过视觉分析（无 MEDIA_API_KEY 且无 media-understand.sh）", file=sys.stderr)

        # 3. 音频转写（可选）
        transcript_result = ""
        deepgram_key = os.getenv("DEEPGRAM_API_KEY", "")
        if deepgram_key:
            try:
                audio_path = download_audio(yt_dlp_path, url, temp_dir)
                print(f"[VIDEO] 音频下载成功: {audio_path.name}", file=sys.stderr)
                transcript_result = transcribe_audio(audio_path, deepgram_key)
                print(f"[VIDEO] Deepgram 转写完成 ({len(transcript_result)} chars)", file=sys.stderr)
            except Exception as e:
                if not vision_result:
                    raise RuntimeError(f"视觉和音频处理均失败: {e}")
                warnings.append(f"音频转写失败: {e}")
                print(f"[VIDEO] 音频转写失败: {e}", file=sys.stderr)

        # 4. 合并结果
        if vision_result and transcript_result:
            content_md = _build_merged_markdown(metadata, vision_result, transcript_result)
        elif vision_result:
            content_md = _build_vision_markdown(metadata, vision_result)
        elif transcript_result:
            content_md = _build_transcript_markdown(metadata, transcript_result)
        else:
            raise RuntimeError(f"视觉和音频处理均失败: {'; '.join(warnings)}")

        title = metadata.get("title") or metadata.get("webpage_url") or url
        return {
            "title": title,
            "content_markdown": content_md,
            "transcript": transcript_result,
            "content_type": "video",
            "platform": metadata.get("extractor_key") or metadata.get("extractor") or "unknown",
            "url": metadata.get("webpage_url") or url,
            "duration": _format_duration(metadata.get("duration")),
            "author": metadata.get("uploader", ""),
        }

    finally:
        # 清理临时目录
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="video-pipeline - 视频双轨处理（Gemini + Deepgram）")
    parser.add_argument("--url", required=True, help="视频 URL")
    parser.add_argument("--output-dir", default="", help="输出目录")
    args = parser.parse_args()

    try:
        # 优先尝试使用现有的 video_pipeline.py 模块
        try:
            project_root = Path(__file__).parent
            sys.path.insert(0, str(project_root))
            from video_pipeline import fetch_video_asset  # type: ignore
            from config import config  # type: ignore
            from models import ContentAsset  # type: ignore

            print("[VIDEO] 使用现有 video_pipeline 模块", file=sys.stderr)
            output_dir = args.output_dir or str(config.output.base_dir)
            asset, extra = fetch_video_asset(args.url, Path(output_dir))

            result = {
                "title": asset.title,
                "content_markdown": asset.body_markdown,
                "transcript": asset.transcript or "",
                "content_type": "video",
                "platform": asset.source_platform,
                "url": asset.resolved_url,
                "duration": _format_duration(asset.metadata.get("duration")) if asset.metadata else "未知",
                "author": asset.author,
            }
        except (ImportError, RuntimeError) as fallback_err:
            # 现有模块 import 或运行失败，回退到轻量实现
            print(f"[VIDEO] 现有模块失败 ({fallback_err})，使用轻量实现", file=sys.stderr)
            output_dir = Path(args.output_dir) if args.output_dir else None
            result = _run_lightweight_pipeline(args.url, output_dir)

        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")

    except Exception as e:
        print(f"HANDOFF: VIDEO_FALLBACK", file=sys.stderr)
        print(f"URL: {args.url}", file=sys.stderr)
        print(f"REASON: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
