const elements = {
  panelState: document.getElementById('panelState'),
  refresh: document.getElementById('refresh'),
  openOptions: document.getElementById('openOptions'),
  connectOpenClaw: document.getElementById('connectOpenClaw'),
  stateKicker: document.getElementById('stateKicker'),
  stateTitle: document.getElementById('stateTitle'),
  stateSummary: document.getElementById('stateSummary'),
  pairingValue: document.getElementById('pairingValue'),
  onlineValue: document.getElementById('onlineValue'),
  moduleValue: document.getElementById('moduleValue'),
  bridgeValue: document.getElementById('bridgeValue'),
  scopeHint: document.getElementById('scopeHint'),
  workspaceValue: document.getElementById('workspaceValue'),
  organizationValue: document.getElementById('organizationValue'),
  routeTypeValue: document.getElementById('routeTypeValue'),
  routeValue: document.getElementById('routeValue'),
  deviceValue: document.getElementById('deviceValue'),
  actionHint: document.getElementById('actionHint'),
  bridgePermission: document.getElementById('bridgePermission'),
  instanceSwitcher: document.getElementById('instanceSwitcher'),
  sessionsEmpty: document.getElementById('sessionsEmpty'),
  sessionsList: document.getElementById('sessionsList'),
  newSession: document.getElementById('newSession'),
  switchSession: document.getElementById('switchSession'),
  operationResult: document.getElementById('operationResult'),
  pageDockHint: document.getElementById('pageDockHint'),
  pageKindValue: document.getElementById('pageKindValue'),
  pageTitleValue: document.getElementById('pageTitleValue'),
  pageUrlValue: document.getElementById('pageUrlValue'),
  pageSummarize: document.getElementById('pageSummarize'),
  pageKnowledge: document.getElementById('pageKnowledge'),
  pageResearch: document.getElementById('pageResearch'),
  pageDockResult: document.getElementById('pageDockResult'),
  handoffStatusValue: document.getElementById('handoffStatusValue'),
  handoffDockList: document.getElementById('handoffDockList'),
  openHistoryDock: document.getElementById('openHistoryDock'),
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
    title: '先完成 Bondie 设备配对',
    summary: 'Bondie Dock 已准备好，但还没有可信设备身份可用于会话 scope。'
  },
  offline: {
    kicker: '离线',
    title: 'Bondie 当前不在线',
    summary: '设备已有配对记录，恢复 Gateway 连接后会继续检查 Session Bridge。'
  },
  missing_config: {
    kicker: '缺少配置',
    title: '会话服务尚未配置',
    summary: '下一步需要补齐 Session Bridge 或 Control Plane 的 URL 与 token 才能列出 scoped sessions。'
  },
  bridge_permission_required: {
    kicker: '等待授权',
    title: '需要允许访问会话服务',
    summary: '浏览器还没有授予会话服务地址访问权限。授权后才会发起 status/list 请求。'
  },
  bridge_unavailable: {
    kicker: 'Bridge 不可用',
    title: 'Session Bridge 暂时不可达',
    summary: '配置和配对已满足，但 Bridge 健康检查或元数据读取失败。'
  },
  scope_unresolved: {
    kicker: 'Scope 未解析',
    title: '当前 scope 没有可用会话',
    summary: 'Bridge 没有返回当前浏览器 scope 可访问的 Bondie 会话。'
  },
  identity_required: {
    kicker: '等待身份',
    title: '需要用户身份后才能读取会话',
    summary: '设备配对不能替代用户身份；多 Bondie 权限需要 OAuth 或等价身份体系。'
  },
  permission_unresolved: {
    kicker: '权限未解析',
    title: '当前用户没有可用 Bondie 会话权限',
    summary: '没有从属或沟通关系时，不展示任何 session。'
  },
  instance_unavailable: {
    kicker: '实例不可用',
    title: '所选 Bondie 暂不可用',
    summary: '该实例不存在、未授权，或当前 adapter 不能访问它。'
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
    title: '正在读取 Bondie 状态',
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
let selectedInstanceId = 'all';
let lastStatusPayload = null;
let lastSessionsPayload = null;
let lastPageMeta = null;

elements.refresh.addEventListener('click', () => refreshStatus());
elements.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
elements.connectOpenClaw.addEventListener('click', connectOpenClaw);
elements.bridgePermission.addEventListener('click', requestBridgePermission);
elements.newSession.addEventListener('click', requestNewSession);
elements.switchSession.addEventListener('click', requestSwitchSession);
elements.pageSummarize.addEventListener('click', () => runPageService('summarize'));
elements.pageKnowledge.addEventListener('click', () => runPageService('knowledge'));
elements.pageResearch.addEventListener('click', () => runPageService('research'));
elements.openHistoryDock.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/history.html') }));
elements.newSession.title = '新开对话会调用会话服务，并按 confirmed 字段判断完成态';
elements.switchSession.title = '切换会话会调用会话服务，并按 confirmed 字段判断完成态';

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
    await refreshPageDock();
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoading(false);
  }
}

