export function buildSessionBridgeQuery(scope) {
  const operatorId = cleanString(scope.operator_id) || cleanString(scope.device_id) || 'browser-host';
  const routeKey = cleanString(scope.route_key);
  const routeType = cleanString(scope.route_type) || 'browser';
  const workspaceId = cleanString(scope.workspace_id) || 'default';
  const routeLabel = cleanString(scope.route_label) || 'Browser';

  return compactObject({
    wecom_user_id: operatorId,
    external_user_id: routeKey,
    conversation_key: routeKey,
    account_id: workspaceId,
    organization: workspaceId,
    chat_type: routeType,
    chat_label: routeLabel,
    operator_display_name: operatorId,
    operator_name: operatorId,
    operator_alias: operatorId
  });
}

export function buildSessionBridgeActionPayload(scope, options = {}) {
  const payload = buildSessionBridgeQuery(scope);
  const messageCardStyle = cleanString(options.messageCardStyle || options.message_card_style) || 'friendly';
  return {
    ...payload,
    message_card_style: messageCardStyle
  };
}

export function normalizeSessionsPayload(payload) {
  const sessions = Array.isArray(payload?.sessions)
    ? payload.sessions.map(normalizeSession).filter(Boolean)
    : [];

  return {
    bridgeId: cleanString(payload?.bridge_id),
    currentBinding: normalizeCurrentBinding(payload?.current_binding),
    sessions,
    rawCount: sessions.length,
    unresolved: isUnresolvedPayload(payload, sessions)
  };
}

export function normalizeOperationResult(payload, action) {
  return {
    action,
    bridgeId: cleanString(payload?.bridge_id),
    confirmed: action === 'new'
      ? isNewConversationConfirmed(payload)
      : isRouteSwitchConfirmed(payload),
    operationStatus: cleanString(payload?.operation_status),
    operationWarning: cleanString(payload?.operation_warning),
    deliveryStatus: cleanString(payload?.delivery_status),
    deliveryOwner: cleanString(payload?.delivery_owner),
    deliveryTransport: cleanString(payload?.delivery_transport),
    session: normalizeSession(payload?.session),
    binding: normalizeCurrentBinding(payload?.binding),
    messageCard: normalizeMessageCard(payload?.message_card),
    raw: {
      new_conversation_confirmed: payload?.new_conversation_confirmed === true,
      route_switch_confirmed: payload?.route_switch_confirmed === true,
      user_visible_confirmation: payload?.user_visible_confirmation === true
    }
  };
}

export function isNewConversationConfirmed(result) {
  return result?.new_conversation_confirmed === true;
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

export function isRouteSwitchConfirmed(result) {
  return result?.route_switch_confirmed === true;
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') {
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
    title: cleanString(session.title) || cleanString(session.summary) || 'OpenClaw session',
    summary: cleanString(session.summary),
    updated_at: cleanString(session.updated_at || session.updatedAt),
    model: cleanString(session.model),
    project: cleanString(session.project),
    generation_type: cleanString(session.generation_type),
    is_current: session.is_current === true,
    restorable: session.restorable !== false,
    empty: session.empty === true,
    context_window: safeNumber(session.context_window ?? session.contextWindow),
    context_used: safeNumber(session.context_used ?? session.contextUsed ?? session.tokens),
    last_messages: Array.isArray(session.last_messages) ? session.last_messages.slice(0, 3) : []
  };
}

function normalizeCurrentBinding(binding) {
  if (!binding || typeof binding !== 'object') {
    return null;
  }
  return {
    session_id: cleanString(binding.session_id),
    session_key: cleanString(binding.session_key),
    updated_at: cleanString(binding.updated_at || binding.updatedAt)
  };
}

function isUnresolvedPayload(payload, sessions) {
  const reason = cleanString(payload?.debug?.reason);
  if (reason === 'request_missing_wecom_scope' || reason === 'route_unresolved') {
    return true;
  }
  return sessions.length === 0 && Array.isArray(payload?.debug?.missing_scope_fields) && payload.debug.missing_scope_fields.length > 0;
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

function cleanString(value) {
  return String(value || '').trim();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
