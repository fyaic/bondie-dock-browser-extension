import {
  buildSessionBridgeActionPayload,
  buildSessionBridgeQuery,
  normalizeOperationResult,
  normalizeSessionsPayload
} from './contract.js';

export class OpenClawSessionAdapter {
  constructor({ config, chromeApi, fetchImpl = fetch } = {}) {
    this.config = config || {};
    this.chrome = chromeApi;
    this.fetchImpl = fetchImpl;
  }

  async status() {
    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ...readiness,
        available: false,
        health: null,
        metadata: null
      };
    }

    try {
      const [health, metadata] = await Promise.all([
        this.fetchJson('/health', { protected: false }),
        this.fetchJson('/v1/bridge', { protected: true })
      ]);

      return {
        ...readiness,
        state: 'available',
        available: true,
        health: normalizeHealth(health),
        metadata: normalizeMetadata(metadata)
      };
    } catch (error) {
      return {
        ...readiness,
        state: error.state || 'unavailable',
        available: false,
        health: null,
        metadata: null,
        error: sanitizeError(error)
      };
    }
  }

  async listSessions(scope) {
    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ok: false,
        state: readiness.state,
        error: readiness.state,
        message: readiness.message,
        bridge: readiness
      };
    }

    const scopeCheck = validateScope(scope);
    if (!scopeCheck.valid) {
      return {
        ok: false,
        state: 'scope_unresolved',
        error: 'scope_unresolved',
        message: scopeCheck.message,
        bridge: readiness,
        sessions: []
      };
    }

    try {
      const query = buildSessionBridgeQuery(scope);
      const payload = await this.fetchJson(`/v1/sessions?${new URLSearchParams(query).toString()}`, {
        protected: true
      });
      const normalized = normalizeSessionsPayload(payload);
      const state = normalized.unresolved
        ? 'scope_unresolved'
        : normalized.sessions.length
          ? 'ready'
          : 'empty_sessions';

      return {
        ok: true,
        state,
        bridge: readiness,
        sessions: normalized.sessions,
        currentBinding: normalized.currentBinding,
        bridgeId: normalized.bridgeId,
        rawCount: normalized.rawCount,
        unresolved: normalized.unresolved
      };
    } catch (error) {
      return {
        ok: false,
        state: error.state || 'bridge_unavailable',
        error: error.state || 'bridge_unavailable',
        message: sanitizeError(error),
        bridge: readiness,
        sessions: []
      };
    }
  }

  async newConversation(scope, options = {}) {
    const gate = await this.operationGate(scope);
    if (!gate.ok) {
      return gate.result;
    }

    try {
      const payload = buildSessionBridgeActionPayload(scope, options);
      const result = await this.fetchJson('/v1/sessions/new', {
        method: 'POST',
        protected: true,
        jsonBody: payload
      });
      return {
        ok: true,
        state: result?.new_conversation_confirmed === true ? 'action_confirmed' : 'action_unconfirmed',
        bridge: gate.readiness,
        result: normalizeOperationResult(result, 'new')
      };
    } catch (error) {
      return this.operationError(error, gate.readiness);
    }
  }

  async switchSession(scope, sessionId, options = {}) {
    const targetSessionId = cleanString(sessionId);
    if (!targetSessionId) {
      return {
        ok: false,
        state: 'missing_session_id',
        error: 'missing_session_id',
        message: 'Switch session requires a target session id',
        sessions: []
      };
    }

    const gate = await this.operationGate(scope);
    if (!gate.ok) {
      return gate.result;
    }

    try {
      const payload = {
        ...buildSessionBridgeActionPayload(scope, options),
        session_id: targetSessionId
      };
      const result = await this.fetchJson('/v1/switch-session', {
        method: 'POST',
        protected: true,
        jsonBody: payload
      });
      return {
        ok: true,
        state: result?.route_switch_confirmed === true ? 'action_confirmed' : 'action_unconfirmed',
        bridge: gate.readiness,
        result: normalizeOperationResult(result, 'switch')
      };
    } catch (error) {
      return this.operationError(error, gate.readiness);
    }
  }

  async operationGate(scope) {
    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ok: false,
        result: {
          ok: false,
          state: readiness.state,
          error: readiness.state,
          message: readiness.message,
          bridge: readiness
        }
      };
    }

    const scopeCheck = validateScope(scope);
    if (!scopeCheck.valid) {
      return {
        ok: false,
        result: {
          ok: false,
          state: 'scope_unresolved',
          error: 'scope_unresolved',
          message: scopeCheck.message,
          bridge: readiness
        }
      };
    }

    return { ok: true, readiness };
  }

  operationError(error, readiness) {
    return {
      ok: false,
      state: error.state || 'bridge_unavailable',
      error: error.state || 'bridge_unavailable',
      message: sanitizeError(error),
      bridge: readiness
    };
  }

  async readiness() {
    const baseUrl = cleanString(this.config.sessionBridgeBaseUrl);
    const token = cleanString(this.config.sessionBridgeToken);
    const timeoutMs = normalizeTimeout(this.config.sessionBridgeTimeoutMs);
    const permissionOrigin = originPattern(baseUrl);

    if (!baseUrl) {
      return {
        ready: false,
        state: 'missing_base_url',
        message: 'Session Bridge URL is not configured',
        baseUrlConfigured: false,
        authConfigured: Boolean(token),
        permission: buildPermissionState(permissionOrigin, false),
        timeoutMs
      };
    }

    if (!token) {
      return {
        ready: false,
        state: 'missing_auth',
        message: 'Session Bridge token is not configured',
        baseUrlConfigured: true,
        authConfigured: false,
        permission: buildPermissionState(permissionOrigin, false),
        timeoutMs
      };
    }

    if (!permissionOrigin) {
      return {
        ready: false,
        state: 'invalid_base_url',
        message: 'Session Bridge URL must use http or https',
        baseUrlConfigured: true,
        authConfigured: true,
        permission: buildPermissionState(permissionOrigin, false),
        timeoutMs
      };
    }

    const hasPermission = await hasOriginPermission(this.chrome, permissionOrigin);
    if (!hasPermission) {
      return {
        ready: false,
        state: 'permission_required',
        message: 'Session Bridge host permission is required',
        baseUrlConfigured: true,
        authConfigured: true,
        permission: buildPermissionState(permissionOrigin, true),
        timeoutMs
      };
    }

    return {
      ready: true,
      state: 'configured',
      message: '',
      baseUrlConfigured: true,
      authConfigured: true,
      permission: buildPermissionState(permissionOrigin, true, true),
      timeoutMs
    };
  }

  async fetchJson(path, { method = 'GET', protected: protectedEndpoint, jsonBody = null }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizeTimeout(this.config.sessionBridgeTimeoutMs));
    const headers = {
      Accept: 'application/json'
    };
    if (protectedEndpoint) {
      headers.Authorization = `Bearer ${cleanString(this.config.sessionBridgeToken)}`;
    }
    if (jsonBody) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await this.fetchImpl(joinUrl(this.config.sessionBridgeBaseUrl, path), {
        method,
        headers,
        body: jsonBody ? JSON.stringify(jsonBody) : undefined,
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) {
        throw httpError(response.status);
      }
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw adapterError('timeout', 'Session Bridge request timed out');
      }
      if (error.state) {
        throw error;
      }
      throw adapterError('fetch_failed', error.message || 'Session Bridge request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeHealth(payload) {
  return {
    ok: payload?.status === 'ok',
    bridgeId: cleanString(payload?.bridge_id),
    adapter: normalizeAdapter(payload?.adapter)
  };
}