async function connectOpenClaw() {
  elements.connectOpenClaw.disabled = true;
  elements.connectOpenClaw.textContent = '连接中';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'connect' });
    if (!response?.ok) {
      renderOperation({
        state: 'failed',
        action: 'connect',
        error: response?.error || 'Bondie 连接失败'
      });
    }
    await refreshStatus();
  } catch (error) {
    renderOperation({
      state: 'failed',
      action: 'connect',
      error: error.message
    });
  } finally {
    elements.connectOpenClaw.textContent = '连接 Bondie';
    updateConnectButton(lastStatusPayload || {});
  }
}

async function refreshPageDock() {
  const [metaResult, handoffsResult] = await Promise.allSettled([
    chrome.runtime.sendMessage({ type: 'pageMeta' }),
    chrome.runtime.sendMessage({ type: 'handoffs' })
  ]);
  const metaResponse = resultValue(metaResult);
  const handoffsResponse = resultValue(handoffsResult);

  if (metaResponse?.ok) {
    lastPageMeta = metaResponse.payload || {};
    renderPageMeta(lastPageMeta);
  } else {
    lastPageMeta = null;
    renderPageMetaError(metaResponse?.error || 'No active web tab');
  }
  renderHandoffDock(handoffsResponse?.payload?.handoffs || []);
}

async function runPageService(service) {
  if (!lastPageMeta?.url) {
    renderPageDockResult({
      ok: false,
      service,
      error: '没有可处理的当前网页'
    });
    return;
  }

  setPageActionLoading(true);
  renderPageDockResult({
    ok: true,
    service,
    payload: {
      status: `capturing-${service}`
    }
  });

  try {
    const permissionGranted = await requestCurrentPagePermission(lastPageMeta.url);
    if (!permissionGranted) {
      renderPageDockResult({
        ok: false,
        service,
        error: '授权未完成，暂不读取页面正文'
      });
      return;
    }

    const message = {
      type: 'pageService',
      payload: { service }
    };
    const response = await chrome.runtime.sendMessage(message);
    if (response?.ok || !isPagePermissionError(response)) {
      renderPageDockResult({ ...response, service });
      await refreshPageDock();
      return;
    }

    renderPageDockResult({
      ...response,
      service,
      error: response?.error || '页面权限未授予，暂不读取页面正文'
    });
    await refreshPageDock();
  } catch (error) {
    renderPageDockResult({
      ok: false,
      service,
      error: error.message
    });
  } finally {
    setPageActionLoading(false);
  }
}

function isPagePermissionError(response) {
  const error = String(response?.error || '');
  return error.includes('Page summary failed');
}

async function requestCurrentPagePermission(url) {
  if (!chrome.permissions?.request) {
    return true;
  }
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  renderPageDockResult({
    ok: true,
    payload: {
      status: 'requesting-page-permission',
      origin
    }
  });
  return await new Promise((resolve) => {
    chrome.permissions.request({ origins: [`${origin}/*`] }, (result) => {
      resolve(chrome.runtime.lastError ? false : Boolean(result));
    });
  });
}

async function refreshSessions() {
  const hasRenderedSessions = Array.isArray(lastSessionsPayload?.sessions) && lastSessionsPayload.sessions.length > 0;
  if (!hasRenderedSessions) {
    renderSessions({ state: 'loading_sessions', sessions: [] });
  }
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
        current: 'Phase 6: Session-first real bridge validation',
        next: 'Phase 7: Pairing UX, Edge validation, and Safari plan'
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
  if (!window.confirm('确认新开 Bondie 对话？后续消息会进入新的会话代际。')) {
    return;
  }

  await runSessionAction({
    type: 'sidePanel.sessions.new',
    action: 'new',
    instanceId: selectedActionGroup()?.instance_id || '',
    sessionId: selectedSessionId || ''
  });
}

