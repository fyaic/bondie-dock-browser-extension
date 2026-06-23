import {
  CONTROL_PLANE_ENDPOINTS,
  buildControlPlaneHeaders,
  buildControlPlaneUrl,
  isControlPlaneActionConfirmed,
  normalizeControlPlaneActionResult,
  normalizeControlPlaneIdentity,
  normalizeControlPlaneInstance,
  normalizeControlPlaneInstancesPayload,
  normalizeControlPlaneSessionsPayload
} from './control-plane-contract.js';

export class BondieControlPlaneAdapter {
  constructor({ config, accessToken = '', getAccessToken = null, fetchImpl = null } = {}) {
    this.config = config || {};
    this.accessToken = cleanString(accessToken);
    this.getAccessToken = typeof getAccessToken === 'function' ? getAccessToken : null;
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
  }

  async status() {
    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ok: false,
        state: readiness.state,
        error: readiness.error,
        message: readiness.message,
        controlPlane: publicReadiness(readiness),
        identity: normalizeControlPlaneIdentity(null)
      };
    }

    try {
      const payload = await this.fetchJson(CONTROL_PLANE_ENDPOINTS.me, { readiness });
      const identity = normalizeControlPlaneIdentity(payload);
      return {
        ok: identity.authenticated,
        state: identity.authenticated ? 'authenticated' : 'identity_required',
        controlPlane: publicReadiness(readiness),
        identity
      };
    } catch (error) {
      return this.errorResult(error, readiness, {
        identity: normalizeControlPlaneIdentity(null)
      });
    }
  }

  async listInstances() {
    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ok: false,
        state: readiness.state,
        error: readiness.error,
        message: readiness.message,
        controlPlane: publicReadiness(readiness),
        instances: []
      };
    }

    try {
      const payload = await this.fetchJson(CONTROL_PLANE_ENDPOINTS.instances, { readiness });
      const normalized = normalizeControlPlaneInstancesPayload(payload);
      return {
        ok: normalized.state === 'ready',
        state: normalized.state,
        controlPlane: publicReadiness(readiness),
        viewer: normalized.viewer,
        instances: normalized.instances,
        rawCount: normalized.rawCount,
        reason: normalized.reason
      };
    } catch (error) {
      return this.errorResult(error, readiness, { instances: [] });
    }
  }

  async listSessions(instanceContext) {
    const instance = normalizeControlPlaneInstance(instanceContext);
    if (!instance) {
      return invalidInstanceResult();
    }

    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ok: false,
        state: readiness.state,
        error: readiness.error,
        message: readiness.message,
        controlPlane: publicReadiness(readiness),
        instance,
        sessions: []
      };
    }

    try {
      const payload = await this.fetchJson(CONTROL_PLANE_ENDPOINTS.instanceSessions(instance.instance_id), { readiness });
      const normalized = normalizeControlPlaneSessionsPayload(payload, instance);
      return {
        ok: normalized.state === 'ready',
        state: normalized.state,
        controlPlane: publicReadiness(readiness),
        instance: normalized.instance,
        sessions: normalized.sessions,
        rawCount: normalized.rawCount,
        unresolved: normalized.unresolved,
        reason: normalized.reason
      };
    } catch (error) {
      return this.errorResult(error, readiness, {
        instance,
        sessions: []
      });
    }
  }

  async newConversation(instanceContext, options = {}) {
    const instance = normalizeControlPlaneInstance(instanceContext);
    if (!instance) {
      return invalidInstanceResult();
    }

    const readiness = await this.operationReadiness(instance);
    if (!readiness.ok) {
      return readiness.result;
    }

    try {
      const payload = await this.fetchJson(CONTROL_PLANE_ENDPOINTS.instanceNewSession(instance.instance_id), {
        method: 'POST',
        readiness: readiness.readiness,
        jsonBody: buildActionPayload(instance, options)
      });
      return this.operationResult(payload, 'new', instance, readiness.readiness);
    } catch (error) {
      return this.errorResult(error, readiness.readiness, { instance });
    }
  }

  async switchSession(instanceContext, sessionId, options = {}) {
    const instance = normalizeControlPlaneInstance(instanceContext);
    if (!instance) {
      return invalidInstanceResult();
    }

    const targetSessionId = cleanString(sessionId);
    if (!targetSessionId) {
      return {
        ok: false,
        state: 'missing_session_id',
        error: 'missing_session_id',
        message: 'Switch session requires a target session id',
        instance
      };
    }

    const readiness = await this.operationReadiness(instance);
    if (!readiness.ok) {
      return readiness.result;
    }

    try {
      const payload = await this.fetchJson(CONTROL_PLANE_ENDPOINTS.instanceSwitchSession(instance.instance_id), {
        method: 'POST',
        readiness: readiness.readiness,
        jsonBody: {
          ...buildActionPayload(instance, options),
          session_id: targetSessionId
        }
      });
      return this.operationResult(payload, 'switch', instance, readiness.readiness);
    } catch (error) {
      return this.errorResult(error, readiness.readiness, { instance });
    }
  }

  async operationReadiness(instance) {
    if (instance.actions_enabled === false) {
      return {
        ok: false,
        result: {
          ok: false,
          state: 'instance_action_unavailable',
          error: 'instance_action_unavailable',
          message: 'This Bondie instance does not allow session actions',
          instance
        }
      };
    }

    const readiness = await this.readiness();
    if (!readiness.ready) {
      return {
        ok: false,
        result: {
          ok: false,
          state: readiness.state,
          error: readiness.error,
          message: readiness.message,
          controlPlane: publicReadiness(readiness),
          instance
        }
      };
    }

    return { ok: true, readiness };
  }

  operationResult(payload, action, instance, readiness) {
    const result = normalizeControlPlaneActionResult(payload, action, instance);
    return {
      ok: true,
      state: isControlPlaneActionConfirmed(payload, action) ? 'action_confirmed' : 'action_unconfirmed',
      controlPlane: publicReadiness(readiness),
      instance,
      result
    };
  }

  async readiness() {
    const baseUrl = cleanString(this.config.sidePanelControlPlaneBaseUrl || this.config.controlPlaneBaseUrl);
    if (!baseUrl) {
      return {
        ready: false,
        state: 'permission_unresolved',
        error: 'control_plane_not_configured',
        message: 'Bondie Control Plane URL is not configured',
        baseUrlConfigured: false
      };
    }

    const accessToken = await this.readAccessToken();
    const headers = buildControlPlaneHeaders(accessToken);
    if (!headers) {
      return {
        ready: false,
        state: 'identity_required',
        error: 'identity_required',
        message: 'OAuth identity is required before reading Bondie sessions',
        baseUrlConfigured: true
      };
    }

    return {
      ready: true,
      state: 'ready',
      baseUrl,
      baseUrlConfigured: true,
      timeoutMs: normalizeTimeout(this.config.sidePanelControlPlaneTimeoutMs || this.config.sessionBridgeTimeoutMs),
      headers
    };
  }

  async readAccessToken() {
    if (this.accessToken) {
      return this.accessToken;
    }
    if (!this.getAccessToken) {
      return '';
    }

    try {
      return cleanString(await this.getAccessToken());
    } catch (_error) {
      return '';
    }
  }

  async fetchJson(path, { method = 'GET', readiness, jsonBody = null, query = null } = {}) {
    const resolvedReadiness = readiness || await this.readiness();
    if (!resolvedReadiness.ready) {
      throw createError(resolvedReadiness.error, resolvedReadiness.message);
    }

    const url = buildControlPlaneUrl(resolvedReadiness.baseUrl, path, query);
    if (!url) {
      throw createError('control_plane_path_invalid', 'Bondie Control Plane request path is invalid');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller && resolvedReadiness.timeoutMs > 0
      ? setTimeout(() => controller.abort(), resolvedReadiness.timeoutMs)
      : null;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: resolvedReadiness.headers,
        body: jsonBody ? JSON.stringify(jsonBody) : undefined,
        signal: controller?.signal
      });

      if (!response?.ok) {
        throw createError(
          'control_plane_http_error',
          `Bondie Control Plane returned HTTP ${response?.status || 'error'}`,
          response?.status
        );
      }

      if (typeof response.json === 'function') {
        return await response.json();
      }

      const text = typeof response.text === 'function' ? await response.text() : '';
      return text ? JSON.parse(text) : {};
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw createError('control_plane_timeout', 'Bondie Control Plane request timed out');
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  errorResult(error, readiness, extra = {}) {
    return {
      ok: false,
      state: error.state || 'control_plane_unavailable',
      error: error.state || 'control_plane_unavailable',
      message: sanitizeError(error),
      controlPlane: publicReadiness(readiness),
      ...extra
    };
  }
}

function invalidInstanceResult() {
  return {
    ok: false,
    state: 'instance_unavailable',
    error: 'instance_unavailable',
    message: 'Bondie instance is unavailable',
    sessions: []
  };
}

function buildActionPayload(instance, options) {
  return compactObject({
    instance_id: instance.instance_id,
    message_card_style: cleanString(options.messageCardStyle || options.message_card_style) || 'friendly',
    source: 'browser-side-panel'
  });
}

function publicReadiness(readiness) {
  return {
    provider: 'bondie-control-plane',
    state: readiness?.state || 'unknown',
    ready: readiness?.ready === true,
    baseUrlConfigured: readiness?.baseUrlConfigured === true
  };
}

function createError(state, message, status = null) {
  const error = new Error(message || state);
  error.state = state;
  error.status = status;
  return error;
}

function sanitizeError(error) {
  return cleanString(error?.message) || 'Bondie Control Plane request failed';
}

function compactObject(value) {
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = cleanString(entry);
    if (text) {
      next[key] = text;
    }
  }
  return next;
}

function normalizeTimeout(value) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 20000;
  }
  return Math.max(1000, Math.min(timeoutMs, 120000));
}

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}
