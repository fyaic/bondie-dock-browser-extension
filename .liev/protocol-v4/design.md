# Design: OpenClaw Browser Host Protocol 4 Compatibility

Date: 2026-06-02

## Goal

Fix the OpenClaw Browser Host Chrome extension protocol mismatch with the local OpenClaw gateway.

Observed gateway log:

```text
client=OpenClaw Browser Host node v0.1.0-alpha.7
min=3 max=3
expected=4 probeMin=4
origin=chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf
code=1002 reason=protocol mismatch
```

## User Outcome

After the fix, the installed Chrome extension can connect to `ws://127.0.0.1:18789` without gateway `protocol mismatch` noise, and browser-side OpenClaw capabilities remain usable.

## Scope

- Target repo: `fyaic/openclaw-browser-host-extension`.
- Target local repo: `/Users/fuyo-aic/Projects/openclaw-browser-host-extension`.
- Extension id in the failing install: `cljflebfgmekmnojaiaonfdjcmoonbpf`.
- Update Browser Host extension protocol declaration/handshake to support gateway protocol 4.
- Preserve existing pairing, device token, Ed25519 signing, invoke/result, `node.event`, popup/options, and browser workflow features.
- Update docs/runbook to state the gateway protocol 4 compatibility expectation.
- Package and validate the extension.

## Out Of Scope

- ACP adapter, ACP projects, ACP file delivery, ACP queue.
- WeCom channel, WeCom extension, enterprise WeChat receive/send flow.
- OpenClaw gateway server implementation unless the extension-side fix is proven impossible; in that case record a blocker instead of editing gateway code.
- Delivery queue, IM bridge, Side Panel multi-bridge work.
- Native Messaging or new local command execution.
- Store publishing, branding, or unrelated UX work.

## Architecture Notes

- Original alpha.7 code declared `const NODE_PROTOCOL_VERSION = 3`.
- alpha.11 declares protocol 4 and sends both `minProtocol` and `maxProtocol` as 4.
- The follow-up fix also replaced node-role RPC `ping` heartbeat with `node.event` / `node.presence.alive`.
- Current validation should check both the old protocol mismatch and the later node-role heartbeat authorization error.
- If gateway protocol 4 requires payload shape changes beyond the version number, implement only the Browser Host extension-side compatibility needed for connect/pair/invoke smoke.

## Risks

- Blindly changing only the number may pass the initial gate but fail later if protocol 4 changed auth or invoke semantics.
- Over-broad transport rewrites can regress existing Browser Host features.
- Local Chrome validation can be blocked if the extension cannot be reloaded or gateway is not running.

## Locked Decisions

- Do not touch ACP, WeCom, or delivery queue repos.
- Do not edit `main` directly.
- Do not add broad permissions such as default `<all_urls>`.
- Auto-merge is disabled.