async function requestSwitchSession() {
  if (!canRunSwitchSession()) {
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
    instanceId: selectedActionGroup()?.instance_id || '',
    sessionId: sessionIdentity(selectedSession)
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
      instanceId: message.instanceId,
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
  const target = isControlPlanePayload(lastStatusPayload) ? 'Control Plane' : 'Bridge';
  if (!currentBridgePermissionOrigin || !chrome.permissions?.request) {
    renderSessions({
      state: 'bridge_permission_required',
      sessions: [],
      error: `当前浏览器不支持动态授权 ${target} 地址`
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
      error: `授权未完成，暂不访问 ${target}`
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
  elements.organizationValue.textContent = scope.organization || scope.workspace_id || 'default';
  elements.routeTypeValue.textContent = scope.route_type || 'browser';
  elements.routeValue.textContent = scope.route_key || 'browser:default';
  elements.deviceValue.textContent = shortId(scope.device_id || connection.hostId || '');
  elements.actionHint.textContent = actionHint(payload);
  elements.phaseValue.textContent = payload.phase?.current || 'Phase 6';
  elements.nextStep.textContent = payload.phase?.next || '下一步进入产品打磨和视觉 QA。';
  updateConnectButton(payload);
  updateActionButtons(lastSessionsPayload || {});
  elements.bridgePermission.hidden = state !== 'bridge_permission_required' || !currentBridgePermissionOrigin;
  elements.diagnosticsOutput.textContent = diagnosticsText(payload);
}

function updateConnectButton(payload) {
  const state = payload.state || 'booting';
  const connection = payload.connection || {};
  const canConnect = ['unpaired', 'offline', 'missing_config', 'bridge_permission_required', 'bridge_unavailable'].includes(state);
  elements.connectOpenClaw.hidden = state === 'ready' || state === 'disabled';
  elements.connectOpenClaw.disabled = connection.connecting || !canConnect;
  elements.connectOpenClaw.textContent = connection.connecting ? '连接中' : '连接 Bondie';
}

function renderSessions(payload) {
  const state = payload.state || 'booting';
  const groups = sessionGroups(payload);
  if (selectedInstanceId !== 'all' && !groups.some((group) => group.instance_id === selectedInstanceId)) {
    selectedInstanceId = 'all';
  }
  const visibleGroups = selectedInstanceId === 'all'
    ? groups
    : groups.filter((group) => group.instance_id === selectedInstanceId);
  const sessions = visibleGroups.flatMap((group) => group.sessions || []);
  const currentId = payload.currentBinding?.session_id || '';

  renderInstanceSwitcher(payload, groups);
  updateSessionActionHint(payload, groups);
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
  if (!sessions.some((session) => scopedSessionIdentity(session) === selectedSessionId)) {
    const currentSession = sessions.find((session) => currentId && currentId === session.session_id);
    selectedSessionId = currentSession ? scopedSessionIdentity(currentSession) : scopedSessionIdentity(sessions[0]);
  }
  selectedSession = sessions.find((session) => scopedSessionIdentity(session) === selectedSessionId) || null;

  for (const group of visibleGroups) {
    const groupItem = document.createElement('li');
    groupItem.className = 'instance-group';
    groupItem.appendChild(instanceGroupHeading(group));

    const groupSessions = document.createElement('div');
    groupSessions.className = 'instance-session-list';
    for (const session of group.sessions || []) {
      const button = document.createElement('button');
      const id = scopedSessionIdentity(session);
      const isCurrent = session.is_current === true || (currentId && currentId === session.session_id);
      button.type = 'button';
      button.className = 'session-card';
      button.setAttribute('aria-selected', id === selectedSessionId ? 'true' : 'false');
      button.disabled = session.restorable === false;
      button.title = sessionTitle(session);
      button.addEventListener('click', () => {
        selectedSessionId = id;
        selectedSession = session;
        renderSessions(payload);
      });
      button.appendChild(sessionTitleRow(session, isCurrent));
      button.appendChild(sessionSummary(session));
      button.appendChild(sessionMeta(session));
      button.appendChild(sessionKey(session));
      groupSessions.appendChild(button);
    }
    groupItem.appendChild(groupSessions);
    elements.sessionsList.appendChild(groupItem);
  }
  updateActionButtons(payload);
}

function sessionGroups(payload) {
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  if (groups.length) {
    return groups.map((group) => {
      const instance = group.instance || instanceById(payload.instances, group.instance_id);
      return {
        ...group,
        instance,
        instance_id: group.instance_id || instance?.instance_id || 'legacy-session-bridge',
        collection_kind: normalizeCollectionKind(group.collection_kind, group.visibility_policy || instance?.visibility_policy),
        sessions: Array.isArray(group.sessions) ? group.sessions : []
      };
    });
  }
  const instance = (Array.isArray(payload.instances) && payload.instances[0]) || {
    instance_id: 'legacy-session-bridge',
    display_name: 'Bondie',
    relationship_label: '当前 Bridge',
    visibility_label: '仅相关',
    status: payload.state === 'ready' ? 'online' : payload.state,
    actions_enabled: true
  };
  return [
    {
      instance_id: instance.instance_id,
      instance,
      state: payload.state,
      actions_enabled: instance.actions_enabled !== false,
      collection_kind: normalizeCollectionKind('', instance.visibility_policy),
      sessions: (payload.sessions || []).map((session) => ({
        ...session,
        instance_id: instance.instance_id,
        instance_name: instance.display_name,
        visibility_label: instance.visibility_label,
        relationship_label: instance.relationship_label,
        collection_kind: normalizeCollectionKind(session.collection_kind, instance.visibility_policy),
        actions_enabled: instance.actions_enabled !== false
      }))
    }
  ];
}

function instanceById(instances, instanceId) {
  return Array.isArray(instances)
    ? instances.find((instance) => instance.instance_id === instanceId) || null
    : null;
}

function renderInstanceSwitcher(payload, groups) {
  elements.instanceSwitcher.replaceChildren();
  if (!groups.length) {
    elements.instanceSwitcher.hidden = true;
    return;
  }
  elements.instanceSwitcher.hidden = false;
  const total = groups.reduce((sum, group) => sum + (group.sessions?.length || 0), 0);
  const totalNoun = groups.every((group) => collectionKind(group) === 'route_index') ? '对象' : '会话';
  elements.instanceSwitcher.appendChild(instanceChip({
    id: 'all',
    label: '全部',
    meta: `${groups.length} 个 Bondie · ${total} 个${totalNoun}`,
    status: payload.state || 'ready',
    selected: selectedInstanceId === 'all'
  }));
  for (const group of groups) {
    const instance = group.instance || {};
    elements.instanceSwitcher.appendChild(instanceChip({
      id: group.instance_id,
      label: instance.display_name || group.instance_id,
      meta: `${instance.relationship_label || '关系'} · ${collectionLabel(group)} · ${group.sessions?.length || 0}`,
      status: instance.status || group.state,
      selected: selectedInstanceId === group.instance_id
    }));
  }
}

function instanceChip({ id, label, meta, status, selected }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'instance-chip';
  button.dataset.selected = selected ? 'true' : 'false';
  button.dataset.status = statusTone(status === 'online' ? 'ready' : status);
  button.addEventListener('click', () => {
    selectedInstanceId = id;
    selectedSessionId = '';
    selectedSession = null;
    renderSessions(lastSessionsPayload || { state: 'booting', sessions: [] });
  });

  const labelNode = document.createElement('strong');
  labelNode.textContent = label;
  const metaNode = document.createElement('span');
  metaNode.textContent = meta;
  button.appendChild(labelNode);
  button.appendChild(metaNode);
  return button;
}

function instanceGroupHeading(group) {
  const instance = group.instance || {};
  const heading = document.createElement('div');
  heading.className = 'instance-group-heading';

  const titleWrap = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = instance.display_name || group.instance_id || 'Bondie';
  const meta = document.createElement('span');
  meta.textContent = [
    instance.relationship_label || relationshipLabel(instance.relationship_type),
    collectionLabel(group),
    instance.status === 'online' ? 'online' : instance.status
  ].filter(Boolean).join(' · ');
  titleWrap.appendChild(title);
  titleWrap.appendChild(meta);

  const badge = document.createElement('span');
  badge.className = 'instance-badge';
  badge.dataset.policy = instance.visibility_policy || group.visibility_policy || '';
  badge.textContent = instance.visibility_label || visibilityLabel(group.visibility_policy);

  heading.appendChild(titleWrap);
  heading.appendChild(badge);
  return heading;
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
  if (session.visibility_label) {
    const pill = document.createElement('span');
    pill.className = 'session-pill session-pill-muted';
    pill.textContent = session.visibility_label;
    row.appendChild(pill);
  }
  if (collectionKind(session) === 'route_index') {
    const pill = document.createElement('span');
    pill.className = 'session-pill session-pill-muted';
    pill.textContent = '路由';
    row.appendChild(pill);
  }
  return row;
}

function sessionSummary(session) {
  const summary = document.createElement('div');
  summary.className = 'session-summary';
  summary.textContent = session.summary
    || lastMessagePreview(session.last_messages)
    || (collectionKind(session) === 'route_index' ? '选择该对象后再新开或恢复这条 OpenClaw 路由' : '暂无摘要');
  return summary;
}

function sessionMeta(session) {
  const meta = document.createElement('div');
  meta.className = 'session-meta';
  meta.textContent = [
    collectionKind(session) === 'route_index' ? '路由索引' : '',
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
  const group = selectedActionGroup(payload);
  if (!group) {
    return false;
  }
  if (groupRequiresRouteSessionHint(group)) {
    return state === 'ready'
      && Boolean(selectedSessionId)
      && Boolean(selectedSession)
      && selectedSession.restorable !== false;
  }
  return state === 'ready' || state === 'empty_sessions';
}

function canRunSwitchSession(payload = lastSessionsPayload || {}) {
  const state = payload.state || lastStatusPayload?.state;
  return state === 'ready'
    && Boolean(selectedActionGroup(payload))
    && Boolean(selectedSessionId)
    && Boolean(selectedSession)
    && selectedSession.restorable !== false
    && selectedSession.actions_enabled !== false;
}

function selectedActionGroup(payload = lastSessionsPayload || {}) {
  const actionableGroups = sessionGroups(payload).filter((group) => {
    const instance = group.instance || {};
    return group.actions_enabled !== false && instance.actions_enabled !== false;
  });
  if (selectedInstanceId === 'all') {
    return actionableGroups.length === 1 ? actionableGroups[0] : null;
  }
  return actionableGroups.find((group) => group.instance_id === selectedInstanceId) || null;
}

function updateSessionActionHint(payload, groups) {
  const state = payload.state || lastStatusPayload?.state;
  const usesControlPlane = isControlPlanePayload(payload) || isControlPlanePayload(lastStatusPayload);
  if (state !== 'ready') {
    return;
  }
  const actionableGroups = groups.filter((group) => {
    const instance = group.instance || {};
    return group.actions_enabled !== false && instance.actions_enabled !== false;
  });
  if (!actionableGroups.length) {
    elements.actionHint.textContent = '当前多 Bondie 权限预览为只读，真实 new/switch 等待 instance-level contract';
    return;
  }
  if (selectedInstanceId === 'all' && actionableGroups.length > 1) {
    elements.actionHint.textContent = '先选择具体 Bondie，再执行新开或恢复会话';
    return;
  }
  const group = selectedActionGroup(payload);
  if (group && groupRequiresRouteSessionHint(group) && !selectedSessionId) {
    elements.actionHint.textContent = '从属关系展示可访问对象索引；新开或恢复前先选择具体路由';
    return;
  }
  elements.actionHint.textContent = usesControlPlane
    ? 'Control Plane 已接入，new/switch 会按所选 Bondie 权限路由到对应实例'
    : 'Session Bridge 已接入，new/switch 会先二次确认，再等待 Bridge confirmed 字段';
}

function groupRequiresRouteSessionHint(group) {
  const instance = group?.instance || {};
  return instance.visibility_policy === 'all_sessions' || group?.visibility_policy === 'all_sessions';
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

function renderPageMeta(payload) {
  const contentType = payload.contentType || 'webpage';
  elements.pageKindValue.textContent = payload.contentLabel || pageKindText(contentType);
  elements.pageTitleValue.textContent = compactText(payload.title || 'Untitled page', 96);
  elements.pageUrlValue.textContent = compactText(payload.url || '', 120);
  elements.pageDockHint.textContent = pageDockHint(payload);
  elements.pageSummarize.disabled = false;
  elements.pageResearch.disabled = false;
  elements.pageKnowledge.textContent = primaryActionText(contentType);
  elements.pageKnowledge.disabled = !payload.knowledgeSupported;
}

function renderPageMetaError(message) {
  elements.pageKindValue.textContent = '网页';
  elements.pageTitleValue.textContent = '未读取页面';
  elements.pageUrlValue.textContent = redactText(message || '打开网页后可发起上下文任务');
  elements.pageDockHint.textContent = '等待当前网页';
  elements.pageSummarize.disabled = true;
  elements.pageKnowledge.disabled = true;
  elements.pageResearch.disabled = true;
}

function renderPageDockResult(response) {
  const ok = response?.ok !== false;
  const payload = response?.payload || {};
  const service = response?.service || payload.service || 'summarize';
  const state = ok ? payload.state || payload.status || 'done' : 'error';

  elements.pageDockResult.hidden = false;
  elements.pageDockResult.dataset.state = ok ? pageDockResultState(state) : 'error';
  elements.pageDockResult.replaceChildren();

  const title = document.createElement('strong');
  title.textContent = ok ? pageServiceDoneText(service, payload) : pageServiceFailureText(response);
  const detail = document.createElement('span');
  detail.textContent = ok ? pageServiceDetail(service, payload) : redactText(response?.error || '发送失败');
  elements.pageDockResult.appendChild(title);
  elements.pageDockResult.appendChild(detail);

  if (payload.captureId) {
    const id = document.createElement('span');
    id.textContent = `capture: ${shortId(payload.captureId)}`;
    elements.pageDockResult.appendChild(id);
  }
  if (state === 'requesting-page-permission' && payload.origin) {
    const origin = document.createElement('span');
    origin.textContent = `origin: ${payload.origin}`;
    elements.pageDockResult.appendChild(origin);
  }
}

function renderHandoffDock(handoffs) {
  elements.handoffDockList.replaceChildren();
  const visible = Array.isArray(handoffs) ? handoffs.slice(0, 3) : [];
  const latest = visible[0];
  elements.handoffStatusValue.textContent = latest ? stateText(latest.state) : '暂无处理记录';

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'sessions-empty';
    empty.textContent = '主动点击上方按钮后，处理记录会显示在这里';
    elements.handoffDockList.appendChild(empty);
    return;
  }

  for (const handoff of visible) {
    const card = document.createElement('article');
    card.className = 'handoff-card';
    card.dataset.state = handoff.state || 'idle';
    const title = document.createElement('strong');
    title.textContent = compactText(handoff.title || 'Untitled page', 86);
    const meta = document.createElement('span');
    meta.textContent = [
      stateText(handoff.state),
      pageServiceText(handoff.service || handoff.intent),
      handoff.contentLabel || pageKindText(handoff.contentType)
    ].filter(Boolean).join(' · ');
    card.appendChild(title);
    card.appendChild(meta);

    const summary = popupReplyText(handoff.latestReply || handoff.error || '');
    if (summary) {
      const body = document.createElement('p');
      body.textContent = summary;
      card.appendChild(body);
    }
    const path = extractMarkdownPath(handoff.latestReply);
    if (path) {
      const artifact = document.createElement('p');
      artifact.className = 'artifact-path';
      artifact.textContent = path;
      card.appendChild(artifact);
    }
    elements.handoffDockList.appendChild(card);
  }
}

function setPageActionLoading(loading) {
  const canRun = Boolean(lastPageMeta?.url);
  elements.pageSummarize.disabled = loading || !canRun;
  elements.pageResearch.disabled = loading || !canRun;
  elements.pageKnowledge.disabled = loading || !canRun || !lastPageMeta?.knowledgeSupported;
}

function pageDockHint(payload) {
  const type = payload.contentType || 'webpage';
  if (type === 'video') {
    return '视频页面可入库或发起深度调研';
  }
  if (type === 'github-repository') {
    return 'GitHub 仓库可解析 README、结构和代码线索';
  }
  if (type === 'article') {
    return '文章页面可快速读懂、入库或深研';
  }
  return '当前网页可作为 Bondie 上下文';
}

function pageKindText(contentType) {
  const labels = {
    article: '文章',
    webpage: '网页',
    video: '视频',
    'github-repository': 'GitHub 仓库'
  };
  return labels[contentType] || '网页';
}

function primaryActionText(contentType) {
  const labels = {
    article: '解析文章为知识笔记',
    webpage: '解析当前页',
    video: '解析视频内容',
    'github-repository': '解析 GitHub 仓库'
  };
  return labels[contentType] || '解析当前页';
}

function pageServiceText(service) {
  const labels = {
    knowledge: '入库为知识笔记',
    relate: '找库内关联',
    research: '发起深研',
    issue: 'Issue 草案',
    summarize: '快速读懂',
    workflow: '转成行动',
    later: '稍后处理',
    save: '稍后处理',
    next: '转成行动'
  };
  return labels[service] || '页面处理';
}

function pageServiceDoneText(service, payload) {
  if (payload.status === 'requesting-page-permission') {
    return '等待页面权限';
  }
  if (String(payload.status || '').startsWith('capturing-')) {
    return pageServicePendingText(service);
  }
  const labels = {
    knowledge: '已交给 Media to Notes',
    relate: '已交给 OpenClaw 查找关联',
    research: '已交给 OpenClaw 发起深研',
    issue: '已交给 OpenClaw 生成草案',
    summarize: '已交给 OpenClaw 快速读懂',
    workflow: '已交给 OpenClaw 转成行动',
    later: '已交给 OpenClaw 稍后处理'
  };
  return labels[service] || '已交给 OpenClaw';
}

function pageServiceFailureText(response) {
  return response?.error ? '页面任务失败' : '发送失败';
}

function pageServiceDetail(service, payload) {
  if (payload.status === 'requesting-page-permission') {
    return payload.origin ? `等待授权 · ${payload.origin}` : '等待授权';
  }
  if (String(payload.status || '').startsWith('capturing-')) {
    return '正在读取当前页面正文，仅在点击后执行';
  }
  return [
    pageServiceText(service),
    payload.contentLabel || pageKindText(payload.contentType),
    payload.ability?.name,
    stateText(payload.state)
  ].filter(Boolean).join(' · ');
}

function pageServicePendingText(service) {
  const labels = {
    knowledge: '正在启动 Media to Notes',
    relate: '正在查找库内关联',
    research: '正在准备深研任务',
    issue: '正在生成 Issue 草案',
    summarize: '正在快速读懂',
    workflow: '正在转成行动',
    later: '正在保存稍后线索',
    save: '正在保存稍后线索',
    next: '正在转成行动'
  };
  return labels[service] || '正在发送';
}

function pageDockResultState(state) {
  const text = String(state || '');
  if (text === 'requesting-page-permission' || text.startsWith('capturing-') || text === 'queued' || text === 'processing') {
    return 'pending';
  }
  return 'done';
}

function stateText(state) {
  const states = {
    queued: '排队中',
    processing: '处理中',
    done: '已完成',
    error: '失败',
    'captured-local': '本地已捕获'
  };
  return states[state] || '待命';
}

function resultValue(result) {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  return {
    ok: false,
    error: result.reason?.message || 'Side Panel request failed'
  };
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
    identity_required: '待身份',
    permission_unresolved: '权限未解析',
    instance_unavailable: '实例不可用',
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
  if (state === 'missing_config' || state === 'offline' || state === 'bridge_permission_required' || state === 'empty_sessions' || state === 'scope_unresolved' || state === 'identity_required' || state === 'permission_unresolved' || state === 'instance_unavailable') {
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
  const usesControlPlane = isControlPlaneBridge(bridge);
  if (bridge.state === 'disabled') {
    return '模块已禁用';
  }
  if (bridge.state === 'permission_required') {
    return '需要授权访问';
  }
  if (bridge.available) {
    return bridge.remote?.bridgeName || (usesControlPlane ? 'Control Plane 在线' : 'Bridge 在线');
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
    return usesControlPlane ? 'Control Plane 已配置' : '已配置 URL 与 token';
  }
  if (bridge.state === 'missing_auth') {
    return usesControlPlane ? '缺少 Control Plane token' : '缺少 Bridge token';
  }
  if (bridge.state === 'missing_base_url') {
    return usesControlPlane ? '缺少 Control Plane URL' : '缺少 Bridge URL';
  }
  return usesControlPlane ? '缺少 Control Plane URL' : '缺少 Bridge URL';
}

function actionHint(payload) {
  const usesControlPlane = isControlPlanePayload(payload);
  if (payload.state === 'ready') {
    if (payload.scope?.visibility_policy === 'all_sessions') {
      return '从属关系已接入，首屏显示可访问对象索引；历史会话按选中路由加载';
    }
    return usesControlPlane
      ? 'Control Plane 已接入，选择 Bondie 后可按权限新开或恢复会话'
      : 'Session Bridge 已接入，new/switch 会先二次确认，再等待 Bridge confirmed 字段';
  }
  if (payload.state === 'bridge_permission_required') {
    return usesControlPlane ? '点击授权按钮后才会访问 Control Plane 地址' : '点击授权按钮后才会访问 Bridge 地址';
  }
  if (payload.state === 'bridge_unavailable') {
    return usesControlPlane ? '检查 Control Plane 服务、网络、token 或超时设置' : '检查 Bridge 服务、网络、token 或超时设置';
  }
  if (payload.state === 'scope_unresolved') {
    return usesControlPlane ? '当前用户没有被解析到可访问 Bondie 会话' : '当前 scope 没有被 Bridge 解析为可访问会话';
  }
  if (payload.state === 'empty_sessions') {
    return '当前 scope 暂无历史会话，可新开对话';
  }
  if (payload.state === 'missing_config') {
    return bridgeConfigHint(payload.bridge || {});
  }
  if (payload.state === 'offline') {
    return '恢复 Bondie 连接后再操作会话';
  }
  if (payload.state === 'unpaired') {
    return '完成设备配对后再操作会话';
  }
  return '当前状态下会话动作不可用';
}

function bridgeConfigHint(bridge) {
  const prefix = isControlPlaneBridge(bridge) ? 'Control Plane' : 'Bridge';
  if (bridge.state === 'missing_auth') {
    return `补齐 ${prefix} token 后再加载会话列表`;
  }
  if (bridge.state === 'missing_base_url') {
    return `配置 ${prefix} URL 后再加载会话列表`;
  }
  return `补齐 ${prefix} 配置后再加载会话列表`;
}

function sessionsEmptyText(state, error) {
  if (error) {
    return redactText(error);
  }
  const labels = {
    loading_sessions: '正在从 Session Bridge 加载 scoped sessions',
    disabled: '侧栏模块已禁用',
    unpaired: '完成 Bondie 配对后再加载会话',
    offline: 'Bondie 在线后再加载会话',
    missing_config: '补齐 Bridge URL 和 token 后再加载会话',
    bridge_permission_required: '授权 Bridge 地址后再加载会话',
    bridge_unavailable: 'Session Bridge 暂不可达',
    scope_unresolved: '当前 scope 未解析到可访问会话',
    identity_required: '完成用户身份识别后再加载会话',
    permission_unresolved: '当前用户没有可展示的 Bondie 会话权限',
    instance_unavailable: '所选 Bondie 暂不可用或当前 adapter 不支持',
    empty_sessions: '当前 scope 暂无历史会话',
    ready: '当前 scope 暂无历史会话'
  };
  return labels[state] || '等待会话列表';
}

function diagnosticsText(payload) {
  const connection = payload.connection || {};
  const bridge = payload.bridge || {};
  const identity = payload.identity || {};
  const instanceProvider = payload.instanceProvider || {};
  const lines = [
    `state: ${payload.state || 'unknown'}`,
    `module: ${payload.module?.id || 'bondie-side-panel'}`,
    `identity_mode: ${identity.mode || 'legacy-paired'}`,
    `identity_authenticated: ${Boolean(identity.authenticated)}`,
    `identity_reason: ${redactText(identity.reason || 'none')}`,
    `instance_provider: ${instanceProvider.provider || 'legacy-session-bridge'}`,
    `instance_provider_ready: ${Boolean(instanceProvider.ready)}`,
    `instance_provider_reason: ${redactText(instanceProvider.reason || 'none')}`,
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

function isControlPlanePayload(payload = {}) {
  return payload.instanceProvider?.provider === 'bondie-control-plane'
    || isControlPlaneBridge(payload.bridge || {});
}

function isControlPlaneBridge(bridge = {}) {
  return bridge.adapter === 'bondie-control-plane'
    || bridge.remote?.adapter?.adapter === 'bondie-control-plane'
    || bridge.remote?.bridgeId === 'bondie-control-plane';
}

function sessionTitle(session) {
  return String(session.title || session.session_id || session.session_key || 'Bondie session').trim();
}

function sessionIdentity(session) {
  return session.session_id || session.session_key || '';
}

function scopedSessionIdentity(session) {
  return `${session.instance_id || 'legacy-session-bridge'}::${sessionIdentity(session)}`;
}

function relationshipLabel(type) {
  const labels = {
    subordinate: '个人私助',
    communication: '服务关系',
    legacy_direct: '当前 Bridge'
  };
  return labels[type] || '关系';
}

function normalizeCollectionKind(value, visibilityPolicy) {
  const kind = String(value || '').trim();
  if (kind === 'route_index' || kind === 'generation_list') {
    return kind;
  }
  return visibilityPolicy === 'all_sessions' ? 'route_index' : 'generation_list';
}

function collectionKind(value) {
  return normalizeCollectionKind(value?.collection_kind, value?.visibility_policy);
}

function collectionLabel(value) {
  if (collectionKind(value) === 'route_index') {
    return '对象索引';
  }
  return visibilityLabel(value?.visibility_policy);
}

function visibilityLabel(policy) {
  const labels = {
    all_sessions: '查看全部',
    participant_sessions: '仅相关'
  };
  return labels[policy] || '权限';
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

function popupReplyText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed === '{"ok":true}') {
    return '';
  }
  return compactText(extractReadableSummary(trimmed), 180);
}

function extractReadableSummary(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const path = extractMarkdownPath(normalized);
  const withoutPath = path ? normalized.replace(path, '').trim() : normalized;
  const markerPatterns = [
    /(?:TL;?DR|TL；?DR|TLDR)[：:]\s*([^【\[]+)/i,
    /【摘要】\s*([^【\[]+)/,
    /摘要[：:]\s*([^【\[]+)/
  ];
  for (const pattern of markerPatterns) {
    const match = withoutPath.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return withoutPath;
}

function extractMarkdownPath(text) {
  const raw = typeof text === 'string' ? text : '';
  const match = raw.match(/(?:~|\/Users|\/tmp|\/var|\/private|\/)[^\n\r"'`<>]*?\.md\b/);
  return match ? match[0].trim() : '';
}

function compactText(text, limit) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
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
