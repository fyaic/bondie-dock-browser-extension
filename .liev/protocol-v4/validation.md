# Validation: Browser Host Protocol 4 Hotfix

## Static / Package

- [ ] `python3 -m json.tool "extension/manifest.json" >/dev/null`
- [ ] `node --check "extension/src/background.js"`
- [ ] `node --check "extension/src/content.js"`
- [ ] `node --check "extension/src/options.js"`
- [ ] `node --check "extension/src/popup.js"`
- [ ] `node --check "extension/src/confirm.js"`
- [ ] Optional existing files checked:
  - `extension/src/history.js`
  - `extension/src/pattern-memory.js`
- [ ] `./scripts/package-extension.sh`

## Browser Extension Gate

- [ ] Unpacked extension reloads in Chrome.
- [ ] Extension id remains `cljflebfgmekmnojaiaonfdjcmoonbpf` for the local installed instance, or changed id is documented.
- [ ] Popup still opens and reports a coherent connection state.
- [ ] No default `<all_urls>` or new broad permission is introduced.

## Gateway Gate

- [ ] Before/after log window recorded from `~/.openclaw/logs/gateway.err.log`.
- [ ] After reload and 60 seconds, no new line contains both:
  - `protocol mismatch`
  - `chrome-extension://cljflebfgmekmnojaiaonfdjcmoonbpf`
- [ ] If gateway is unavailable, record the exact blocker and do not claim pass.

## Final Handoff

- [ ] PR URL recorded in Linear.
- [ ] Validation output summarized in PR.
- [ ] Browser/gateway proof or blocker included.
- [ ] Issue moved to `In Review` only after evidence.
