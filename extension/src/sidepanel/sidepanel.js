const elements = {
  panelState: document.getElementById('panelState'),
  refresh: document.getElementById('refresh'),
  openOptions: document.getElementById('openOptions'),
  stateKicker: document.getElementById('stateKicker'),
  stateTitle: document.getElementById('stateTitle'),
  stateSummary: document.getElementById('stateSummary'),
  pairingValue: document.getElementById('pairingValue'),
  onlineValue: document.getElementById('onlineValue'),
  moduleValue: document.getElementById('moduleValue'),
  bridgeValue: document.getElementById('bridgeValue'),
  scopeHint: document.getElementById('scopeHint'),
  workspaceValue: document.getElementById('workspaceValue'),
  routeValue: document.getElementById('routeValue'),
  deviceValue: document.getElementById('deviceValue'),
  actionHint: document.getElementById('actionHint'),
  bridgePermission: document.getElementById('bridgePermission'),
  sessionsEmpty: document.getElementById('sessionsEmpty'),
  sessionsList: document.getElementById('sessionsList'),
  newSession: document.getElementById('newSession'),
  switchSession: document.getElementById('switchSession'),
  operationResult: document.getElementById('operationResult'),
  phaseValue: document.getElementById('phaseValue'),
  nextStep: document.getElementById('nextStep'),
  diagnosticsOutput: document.getElementById('diagnosticsOutput')
};

const STATE_COPY = {
  disabled: {
    kicker: '模块已禁用',
    title: 'Side Panel 当前未启用',
    summary: '打开设置或本地配置后，后台模块会重新接管状态。'
  },
  unpaired: {
    kicker: '等待配对',
    title: '先完成 OpenClaw 设备配对',
    summary: 'Browser Host 已准备好，但还没有可信设备身份可用于会话 scope。'
  },
  offline: {
    kicker: '离线',
    title: 'OpenClaw 当前不在线',
    summary: '设备已有配对记录，恢复 Gateway 连接后会继续检查 Session Bridge。'
  },
  missing_config: {
    kicker: '缺少配置',
    title: 'Session Bridge 尚未配置',
    summary: '连接状态可用，下一步需要补齐 Bridge URL 和 token 才能列出 scoped sessions。'
  },
  bridge_permission_required: {
    kicker: '等待授权',
    title: '需要允许访问 Session Bridge',
    summary: '浏览器还没有授予 Bridge 地址访问权限。授权后才会发起 status/list 请求。'
  },
  bridge_unavailable: {
    kicker: 'Bridge 不可用',
    title: 'Session Bridge 暂时不可达',
    summary: '配置和配对已满足，但 Bridge 健康检查或元数据读取失败。'
  },
  scope_unresolved: {
    kicker: 'Scope 未解析',
    title: '当前 scope 没有可用会话',
    summary: 'Bridge 没有返回当前浏览器 scope 可访问的 OpenClaw 会话。'
  },
  empty_sessions: {
    kicker: '空列表',
    title: '当前 scope 暂无会话',
    summary: 'Session Bridge 已连接，但当前 workspace/route 下没有可展示的历史会话。'
  },
  ready: {
    kicker: 'Ready',
    title: 'Session Bridge 已接入',
    summary: '连接、配对、权限和 Bridge 状态都已满足，正在显示 scoped sessions。'
  },
  booting: {
    kicker: '启动中',
    title: '正在读取 OpenClaw 状态',
    summary: 'Side Panel 正在等待 background service worker 返回状态。'
  },
  error: {
    kicker: '读取失败',
    title: '无法读取 Side Panel 状态',
    summary: '后台暂时没有返回可用状态，稍后可重试。'
  }
};

let currentBridgePermissionOrigin = '';
let selectedSessionId = '';
let selectedSession = null;
let lastStatusPayload = null;
let lastSessionsPayload = null;

elements.refresh.addEventListener('click', () => refreshStatus());
elements.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
elements.bridgePermission.addEventListener('click', requestBridgePermission);
elements.newSession.addEventListener('click', requestNewSession);
elements.switchSession.addEventListener('click', requestSwitchSession);
elements.newSession.title = '新开对话会调用 Session Bridge，并按 new_conversation_confirmed 判断完成态';
elements.switchSession.title = '切换会话会调用 Session Bridge，并按 route_switch_confirmed 判断完成态';

refreshStatus();
setInterval(refreshStatus, 7000);

