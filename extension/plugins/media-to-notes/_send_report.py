#!/usr/bin/env python3
"""Send final web-clipping report to Slack."""

import json
import os
import sys

import requests

sys.stdout.reconfigure(encoding="utf-8")
os.environ["PYTHONIOENCODING"] = "utf-8"

ENV_FILE = os.path.expanduser("~/.openclaw/workspace/.env")
ROOT = os.path.dirname(__file__)
SCRIPTS_DIR = os.path.join(ROOT, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from delivery import load_delivery_context


def load_env():
    env = {}
    with open(ENV_FILE, encoding="utf-8") as file_obj:
        for line in file_obj:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return env


def no_proxy():
    return {"http": None, "https": None}


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("用法: python _send_report.py <payload_json_path>")

    payload_path = sys.argv[1]
    with open(payload_path, encoding="utf-8") as file_obj:
        report_payload = json.load(file_obj)
    delivery = load_delivery_context() | report_payload.get("delivery", {})
    channel = delivery.get("channel", "").strip()
    if not channel:
        raise SystemExit("缺少 channel：请通过环境变量或 payload.delivery 传入")

    payload = {
        "channel": channel,
        "text": report_payload.get("text", ""),
        "blocks": report_payload.get("blocks", []),
        "unfurl_links": False,
    }
    if delivery.get("reply_in_thread") and delivery.get("thread_ts"):
        payload["thread_ts"] = delivery["thread_ts"]

    token = load_env().get("SLACK_BOT_TOKEN", "")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    response = requests.post(
        "https://slack.com/api/chat.postMessage",
        json=payload,
        headers=headers,
        proxies=no_proxy(),
        timeout=15,
    )
    result = response.json()
    print(f"{'[OK]' if result.get('ok') else '[FAIL] ' + result.get('error')} ts={result.get('ts')}")


if __name__ == "__main__":
    main()
