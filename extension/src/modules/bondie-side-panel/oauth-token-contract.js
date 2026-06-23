const TOKEN_STATES = new Set([
  'authenticated',
  'identity_required',
  'token_expired',
  'token_refresh_failed',
  'provider_unconfigured'
]);

export function normalizeOAuthTokenState(payload, { now = new Date() } = {}) {
  const state = normalizeTokenState(payload?.state);
  const accessToken = cleanString(payload?.accessToken || payload?.access_token);
  const expiresAt = cleanString(payload?.expiresAt || payload?.expires_at || payload?.access_token_expires_at);
  const expiresSoon = isExpiresSoon(expiresAt, now);
  const expired = isExpired(expiresAt, now);
  const provider = cleanString(payload?.provider);
  const viewer = normalizeViewer(payload?.viewer);

  if (state === 'authenticated' && (!accessToken || expired)) {
    return {
      state: expired ? 'token_expired' : 'identity_required',
      authenticated: false,
      accessToken: '',
      provider,
      viewer,
      expiresAt,
      expiresSoon,
      error: expired ? 'token_expired' : 'missing_access_token'
    };
  }

  return {
    state,
    authenticated: state === 'authenticated',
    accessToken: state === 'authenticated' ? accessToken : '',
    provider,
    viewer: state === 'authenticated' ? viewer : null,
    expiresAt,
    expiresSoon,
    error: cleanString(payload?.error)
  };
}

export function publicOAuthTokenState(tokenState) {
  const normalized = normalizeOAuthTokenState(tokenState);
  return {
    state: normalized.state,
    authenticated: normalized.authenticated,
    provider: normalized.provider,
    viewer: normalized.viewer,
    expiresAt: normalized.expiresAt,
    expiresSoon: normalized.expiresSoon,
    error: normalized.error
  };
}

function normalizeTokenState(state) {
  const tokenState = cleanString(state);
  return TOKEN_STATES.has(tokenState) ? tokenState : 'identity_required';
}

function normalizeViewer(viewer) {
  if (!viewer || typeof viewer !== 'object') {
    return null;
  }
  const userId = cleanString(viewer.user_id || viewer.id || viewer.sub);
  if (!userId) {
    return null;
  }
  return {
    user_id: userId,
    display_name: cleanString(viewer.display_name || viewer.name) || userId,
    email: cleanString(viewer.email)
  };
}

function isExpired(expiresAt, now) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= now.getTime();
}

function isExpiresSoon(expiresAt, now) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs - now.getTime() <= 5 * 60 * 1000;
}

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}