async function refreshStatus() {
  setLoading(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'sidePanel.status' });
    if (!response?.ok) {
      renderError(response?.error || 'Side Panel status unavailable');
      return;
    }
    lastStatusPayload = response.payload || {};
    renderStatus(lastStatusPayload);
    if (response.payload?.state === 'ready') {
      await refreshSessions();
    } else {
      renderSessions({ state: response.payload?.state || 'booting', sessions: [] });
    }
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoading(false);
  }
}

async function refreshSessions() {
  renderSessions({ state: 'loading_sessions', sessions: [] });
  const response = await chrome.runtime.sendMessage({ type: 'sidePanel.sessions.list' });
  if (!response?.ok) {
    renderSessions({
      state: 'bridge_unavailable',
      sessions: [],
      error: response?.error || 'Session list unavailable'
    });
    return;
  }
  const payload = response.payload || {};
  if (payload.state && payload.state !== 'ready') {
    renderStatus({
      ...(lastStatusPayload || {}),
      ...payload,
      module: lastStatusPayload?.module || {},
      connection: lastStatusPayload?.connection || {},
      phase: lastStatusPayload?.phase || {
        current: 'Phase 4: New and switch actions with confirmation gates',
        next: 'Phase 5: Page Context Dock'
      }
    });
  }
  lastSessionsPayload = payload;
  renderSessions(payload);
}

async function requestNewSession() {
  if (!canRunNewSession()) {
    renderOperation({
      state: 'failed',
      action: 'new',
      error: '当前状态不可新开对话'
    });
    return;
  }
  if (!window.confirm('确认新开 OpenClaw 对话？后续消息会进入新的会话代际。')) {
    return;
  }

  await runSessionAction({
    type: 'sidePanel.sessions.new',
    action: 'new'
  });
}

async function requestSwitchSession() {
  if (!selectedSessionId || !selectedSession || selectedSession.restorable === false) {
    renderOperation({
      state: 'failed',
      action: 'switch',
      error: '请选择一个可切换的会话'
    });
    return;
  }
  if (!window.confirm(`确认切换到「${sessionTitle(selectedSession)}」？`)) {
    return;
  }

  await runSessionAction({
    type: 'sidePanel.sessions.switch',
    action: 'switch',
    sessionId: selectedSessionId
  });
}

async function runSessionAction(message) {
  setActionLoading(true);
  renderOperation({
    state: 'running',
    action: message.action,
    result: { operationStatus: 'pending' }
  });
  try {
    const response = await chrome.runtime.sendMessage({
      type: message.type,
      sessionId: message.sessionId,
      messageCardStyle: 'friendly'
    });
    const payload = response?.payload || {};
    renderOperation(payload);
    if (payload.confirmed) {
      await refreshStatus();
    } else {
      updateActionButtons(lastSessionsPayload || {});
    }
  } catch (error) {
    renderOperation({
      state: 'failed',
      action: message.action,
      error: error.message
    });
  } finally {
    setActionLoading(false);
  }
}

async function requestBridgePermission() {
  if (!currentBridgePermissionOrigin || !chrome.permissions?.request) {
    renderSessions({
      state: 'bridge_permission_required',
      sessions: [],
      error: '当前浏览器不支持动态授权 Bridge 地址'
    });
    return;
  }

  const granted = await new Promise((resolve) => {
    chrome.permissions.request({ origins: [currentBridgePermissionOrigin] }, (result) => {
      resolve(Boolean(result));
    });
  });
  if (!granted) {
    renderSessions({
      state: 'bridge_permission_required',
      sessions: [],
      error: '授权未完成，暂不访问 Session Bridge'
    });
    return;
  }
  await refreshStatus();
}

function renderStatus(payload) {
  const state = payload.state || 'booting';
  const copy = STATE_COPY[state] || STATE_COPY.booting;
  const connection = payload.connection || {};
  const bridge = payload.bridge || {};
  const module = payload.module || {};
  const scope = payload.scope || {};

  currentBridgePermissionOrigin = bridge.permission?.origin || '';
  elements.panelState.textContent = stateLabel(state);
  elements.panelState.dataset.state = statusTone(state);
  elements.stateKicker.textContent = copy.kicker;
  elements.stateTitle.textContent = copy.title;
  elements.stateSummary.textContent = copy.summary;
  elements.pairingValue.textContent = pairingLabel(connection);
  elements.onlineValue.textContent = onlineLabel(connection);
  elements.moduleValue.textContent = module.enabled === false ? '已禁用' : '已启用';
  elements.bridgeValue.textContent = bridgeLabel(bridge);
  elements.scopeHint.textContent = scope.route_label || 'Browser route';
  elements.workspaceValue.textContent = scope.workspace_id || 'default';
  elements.routeValue.textContent = scope.route_key || 'browser:default';
  elements.deviceValue.textContent = shortId(scope.device_id || connection.hostId || '');
  elements.actionHint.textContent = actionHint(payload);
  elements.phaseValue.textContent = payload.phase?.current || 'Phase 4';
  elements.nextStep.textContent = payload.phase?.next || '下一步接入 Page Context Dock。';
  updateActionButtons(lastSessionsPayload || {});
  elements.bridgePermission.hidden = state !== 'bridge_permission_required' || !currentBridgePermissionOrigin;
  elements.diagnosticsOutput.textContent = diagnosticsText(payload);
}