function normalizeMetadata(payload) {
  return {
    bridgeId: cleanString(payload?.bridge_id),
    bridgeName: cleanString(payload?.bridge_name),
    adapter: normalizeAdapter(payload?.adapter),
    capabilities: Array.isArray(payload?.capabilities) ? payload.capabilities.map(cleanString).filter(Boolean) : []
  };
}

function normalizeAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    return null;
  }
  return {
    adapter: cleanString(adapter.adapter),
    ready: adapter.ready === true
  };
}

function validateScope(scope) {
  const missing = [];
  for (const key of ['workspace_id', 'route_type', 'route_key', 'device_id', 'operator_id']) {
    if (!cleanString(scope?.[key])) {
      missing.push(key);
    }
  }
  return {
    valid: missing.length === 0,
    message: missing.length ? `Missing scope fields: ${missing.join(', ')}` : ''
  };
}

function joinUrl(baseUrl, path) {
  const url = new URL(path, ensureTrailingSlash(baseUrl));
  return url.toString();
}

function ensureTrailingSlash(value) {
  const text = cleanString(value);
  return text.endsWith('/') ? text : `${text}/`;
}

function originPattern(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return `${url.origin}/*`;
  } catch {
    return '';
  }
}

async function hasOriginPermission(chromeApi, origin) {
  if (!origin || !chromeApi?.permissions?.contains) {
    return false;
  }
  return await new Promise((resolve) => {
    chromeApi.permissions.contains({ origins: [origin] }, (result) => resolve(Boolean(result)));
  });
}

function buildPermissionState(origin, required, granted = false) {
  return {
    required,
    granted,
    origin: origin || ''
  };
}

function httpError(status) {
  if (status === 401 || status === 403) {
    return adapterError('unauthorized', 'Session Bridge rejected the configured token');
  }
  return adapterError('http_error', `Session Bridge returned HTTP ${status}`);
}

function adapterError(state, message) {
  const error = new Error(message);
  error.state = state;
  return error;
}

function sanitizeError(error) {
  return cleanString(error?.message || error)
    .replace(/(token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"',\s]+/gi, '$1[redacted]');
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) {
    return 20000;
  }
  return Math.max(1000, Math.min(timeout, 120000));
}

function cleanString(value) {
  return String(value || '').trim();
}
