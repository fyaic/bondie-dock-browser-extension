const RELATIONSHIP_LABELS = Object.freeze({
  subordinate: '从属关系',
  communication: '沟通关系'
});

const VISIBILITY_LABELS = Object.freeze({
  all_sessions: '查看全部',
  participant_sessions: '仅相关'
});

const RELATIONSHIP_VISIBILITY = Object.freeze({
  subordinate: 'all_sessions',
  communication: 'participant_sessions'
});

export const CONTROL_PLANE_ENDPOINTS = Object.freeze({
  me: '/v1/me',
  instances: '/v1/bondie-instances',
  instanceSessions: (instanceId) => buildInstancePath(instanceId, 'sessions'),
  instanceNewSession: (instanceId) => buildInstancePath(instanceId, 'sessions/new'),
  instanceSwitchSession: (instanceId) => buildInstancePath(instanceId, 'sessions/switch')
});

export function buildControlPlaneHeaders(accessToken, extraHeaders = {}) {
  const token = cleanString(accessToken);
  if (!token) {
    return null;
  }

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...filterHeaderObject(extraHeaders),
    Authorization: `Bearer ${token}`
  };
}

export function buildControlPlaneUrl(baseUrl, path, query = {}) {
  const base = cleanString(baseUrl);
  const relativePath = cleanString(path);
  if (!base || !relativePath) {
    return '';
  }

  try {
    const url = new URL(base.endsWith('/') ? base : `${base}/`);
    const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    const nextPath = `${basePath}${relativePath.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
    url.pathname = nextPath;
    url.search = '';
    url.hash = '';

    for (const [key, value] of Object.entries(query || {})) {
      const text = cleanString(value);
      if (text) {
        url.searchParams.set(key, text);
      }
    }
    return url.toString();
  } catch (_error) {
    return '';
  }
}

export function normalizeControlPlaneIdentity(payload) {
  const source = payload?.viewer || payload?.user || payload || {};
  const userId = cleanString(source.user_id || source.id || source.sub);
  const authenticated = Boolean(userId && (
    payload?.authenticated === true
    || cleanString(payload?.status) === 'authenticated'
    || payload?.anonymous !== true
  ));

  return {
    authenticated,
    source: cleanString(payload?.source) || 'oauth',
    reason: authenticated ? '' : cleanString(payload?.reason) || 'identity_required',
    viewer: authenticated
      ? {
        user_id: userId,
        display_name: cleanString(source.display_name || source.name) || userId,
        email: cleanString(source.email),
        avatar_url: cleanString(source.avatar_url || source.avatarUrl)
      }
      : null
  };
}

export function normalizeControlPlaneInstancesPayload(payload) {
  const instances = safeArray(payload?.instances || payload)
    .map(normalizeControlPlaneInstance)
    .filter(Boolean);

  return {
    provider: 'bondie-control-plane',
    state: instances.length > 0 ? 'ready' : cleanString(payload?.state) || 'permission_unresolved',
    viewer: normalizeControlPlaneIdentity(payload?.viewer || payload?.identity),
    instances,
    rawCount: instances.length,
    reason: instances.length > 0 ? '' : cleanString(payload?.reason) || 'no_permitted_instances'
  };
}

export function normalizeControlPlaneInstance(instance) {
  if (!instance || typeof instance !== 'object') {
    return null;
  }

  const instanceId = cleanString(instance.instance_id || instance.id);
  const relationshipType = normalizeRelationshipType(instance.relationship_type || instance.relationship);
  const visibilityPolicy = normalizeVisibilityPolicy(instance.visibility_policy || instance.visibility, relationshipType);
  if (!instanceId || !relationshipType || !visibilityPolicy) {
    return null;
  }

  const status = cleanString(instance.status || instance.health || instance.bridge_status) || 'unknown';
  const actionsEnabled = instance.actions_enabled === false
    ? false
    : instance.can_switch_session !== false && instance.can_create_session !== false && status !== 'offline';

  return {
    instance_id: instanceId,
    display_name: cleanString(instance.display_name || instance.name) || instanceId,
    relationship_type: relationshipType,
    relationship_label: RELATIONSHIP_LABELS[relationshipType],
    visibility_policy: visibilityPolicy,
    visibility_label: VISIBILITY_LABELS[visibilityPolicy],
    roles: safeArray(instance.roles).map(cleanString).filter(Boolean),
    owner_user_id: cleanString(instance.owner_user_id || instance.ownerUserId),
    workspace_id: cleanString(instance.workspace_id || instance.workspaceId),
    organization: cleanString(instance.organization),
    bridge_id: cleanString(instance.bridge_id || instance.bridgeId),
    status,
    capabilities: safeArray(instance.capabilities).map(cleanString).filter(Boolean),
    actions_enabled: actionsEnabled
  };
}

export function normalizeControlPlaneSessionsPayload(payload, instanceContext) {
  const instance = normalizeControlPlaneInstance(payload?.instance || instanceContext);
  if (!instance) {
    return {
      provider: 'bondie-control-plane',
      state: 'permission_unresolved',
      instance: null,
      sessions: [],
      rawCount: 0,
      unresolved: true,
      reason: 'instance_permission_invalid'
    };
  }

  const sessions = safeArray(payload?.sessions || payload)
    .map((session) => normalizeControlPlaneSession(session, instance))
    .filter(Boolean);

  return {
    provider: 'bondie-control-plane',
    state: cleanString(payload?.state) || 'ready',
    instance,
    sessions,
    rawCount: sessions.length,
    unresolved: sessions.length === 0 && cleanString(payload?.reason) === 'permission_unresolved',
    reason: cleanString(payload?.reason)
  };
}

export function normalizeControlPlaneActionResult(payload, action, instanceContext) {
  const instance = normalizeControlPlaneInstance(payload?.instance || instanceContext);
  return {
    action: cleanString(action),
    provider: 'bondie-control-plane',
    instance,
    confirmed: isControlPlaneActionConfirmed(payload, action),
    operationStatus: cleanString(payload?.operation_status || payload?.status),
    operationWarning: cleanString(payload?.operation_warning || payload?.warning),
    deliveryStatus: cleanString(payload?.delivery_status),
    deliveryOwner: cleanString(payload?.delivery_owner),
    deliveryTransport: cleanString(payload?.delivery_transport),
    session: normalizeControlPlaneSession(payload?.session, instance),
    binding: normalizeBinding(payload?.binding),
    messageCard: normalizeMessageCard(payload?.message_card || payload?.messageCard),
    raw: {
      new_conversation_confirmed: payload?.new_conversation_confirmed === true,
      session_switch_confirmed: payload?.session_switch_confirmed === true,
      route_switch_confirmed: payload?.route_switch_confirmed === true,
      user_visible_confirmation: payload?.user_visible_confirmation === true
    }
  };
}

export function isControlPlaneActionConfirmed(payload, action) {
  const normalizedAction = cleanString(action);
  if (normalizedAction === 'new') {
    return payload?.new_conversation_confirmed === true;
  }
  if (normalizedAction === 'switch') {
    return payload?.session_switch_confirmed === true || payload?.route_switch_confirmed === true;
  }
  return false;
}

function normalizeControlPlaneSession(session, instance) {
  if (!session || typeof session !== 'object' || !instance) {
    return null;
  }

  const sessionId = cleanString(session.session_id || session.id);
  const sessionKey = cleanString(session.session_key || session.key);
  if (!sessionId && !sessionKey) {
    return null;
  }

  return {
    session_id: sessionId,
    session_key: sessionKey,
    title: cleanString(session.title) || cleanString(session.summary) || 'Bondie session',
    summary: cleanString(session.summary),
    updated_at: cleanString(session.updated_at || session.updatedAt),
    model: cleanString(session.model),
    project: cleanString(session.project),
    generation_type: cleanString(session.generation_type),
    is_current: session.is_current === true,
    restorable: session.restorable !== false && instance.actions_enabled !== false,
    empty: session.empty === true,
    context_window: safeNumber(session.context_window ?? session.contextWindow),
    context_used: safeNumber(session.context_used ?? session.contextUsed ?? session.tokens),
    last_messages: safeArray(session.last_messages || session.lastMessages).slice(0, 3),
    instance_id: instance.instance_id,
    instance_name: instance.display_name,
    relationship_type: instance.relationship_type,
    relationship_label: instance.relationship_label,
    visibility_policy: instance.visibility_policy,
    visibility_label: instance.visibility_label,
    actions_enabled: instance.actions_enabled
  };
}

function normalizeRelationshipType(value) {
  const relationshipType = cleanString(value);
  return Object.prototype.hasOwnProperty.call(RELATIONSHIP_LABELS, relationshipType)
    ? relationshipType
    : '';
}

function normalizeVisibilityPolicy(value, relationshipType) {
  const visibilityPolicy = cleanString(value);
  if (!Object.prototype.hasOwnProperty.call(VISIBILITY_LABELS, visibilityPolicy)) {
    return '';
  }
  return RELATIONSHIP_VISIBILITY[relationshipType] === visibilityPolicy ? visibilityPolicy : '';
}

function normalizeBinding(binding) {
  if (!binding || typeof binding !== 'object') {
    return null;
  }
  return {
    session_id: cleanString(binding.session_id),
    session_key: cleanString(binding.session_key),
    updated_at: cleanString(binding.updated_at || binding.updatedAt)
  };
}

function normalizeMessageCard(card) {
  if (!card || typeof card !== 'object') {
    return null;
  }
  return {
    title: cleanString(card.title),
    text: cleanString(card.text)
  };
}

function filterHeaderObject(headers) {
  const filtered = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = cleanString(key);
    const text = cleanString(value);
    if (name && text && name.toLowerCase() !== 'authorization') {
      filtered[name] = text;
    }
  }
  return filtered;
}

function encodePathSegment(value) {
  return encodeURIComponent(cleanString(value));
}

function buildInstancePath(instanceId, suffix) {
  const encodedInstanceId = encodePathSegment(instanceId);
  const normalizedSuffix = cleanString(suffix).replace(/^\/+/, '');
  if (!encodedInstanceId || !normalizedSuffix) {
    return '';
  }
  return `/v1/bondie-instances/${encodedInstanceId}/${normalizedSuffix}`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