function renderSessions(payload) {
  const state = payload.state || 'booting';
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const currentId = payload.currentBinding?.session_id || '';

  elements.sessionsList.replaceChildren();
  if (!sessions.length) {
    elements.sessionsEmpty.hidden = false;
    elements.sessionsEmpty.textContent = sessionsEmptyText(state, payload.error);
    selectedSessionId = '';
    selectedSession = null;
    updateActionButtons(payload);
    return;
  }

  elements.sessionsEmpty.hidden = true;
  if (!sessions.some((session) => sessionIdentity(session) === selectedSessionId)) {
    selectedSessionId = currentId || sessions[0].session_id || sessions[0].session_key || '';
  }
  selectedSession = sessions.find((session) => sessionIdentity(session) === selectedSessionId) || null;

  for (const session of sessions) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const id = sessionIdentity(session);
    const isCurrent = session.is_current === true || (currentId && currentId === session.session_id);
    button.type = 'button';
    button.className = 'session-card';
    button.setAttribute('aria-selected', id === selectedSessionId ? 'true' : 'false');
    button.disabled = session.restorable === false;
    button.title = sessionTitle(session);
    button.addEventListener('click', () => {
      selectedSessionId = id;
      selectedSession = session;
      renderSessions({ ...payload, sessions });
    });
    button.appendChild(sessionTitleRow(session, isCurrent));
    button.appendChild(sessionSummary(session));
    button.appendChild(sessionMeta(session));
    button.appendChild(sessionKey(session));
    item.appendChild(button);
    elements.sessionsList.appendChild(item);
  }
  updateActionButtons(payload);
}

function sessionTitleRow(session, isCurrent) {
  const row = document.createElement('div');
  const title = document.createElement('span');
  title.className = 'session-title';
  title.textContent = sessionTitle(session);
  row.className = 'session-title-row';
  row.appendChild(title);
  if (isCurrent) {
    const pill = document.createElement('span');
    pill.className = 'session-pill';
    pill.textContent = '当前';
    row.appendChild(pill);
  }
  if (session.empty) {
    const pill = document.createElement('span');
    pill.className = 'session-pill';
    pill.textContent = '空白';
    row.appendChild(pill);
  }
  return row;
}

function sessionSummary(session) {
  const summary = document.createElement('div');
  summary.className = 'session-summary';
  summary.textContent = session.summary || lastMessagePreview(session.last_messages) || '暂无摘要';
  return summary;
}

function sessionMeta(session) {
  const meta = document.createElement('div');
  meta.className = 'session-meta';
  meta.textContent = [
    session.model || '',
    session.project || '',
    formatTime(session.updated_at),
    tokenText(session)
  ].filter(Boolean).join(' · ');
  return meta;
}

function sessionKey(session) {
  const key = document.createElement('div');
  key.className = 'session-key';
  key.textContent = shortId(session.session_key || session.session_id || '');
  return key;
}

function renderError(message) {
  const copy = STATE_COPY.error;
  elements.panelState.textContent = '异常';
  elements.panelState.dataset.state = 'offline';
  elements.stateKicker.textContent = copy.kicker;
  elements.stateTitle.textContent = copy.title;
  elements.stateSummary.textContent = copy.summary;
  elements.pairingValue.textContent = '未知';
  elements.onlineValue.textContent = '未知';
  elements.moduleValue.textContent = '未知';
  elements.bridgeValue.textContent = '未知';
  elements.actionHint.textContent = '状态读取失败，无法启用会话动作';
  elements.bridgePermission.hidden = true;
  elements.sessionsList.replaceChildren();
  elements.sessionsEmpty.hidden = false;
  elements.sessionsEmpty.textContent = '状态读取失败，无法加载会话列表';
  elements.diagnosticsOutput.textContent = `error: ${redactText(message)}`;
}

