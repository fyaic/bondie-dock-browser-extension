#!/usr/bin/env python3
"""Run web-fetch pipeline and deliver canonical Slack report when available."""

import json
import os
import hashlib
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urldefrag, urlsplit, urlunsplit

import requests

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
os.environ["PYTHONIOENCODING"] = "utf-8"


ROOT = Path(__file__).resolve().parent
RUN_PIPELINE = ROOT / "run_pipeline.py"
SCRIPTS_DIR = ROOT / "scripts"
RUNTIME_DIR = ROOT / ".runtime"
DEDUP_DIR = RUNTIME_DIR / "deliveries"
LOCK_STALE_SECONDS = 45 * 60
RECENT_RESULT_TTL_SECONDS = 2 * 60 * 60
sys.path.insert(0, str(SCRIPTS_DIR))

from config import get_loaded_env_files
from delivery import load_delivery_context
from router import detect_link_type, detect_platform
from template_renderer import render_processing_report, render_processing_report_blocks


def load_env() -> dict[str, str]:
    return {
        key: value
        for key, value in os.environ.items()
        if key.strip()
    }


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法: python run_and_send.py <url> [output_dir]")

    env = load_env()
    delivery_context = load_delivery_context()
    channel = str(delivery_context.get("channel", "")).strip()
    if not channel:
        raise SystemExit("缺少 channel：无法发送 Slack 播报")

    token = env.get("SLACK_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("缺少 SLACK_BOT_TOKEN：无法发送 Slack 播报")

    url = sys.argv[1]
    dedupe_key = _build_dedupe_key(url, delivery_context)
    dedupe_paths = _dedupe_paths(dedupe_key)

    cached_result = _load_recent_result(dedupe_paths["result"])
    if cached_result is not None:
        print(json.dumps(cached_result, ensure_ascii=False, indent=2))
        return

    lock_info = _acquire_lock(dedupe_paths["lock"], dedupe_key)
    if lock_info is None:
        suppressed = {
            "status": "duplicate_suppressed",
            "reason": "duplicate_inflight",
            "channel": channel,
            "thread_ts": _effective_thread_ts(delivery_context),
            "dedupe_key": dedupe_key,
        }
        print(json.dumps(suppressed, ensure_ascii=False, indent=2))
        return

    link_type = detect_link_type(url)
    platform = detect_platform(url, link_type)

    # 生成唯一调用 ID，用于追踪和防重入
    invocation_id = f"{int(time.time())}-{hash(url) & 0xFFFF:04x}"
    env["WEB_FETCH_INVOCATION_ID"] = invocation_id
    env["WEB_FETCH_INTERNAL_CALL"] = "1"

    try:
        # 先发送 "处理中" 消息，让用户知道已经开始
        processing_blocks = render_processing_report_blocks(url, link_type, platform)
        processing_message = {
            "channel": channel,
            "text": render_processing_report(url, link_type, platform),
            "blocks": processing_blocks,
            "unfurl_links": False,
        }
        _post_to_slack(token, processing_message)

        command = [sys.executable, str(RUN_PIPELINE), url]
        if len(sys.argv) > 2:
            command.append(sys.argv[2])

        # 执行 pipeline，超时 30 分钟（视频处理可能需要较长时间）
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=1800,
            check=False,
        )

        if completed.returncode != 0:
            sys.stderr.write(completed.stderr or completed.stdout)
            raise SystemExit(completed.returncode)

        # 从 stdout 中提取 JSON（过滤掉日志输出，取最后一个大括号包围的 JSON 对象）
        payload = _extract_json_from_output(completed.stdout)
        status = payload.get("status", "")
        if status not in {"generated", "failed"}:
            raise SystemExit(f"非法 pipeline 状态: {status}")

        report_payload = payload.get("report_payload", {})

        # 发送最终结果
        message: dict[str, Any] = {
            "channel": channel,
            "text": report_payload.get("text", ""),
            "blocks": report_payload.get("blocks", []),
            "unfurl_links": False,
        }

        effective_thread_ts = _effective_thread_ts(delivery_context | report_payload.get("delivery", {}))
        if effective_thread_ts:
            message["thread_ts"] = effective_thread_ts

        result = _post_to_slack(token, message)

        output = {
            "status": status,
            "path": payload.get("path", ""),
            "title": payload.get("title", ""),
            "channel": channel,
            "thread_ts": effective_thread_ts,
            "invocation_id": invocation_id,
            "slack_ts": result.get("ts", ""),
            "loaded_env_files": get_loaded_env_files(),
            "dedupe_key": dedupe_key,
        }
        _write_result(dedupe_paths["result"], output)
        print(json.dumps(output, ensure_ascii=False, indent=2))
    finally:
        _release_lock(dedupe_paths["lock"], lock_info)


