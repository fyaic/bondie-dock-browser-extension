"""
Slack 投递上下文处理。
"""

import json
import os


ENV_CONTEXT_KEYS = (
    "WEB_FETCH_DELIVERY_CONTEXT",
    "OPENCLAW_DELIVERY_CONTEXT",
)

ENV_FIELD_KEYS = {
    "channel": (
        "WEB_FETCH_CHANNEL",
        "OPENCLAW_SOURCE_CHANNEL",
        "SLACK_CHANNEL",
    ),
    "thread_ts": (
        "WEB_FETCH_THREAD_TS",
        "OPENCLAW_THREAD_TS",
        "SLACK_THREAD_TS",
    ),
    "reply_in_thread": (
        "WEB_FETCH_REPLY_IN_THREAD",
        "OPENCLAW_REPLY_IN_THREAD",
    ),
}


def load_delivery_context() -> dict:
    """从环境变量读取投递上下文。"""
    for key in ENV_CONTEXT_KEYS:
        raw_value = os.getenv(key, "").strip()
        if not raw_value:
            continue
        payload = json.loads(raw_value)
        return normalize_delivery_context(payload)

    payload = {}
    for field_name, env_keys in ENV_FIELD_KEYS.items():
        for env_key in env_keys:
            raw_value = os.getenv(env_key, "").strip()
            if raw_value:
                payload[field_name] = raw_value
                break

    return normalize_delivery_context(payload)


def normalize_delivery_context(payload: dict | None) -> dict:
    """标准化投递上下文，确保 Slack channel 可直接投递。"""
    if not payload:
        return {}

    normalized = {}
    channel = str(payload.get("channel", "")).strip()
    if channel:
        normalized["channel"] = _normalize_channel(channel)

    thread_ts = str(payload.get("thread_ts", "")).strip()
    if thread_ts:
        normalized["thread_ts"] = thread_ts

    reply_in_thread = payload.get("reply_in_thread")
    if isinstance(reply_in_thread, str):
        normalized["reply_in_thread"] = reply_in_thread.strip().lower() in {"1", "true", "yes", "on"}
    elif isinstance(reply_in_thread, bool):
        normalized["reply_in_thread"] = reply_in_thread
    else:
        normalized["reply_in_thread"] = False

    return normalized


def _normalize_channel(channel: str) -> str:
    if channel.startswith("slack:"):
        return channel.split(":", 1)[1]
    return channel