function setLoading(loading) {
  elements.refresh.disabled = loading;
}

function setActionLoading(loading) {
  elements.newSession.disabled = loading || !canRunNewSession();
  elements.switchSession.disabled = loading || !canRunSwitchSession();
}

function updateActionButtons(payload) {
  lastSessionsPayload = payload;
  elements.newSession.disabled = !canRunNewSession(payload);
  elements.switchSession.disabled = !canRunSwitchSession(payload);
}

function canRunNewSession(payload = lastSessionsPayload || {}) {
  const state = payload.state || lastStatusPayload?.state;
  return state === 'ready' || state === 'empty_sessions';
}

function canRunSwitchSession(payload = lastSessionsPayload || {}) {
  const state = payload.state || lastStatusPayload?.state;
  return state === 'ready' && Boolean(selectedSessionId) && selectedSession?.restorable !== false;
}

function renderOperation(payload) {
  const action = payload.action || payload.result?.action || 'action';
  const result = payload.result || {};
  const confirmed = payload.confirmed === true || result.confirmed === true;
  const failed = payload.state === 'failed' || payload.error;
  const unconfirmed = payload.state === 'action_unconfirmed' || (result.operationStatus && !confirmed);
  const state = failed ? 'failed' : confirmed ? 'confirmed' : unconfirmed ? 'unconfirmed' : 'running';
  const title = operationTitle(action, state);
  const detail = operationDetail(payload, result, state);

  elements.operationResult.hidden = false;
  elements.operationResult.dataset.state = state;
  elements.operationResult.replaceChildren();

  const titleNode = document.createElement('strong');
  titleNode.textContent = title;
  const detailNode = document.createElement('span');
  detailNode.textContent = detail;
  elements.operationResult.appendChild(titleNode);
  elements.operationResult.appendChild(detailNode);

  if (result.messageCard?.text) {
    const cardNode = document.createElement('span');
    cardNode.textContent = result.messageCard.text;
    elements.operationResult.appendChild(cardNode);
  }
}

function operationTitle(action, state) {
  const actionName = action === 'new' ? '新开对话' : action === 'switch' ? '切换会话' : '会话动作';
  const stateName = {
    confirmed: '已确认',
    unconfirmed: '未确认',
    failed: '失败',
    running: '执行中'
  }[state] || '执行中';
  return `${actionName}：${stateName}`;
}

function operationDetail(payload, result, state) {
  if (payload.error) {
    return redactText(payload.error);
  }
  const parts = [
    result.operationStatus || payload.state || state,
    result.deliveryStatus ? `delivery: ${result.deliveryStatus}` : '',
    result.operationWarning ? redactText(result.operationWarning) : ''
  ].filter(Boolean);
  return parts.join(' · ') || '等待 Session Bridge 返回确认';
}

function stateLabel(state) {
  const labels = {
    disabled: '已禁用',
    unpaired: '未配对',
    offline: '离线',
    missing_config: '待配置',
    bridge_permission_required: '待授权',
    bridge_unavailable: 'Bridge 异常',
    scope_unresolved: 'Scope 未解析',
    empty_sessions: '空列表',
    ready: 'Ready',
    loading_sessions: '加载中',
    booting: '检查中'
  };
  return labels[state] || '检查中';
}

function statusTone(state) {
  if (state === 'ready') {
    return 'online';
  }
  if (state === 'missing_config' || state === 'offline' || state === 'bridge_permission_required' || state === 'empty_sessions' || state === 'scope_unresolved') {
    return 'paired';
  }
  if (state === 'booting' || state === 'loading_sessions') {
    return 'connecting';
  }
  return 'offline';
}

function pairingLabel(connection) {
  if (connection.paired) {
    return '已配对';
  }
  if (connection.pairing === 'pending') {
    return '待授权';
  }
  if (connection.pairing === 'stale') {
    return '需重新配对';
  }
  return '未配对';
}

function onlineLabel(connection) {
  if (connection.online) {
    return '在线';
  }
  if (connection.connecting) {
    return '连接中';
  }
  if (connection.connected) {
    return '握手中';
  }
  return '离线';
}

function bridgeLabel(bridge) {
  if (bridge.state === 'disabled') {
    return '模块已禁用';
  }
  if (bridge.state === 'permission_required') {
    return '需要授权访问';
  }
  if (bridge.available) {
    return bridge.remote?.bridgeName || 'Bridge 在线';
  }
  if (bridge.state === 'unauthorized') {
    return 'Token 被拒绝';
  }
  if (bridge.state === 'timeout') {
    return '请求超时';
  }
  if (bridge.state === 'fetch_failed' || bridge.state === 'http_error' || bridge.state === 'unavailable') {
    return '暂不可达';
  }
  if (bridge.configured) {
    return '已配置 URL 与 token';
  }
  if (bridge.state === 'missing_auth') {
    return '缺少 Bridge token';
  }
  if (bridge.state === 'missing_base_url') {
    return '缺少 Bridge URL';
  }
  return '缺少 Bridge URL';
}