def _extract_json_from_output(stdout: str) -> dict[str, Any]:
    """从 stdout 中提取 JSON 对象（过滤掉前置的日志输出）。"""
    lines = stdout.strip().splitlines()

    # 从后往前找，找第一个以 { 开头的行，然后累积到 }
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if line.startswith("{"):
            # 尝试从这一行开始解析 JSON
            json_str = "\n".join(lines[i:])
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                # 尝试单行解析
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue

    # 如果找不到，尝试直接解析整个 stdout（可能整个都是 JSON）
    return json.loads(stdout)


def _post_to_slack(token: str, message: dict[str, Any]) -> dict[str, Any]:
    with requests.Session() as session:
        session.trust_env = False
        response = session.post(
            "https://slack.com/api/chat.postMessage",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            json=message,
            timeout=30,
            verify=False,
        )
    result = response.json()
    if not result.get("ok"):
        raise SystemExit(f"Slack 发送失败: {result.get('error', 'unknown_error')}")
    return result


def _build_dedupe_key(url: str, delivery_context: dict[str, Any]) -> str:
    normalized_url = _normalize_url(url)
    channel = str(delivery_context.get("channel", "")).strip()
    thread_ts = _effective_thread_ts(delivery_context)
    raw_key = "||".join((channel, thread_ts, normalized_url))
    digest = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()
    return digest


def _normalize_url(url: str) -> str:
    clean_url, _fragment = urldefrag(url.strip())
    parts = urlsplit(clean_url)
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ""))


def _effective_thread_ts(delivery_context: dict[str, Any]) -> str:
    if delivery_context.get("reply_in_thread") and delivery_context.get("thread_ts"):
        return str(delivery_context["thread_ts"]).strip()
    return ""


def _dedupe_paths(dedupe_key: str) -> dict[str, Path]:
    DEDUP_DIR.mkdir(parents=True, exist_ok=True)
    return {
        "lock": DEDUP_DIR / f"{dedupe_key}.lock.json",
        "result": DEDUP_DIR / f"{dedupe_key}.result.json",
    }


def _load_recent_result(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    saved_at = float(payload.get("_saved_at", 0))
    if time.time() - saved_at > RECENT_RESULT_TTL_SECONDS:
        return None
    if payload.get("status") != "generated":
        return None
    payload.pop("_saved_at", None)
    payload["duplicate_suppressed"] = True
    payload["reason"] = "duplicate_recent_result"
    return payload


def _write_result(path: Path, payload: dict[str, Any]) -> None:
    persisted = dict(payload)
    persisted["_saved_at"] = time.time()
    path.write_text(json.dumps(persisted, ensure_ascii=False, indent=2), encoding="utf-8")


def _acquire_lock(path: Path, dedupe_key: str) -> dict[str, Any] | None:
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            current = {}
        started_at = float(current.get("started_at", 0))
        if time.time() - started_at <= LOCK_STALE_SECONDS:
            return None
        try:
            path.unlink()
        except OSError:
            return None

    lock_info = {
        "pid": os.getpid(),
        "started_at": time.time(),
        "dedupe_key": dedupe_key,
    }
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file_obj:
            json.dump(lock_info, file_obj, ensure_ascii=False, indent=2)
    except Exception:
        try:
            path.unlink()
        except OSError:
            pass
        raise
    return lock_info


def _release_lock(path: Path, lock_info: dict[str, Any] | None) -> None:
    if lock_info is None or not path.exists():
        return
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        current = {}
    if current.get("pid") != lock_info.get("pid") or current.get("started_at") != lock_info.get("started_at"):
        return
    try:
        path.unlink()
    except OSError:
        pass


if __name__ == "__main__":
    main()
