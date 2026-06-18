# OAuth Token Interface

日期：2026-06-18

## 目标

在不绑定具体 OAuth provider 的前提下，定义浏览器 extension 内部如何向 `BondieControlPlaneAdapter` 提供用户令牌。

真实 provider 仍待决策：

- OpenClaw 账号。
- AIC 账号。
- 独立身份服务。

本文只冻结接口和安全边界。

## 原则

- OAuth user identity 是生产权限前置，device pairing 不能替代。
- token 只属于 background/adapter 层，不进入普通 UI payload。
- Options 不提供“手工粘贴生产 OAuth token”作为多 Bondie 方案。
- access token 不写入 operation card、history、diagnostics、console-safe payload。
- refresh token 如需持久化，必须使用受控 token store，并有清除/过期策略。

## Background Context Interface

Feature module 未来需要从 background context 读取 OAuth token provider，而不是直接读 storage key：

```js
context.getSidePanelOAuthToken = async () => ({
  state: 'authenticated',
  accessToken: '<redacted>',
  expiresAt: '2026-06-18T10:00:00Z',
  provider: 'openclaw',
  viewer: {
    user_id: 'veil',
    display_name: 'Veil'
  }
});
```

未登录：

```js
context.getSidePanelOAuthToken = async () => ({
  state: 'identity_required',
  accessToken: '',
  provider: '',
  viewer: null
});
```

失败：

```js
context.getSidePanelOAuthToken = async () => ({
  state: 'token_refresh_failed',
  accessToken: '',
  provider: 'openclaw',
  viewer: null,
  error: 'refresh_failed'
});
```

## State

| state | 含义 | Side Panel 行为 |
|---|---|---|
| `authenticated` | token 可用 | 可调用 Control Plane |
| `identity_required` | 未登录 | 不列 sessions/instances |
| `token_expired` | token 过期，尚未刷新 | 尝试 refresh；失败后不列 sessions |
| `token_refresh_failed` | refresh 失败 | 显示重新登录入口 |
| `provider_unconfigured` | provider 未配置 | 保持 fail closed |

## Adapter Wiring

`BondieControlPlaneAdapter` 已支持 provider-neutral token callback：

```js
new BondieControlPlaneAdapter({
  config,
  getAccessToken: async () => {
    const tokenState = await context.getSidePanelOAuthToken();
    return tokenState.state === 'authenticated' ? tokenState.accessToken : '';
  },
  fetchImpl
});
```

当前 runtime 仍不接入此路径。接入条件必须同时满足：

- `sidePanelIdentityMode === 'oauth'`
- `sidePanelInstanceProvider === 'bondie-control-plane'`
- `context.getSidePanelOAuthToken` 存在并返回 `authenticated`
- `sidePanelControlPlaneBaseUrl` 已配置

否则返回 `identity_required` 或 `permission_unresolved`。

## Chrome OAuth Flow 方向

Chrome/Edge 优先考虑：

- OAuth Authorization Code + PKCE。
- `chrome.identity.launchWebAuthFlow` 或等价外部浏览器回跳。
- redirect URL 绑定 extension id 或受控 HTTPS callback。
- scopes 最小化：只拿 `openid profile` 和 Control Plane 所需 API scope。

Safari 需要后续单独评估，因为 extension identity API 不同。

## Token Storage

建议：

- access token 只短期缓存。
- refresh token 如必须持久化，使用 `chrome.storage.local` 时必须加 provider、expires、rotation metadata，并提供清除入口。
- 不把 token 放入 `sync` storage。
- 不把 token 放入 Options 文本框。
- logout 清除 provider token、viewer cache、Control Plane cached instances。

最小结构：

```json
{
  "provider": "openclaw",
  "access_token": "<secret>",
  "access_token_expires_at": "2026-06-18T10:00:00Z",
  "refresh_token_ref": "<secret-or-ref>",
  "viewer": {
    "user_id": "veil",
    "display_name": "Veil"
  },
  "updated_at": "2026-06-18T09:00:00Z"
}
```

普通 diagnostics 只能展示：

```json
{
  "provider": "openclaw",
  "authenticated": true,
  "expiresSoon": false,
  "viewer": {
    "user_id": "veil",
    "display_name": "Veil"
  }
}
```

## UI Entry

Side Panel 可以出现：

- “登录 Bondie”按钮。
- 登录状态 chip。
- “重新登录”按钮。
- “退出登录”按钮。

不做：

- 不在 Side Panel 展示 raw token。
- 不在 Options 展示 token。
- 不把登录失败自动 fallback 到 legacy Bridge。

## Fail-closed Rules

- provider 未配置：`provider_unconfigured`。
- OAuth popup 被取消：`identity_required`。
- token refresh 失败：`token_refresh_failed`。
- `/v1/me` 返回非 authenticated：`identity_required`。
- viewer 与 cached viewer 不一致：清空 cached instances，重新拉取。
- logout 后立即清空 instances/sessions projection。

## 下一步实现顺序

1. 在 background context 增加 `getSidePanelOAuthToken` stub，默认返回 `provider_unconfigured`。已完成。
2. 增加 provider-neutral token state normalizer 和 tests。
3. 选择 OAuth provider 后接入 PKCE login flow。
4. 将 `BondieControlPlaneAdapter` 接入 `module.js`，但只在 OAuth authenticated 后启用。
5. Chrome for Testing 验证未登录、登录、refresh failed、logout 四条路径。