function actionHint(payload) {
  if (payload.state === 'ready') {
    return 'Session Bridge 已接入，new/switch 会先二次确认，再等待 Bridge confirmed 字段';
  }
  if (payload.state === 'bridge_permission_required') {
    return '点击授权按钮后才会访问 Bridge 地址';
  }
  if (payload.state === 'bridge_unavailable') {
    return '检查 Bridge 服务、网络、token 或超时设置';
  }
  if (payload.state === 'scope_unresolved') {
    return '当前 scope 没有被 Bridge 解析为可访问会话';
  }
  if (payload.state === 'empty_sessions') {
    return '当前 scope 暂无历史会话，可新开对话';
  }
  if (payload.state === 'missing_config') {
    return bridgeConfigHint(payload.bridge || {});
  }
  if (payload.state === 'offline') {
    return '恢复 OpenClaw 连接后再操作会话';
  }
  if (payload.state === 'unpaired') {
    return '完成设备配对后再操作会话';
  }
  return '当前状态下会话动作不可用';
}

function bridgeConfigHint(bridge) {
  if (bridge.state === 'missing_auth') {
    return '补齐 Bridge token 后再加载会话列表';
  }
  if (bridge.state === 'missing_base_url') {
    return '配置 Bridge URL 后再加载会话列表';
  }
  return '补齐 Bridge 配置后再加载会话列表';
}

function sessionsEmptyText(state, error) {
  if (error) {
    return redactText(error);
  }
  const labels = {
    loading_sessions: '正在从 Session Bridge 加载 scoped sessions',
    disabled: '侧栏模块已禁用',
    unpaired: '完成 OpenClaw 配对后再加载会话',
    offline: 'OpenClaw 在线后再加载会话',
    missing_config: '补齐 Bridge URL 和 token 后再加载会话',
    bridge_permission_required: '授权 Bridge 地址后再加载会话',
    bridge_unavailable: 'Session Bridge 暂不可达',
    scope_unresolved: '当前 scope 未解析到可访问会话',
    empty_sessions: '当前 scope 暂无历史会话',
    ready: '当前 scope 暂无历史会话'
  };
  return labels[state] || '等待会话列表';
}

function diagnosticsText(payload) {
  const connection = payload.connection || {};
  const bridge = payload.bridge || {};
  const lines = [
    `state: ${payload.state || 'unknown'}`,
    `module: ${payload.module?.id || 'openclaw-side-panel'}`,
    `adapter: ${bridge.adapter || 'session-bridge'}`,
    `bridge_state: ${bridge.state || 'unknown'}`,
    `bridge_available: ${Boolean(bridge.available)}`,
    `bridge_configured: ${Boolean(bridge.configured)}`,
    `bridge_auth_configured: ${Boolean(bridge.authConfigured)}`,
    `bridge_permission_granted: ${Boolean(bridge.permission?.granted)}`,
    `remote_bridge: ${bridge.remote?.bridgeId || 'unknown'}`,
    `host: ${shortId(connection.hostId || '')}`,
    `last_error: ${redactText(bridge.error || connection.lastError || 'none')}`,
    `updated_at: ${payload.updatedAt || 'unknown'}`
  ];
  return lines.join('\n');
}

function sessionTitle(session) {
  return String(session.title || session.session_id || session.session_key || 'OpenClaw session').trim();
}

function sessionIdentity(session) {
  return session.session_id || session.session_key || '';
}

function lastMessagePreview(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return '';
  }
  const last = messages[messages.length - 1];
  return String(last?.content || last?.text || last || '').trim();
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 16);
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function tokenText(session) {
  if (!Number.isFinite(session.context_used) || !Number.isFinite(session.context_window) || !session.context_window) {
    return '';
  }
  return `${session.context_used}/${session.context_window} tokens`;
}

function shortId(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '未生成';
  }
  if (text.length <= 14) {
    return text;
  }
  return `${text.slice(0, 7)}...${text.slice(-5)}`;
}

function redactText(value) {
  return String(value || '')
    .replace(/(token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"',\s]+/gi, '$1[redacted]');
}
