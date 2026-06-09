# Liev Brief: Browser Host Protocol 4 Hotfix

## Goal Unit Contract

One worker fixes one issue: make `OpenClaw Browser Host` Chrome extension compatible with gateway protocol 4, then prove the local gateway no longer rejects it with `code=1002 reason=protocol mismatch`.

## Repo

`https://github.com/veil-chow-fyaic/openclaw-browser-host-extension`

## Context Packet

The local gateway log repeatedly reports:

```text
client=OpenClaw Browser Host node v0.1.0-alpha.7
min=3 max=3
expected=4 probeMin=4
origin=chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf
code=1002 reason=protocol mismatch
```

This means gateway 2026.5.22 expects WebSocket protocol 4, while the Chrome extension currently advertises protocol 3 only.

Known source point:

- `extension/src/background.js`
- `NODE_PROTOCOL_VERSION = 3`
- `sendOpenClawNodeConnect()` sends `minProtocol` and `maxProtocol` from that constant.

Existing behavior to preserve:

- Device identity and Ed25519 signed connect.
- Pairing/device token persistence.
- `node.invoke.request`, `node.invoke.result`, `node.event`.
- Browser notification/current tab/page summary/downloads/confirm capabilities.
- Popup/options UX and Pattern Memory/page service work.

## Scope

- Update Browser Host extension protocol compatibility.
- Update docs and validation evidence.
- Package extension and provide browser/gateway validation.

## Forbidden

- Do not modify ACP adapter, ACP runtime, ACP delivery queue, or ACP file delivery.
- Do not modify WeCom channel, WeCom extension, or enterprise WeChat send/receive flow.
- Do not modify unrelated OpenClaw gateway code unless extension-side compatibility is impossible; record a blocker instead.
- Do not add Native Messaging, broad permissions, command execution, or secrets handling.
- Do not auto-merge.

## Definition Of Done

- PR opened.
- Static/package validation passes.
- Browser/gateway validation proves no new protocol mismatch for extension origin over 60 seconds, or records exact blocker.
- Linear issue has proof and is moved to `In Review`.
