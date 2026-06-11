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
  newSession: document.getElementById('newSession'),
  switchSession: document.getElementById('switchSession'),
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
  ready: {
    kicker: 'Ready',
    title: 'Side Panel shell 已就绪',
    summary: '连接、配对和 Bridge 配置都已满足，可以进入会话列表 adapter。'
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

elements.refresh.addEventListener('click', () => refreshStatus());
elements.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
elements.newSession.title = 'Phase 4 会启用新开对话，并按 new_conversation_confirmed 判断完成态';
elements.switchSession.title = 'Phase 4 会启用切换会话，并按 route_switch_confirmed 判断完成态';

refreshStatus();
setInterval(refreshStatus, 4000);

async function refreshStatus() {
  setLoading(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'sidePanel.status' });
    if (!response?.ok) {
      renderError(response?.error || 'Side Panel status unavailable');
      return;
    }
    renderStatus(response.payload || {});
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoading(false);
  }
}

function renderStatus(payload) {
  const state = payload.state || 'booting';
  const copy = STATE_COPY[state] || STATE_COPY.booting;
  const connection = payload.connection || {};
  const bridge = payload.bridge || {};
  const module = payload.module || {};
  const scope = payload.scope || {};

  elements.panelState.textContent = stateLabel(state);
  elements.panelState.dataset.state = statusTone(state);
  elements.stateKicker.textContent = copy.kicker;
  elements.stateTitle.textContent = copy.title;
  elements.stateSummary.textContent = copy.summary;
  elements.pairingValue.textContent = pairingLabel(connection);
  elements.onlineValue.textContent = onlineLabel(connection);
  elements.moduleValue.textContent = module.enabled ? '已启用' : '已禁用';
  elements.bridgeValue.textContent = bridgeLabel(bridge);
  elements.scopeHint.textContent = scope.route_label || 'Browser route';
  elements.workspaceValue.textContent = scope.workspace_id || 'default';
  elements.routeValue.textContent = scope.route_key || 'browser:default';
  elements.deviceValue.textContent = shortId(scope.device_id || connection.hostId || '');
  elements.actionHint.textContent = actionHint(payload);
  elements.phaseValue.textContent = payload.phase?.current || 'Phase 2';
  elements.nextStep.textContent = payload.phase?.next || '下一步接入 Session Bridge adapter。';
  elements.newSession.disabled = true;
  elements.switchSession.disabled = true;
  elements.diagnosticsOutput.textContent = diagnosticsText(payload);
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
  elements.diagnosticsOutput.textContent = `error: ${redactText(message)}`;
}

function setLoading(loading) {
  elements.refresh.disabled = loading;
}

function stateLabel(state) {
  const labels = {
    disabled: '已禁用',
    unpaired: '未配对',
    offline: '离线',
    missing_config: '待配置',
    ready: 'Ready',
    booting: '检查中'
  };
  return labels[state] || '检查中';
}

function statusTone(state) {
  if (state === 'ready') {
    return 'online';
  }
  if (state === 'missing_config' || state === 'offline') {
    return 'paired';
  }
  if (state === 'booting') {
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
    return 'Session Bridge adapter 接入后启用 new/switch';
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

function diagnosticsText(payload) {
  const connection = payload.connection || {};
  const bridge = payload.bridge || {};
  const lines = [
    `state: ${payload.state || 'unknown'}`,
    `module: ${payload.module?.id || 'openclaw-side-panel'}`,
    `adapter: ${bridge.adapter || 'session-bridge'}`,
    `bridge_state: ${bridge.state || 'unknown'}`,
    `bridge_configured: ${Boolean(bridge.configured)}`,
    `bridge_auth_configured: ${Boolean(bridge.authConfigured)}`,
    `host: ${shortId(connection.hostId || '')}`,
    `last_error: ${redactText(connection.lastError || 'none')}`,
    `updated_at: ${payload.updatedAt || 'unknown'}`
  ];
  return lines.join('\n');
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
