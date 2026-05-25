import {
  DEFAULT_PATTERN_SETTINGS,
  SNAPSHOT_ALARM_NAME,
  createPatternMemory
} from './pattern-memory.js';

const DEFAULT_CONFIG = {
  gatewayUrl: '',
  token: '',
  authMode: 'gateway-token',
  nodeName: 'OpenClaw Browser Host',
  protocol: 'node-compatible',
  autoConnect: false,
  contextCaptureEnabled: true,
  suggestionsEnabled: true,
  ...DEFAULT_PATTERN_SETTINGS
};
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const RECONNECT_ALARM_MINUTES = 1;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const NODE_CLIENT_ID = 'node-host';
const NODE_PROTOCOL_VERSION = 3;
const NODE_CATEGORIES = ['browser', 'user'];
const CAPABILITIES = [
  'browser.notify',
  'system.notify',
  'browser.current_tab.info',
  'browser.current_tab.extract',
  'browser.downloads.summary',
  'browser.pattern.open',
  'browser.suggestion.show',
  'user.confirm'
];
const SUGGESTIONS_STORAGE_KEY = 'browserSuggestions';
const MAX_SUGGESTIONS = 20;

let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectEnabled = false;
let lastInvokeId = '';
let pendingConfirm = null;
let hostIdentity = null;
const patternMemory = createPatternMemory(chrome);
let status = {
  connected: false,
  connecting: false,
  registered: false,
  online: false,
  hostId: '',
  nodeId: '',
  pairing: '',
  lastError: '',
  lastConnectedAt: '',
  lastDisconnectedAt: '',
  lastCommand: ''
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  await chrome.storage.local.set({ ...DEFAULT_CONFIG, ...existing });
  await ensureHostIdentity();
  await patternMemory.ensureDefaults();
  await patternMemory.ensureSnapshotAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'openclaw-reconnect') {
    connectGateway().catch((error) => setStatus({ lastError: error.message }));
    return;
  }

  if (alarm.name === SNAPSHOT_ALARM_NAME) {
    handlePatternSnapshotAlarm().catch((error) => setStatus({ lastError: error.message }));
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  handleNotificationClick(notificationId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

initializeServiceWorker().catch((error) => setStatus({ lastError: error.message }));

async function initializeServiceWorker() {
  await ensureHostIdentity();
  await patternMemory.ensureDefaults();
  await patternMemory.ensureSnapshotAlarm();
}

async function handleRuntimeMessage(message) {
  switch (message?.type) {
    case 'status':
      return { ok: true, status };
    case 'connect':
      await connectGateway();
      return { ok: true, status };
    case 'disconnect':
      disconnectGateway();
      return { ok: true, status };
    case 'notify':
      return showNotification(message.payload ?? {});
    case 'currentTab':
      return currentTabInfo();
    case 'pageSummary':
      return currentPageSummary();
    case 'downloadsSummary':
      return downloadsSummary(message.payload ?? {});
    case 'userConfirm':
      return userConfirm(message.payload ?? {});
    case 'patterns':
      return patternMemory.listPatterns();
    case 'saveCurrentPattern':
      return saveCurrentPattern(message.payload ?? {});
    case 'openPattern':
      return openPatternAndEmit(message.payload ?? {});
    case 'saveCandidate':
      return savePatternCandidate(message.payload ?? {});
    case 'clearPatternData':
      return patternMemory.clearLocalData();
    case 'contextCapture':
      return captureCurrentContext();
    case 'suggestions':
      return listSuggestions();
    case 'suggestionFeedback':
      return handleSuggestionFeedback(message.payload ?? {});
    default:
      return { ok: false, error: `Unknown message type: ${message?.type}` };
  }
}

async function connectGateway() {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.gatewayUrl) {
    throw new Error('Gateway URL is not configured');
  }
  const storedAuth = await chrome.storage.local.get(['browserDeviceToken']);
  if (config.protocol !== 'browser-host' && !config.token && !storedAuth.browserDeviceToken) {
    throw new Error('Token is required until this browser node is paired');
  }

  reconnectEnabled = true;
  clearReconnectSchedule();
  setStatus({ connecting: true, lastError: '' });
  const identity = await ensureHostIdentity();

  if (socket) {
    socket.close(1000, 'reconnect requested');
    socket = null;
  }

  socket = new WebSocket(config.gatewayUrl);
  const activeSocket = socket;
  socket.addEventListener('open', () => {
    reconnectAttempt = 0;
    setStatus({
      connected: true,
      connecting: false,
      online: true,
      hostId: identity.hostId,
      pairing: storedAuth.browserDeviceToken ? 'paired' : status.pairing,
      lastError: '',
      lastConnectedAt: new Date().toISOString()
    });
    if (config.protocol === 'browser-host') {
      sendBrowserHostRegisterMessage(config, identity);
      startHeartbeat(config, identity);
    }
  });

  socket.addEventListener('message', (event) => {
    handleGatewayMessage(event.data).catch((error) => {
      sendGatewayMessage({
        type: 'browser.host.error',
        error: error.message
      });
    });
  });

  socket.addEventListener('close', () => {
    if (socket === activeSocket) {
      socket = null;
    }
    stopHeartbeat();
    setStatus({
      connected: false,
      connecting: false,
      online: false,
      lastDisconnectedAt: new Date().toISOString()
    });
    if (reconnectEnabled) {
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', () => {
    setStatus({ connecting: false, lastError: 'WebSocket error' });
  });
}

function disconnectGateway() {
  reconnectEnabled = false;
  clearReconnectSchedule();
  stopHeartbeat();
  if (socket) {
    socket.close(1000, 'manual disconnect');
    socket = null;
  }
  setStatus({
    connected: false,
    connecting: false,
    online: false,
    lastDisconnectedAt: new Date().toISOString()
  });
}

function scheduleReconnect() {
  clearReconnectSchedule();
  const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectGateway().catch((error) => setStatus({ lastError: error.message }));
  }, delay);
  chrome.alarms.create('openclaw-reconnect', { delayInMinutes: RECONNECT_ALARM_MINUTES });
}

function clearReconnectSchedule() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  chrome.alarms.clear('openclaw-reconnect');
}

async function handleGatewayMessage(raw) {
  const message = JSON.parse(raw);
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));

  if (config.protocol !== 'browser-host' && await handleOpenClawNodeMessage(message, config)) {
    return;
  }

  if (message.type === 'browser.host.registered' || message.type === 'node.registered') {
    setStatus({ registered: true, lastError: '' });
    return;
  }

  if (message.type === 'browser.host.pong' || message.type === 'node.pong' || message.type === 'pong') {
    setStatus({ lastHeartbeatAt: new Date().toISOString() });
    return;
  }

  const isBrowserInvoke = message.type === 'browser.host.invoke';
  const isNodeInvoke = message.type === 'node.invoke';
  if (!isBrowserInvoke && !isNodeInvoke) {
    return;
  }

  lastInvokeId = message.id || '';
  setStatus({ lastCommand: message.command || '' });
  const result = await executeCommand(message.command, message.args ?? {});

  if (isBrowserInvoke) {
    sendGatewayMessage({
      type: 'browser.host.invoke.result',
      id: message.id,
      hostId: status.hostId || undefined,
      command: message.command,
      ...result
    });
    return;
  }

  sendGatewayMessage({
    type: 'node.invoke.result',
    id: message.id,
    ...result
  });
}

async function ensureHostIdentity() {
  if (hostIdentity) {
    return hostIdentity;
  }

  const stored = await chrome.storage.local.get(['browserHostIdentity']);
  const auth = await chrome.storage.local.get(['browserDeviceToken']);
  if (stored.browserHostIdentity?.privateKeyJwk && stored.browserHostIdentity?.publicKeyBase64Url) {
    hostIdentity = stored.browserHostIdentity;
    setStatus({ hostId: hostIdentity.hostId, pairing: auth.browserDeviceToken ? 'paired' : status.pairing });
    return hostIdentity;
  }

  const generated = await generateDeviceIdentity();
  hostIdentity = {
    ...generated,
    legacyHostId: stored.browserHostIdentity?.hostId || undefined,
    createdAt: new Date().toISOString(),
    kind: 'browser-extension'
  };
  await chrome.storage.local.set({ browserHostIdentity: hostIdentity });
  setStatus({ hostId: hostIdentity.hostId, pairing: auth.browserDeviceToken ? 'paired' : status.pairing });
  return hostIdentity;
}

async function generateDeviceIdentity() {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyHash = await crypto.subtle.digest('SHA-256', publicKeyRaw);

  return {
    hostId: bytesToHex(publicKeyHash),
    publicKeyBase64Url: base64UrlEncode(publicKeyRaw),
    privateKeyJwk,
    algorithm: 'Ed25519'
  };
}

function sendBrowserHostRegisterMessage(config, identity) {
  const payload = {
    type: 'browser.host.register',
    protocolVersion: 1,
    hostId: identity.hostId,
    hostName: config.nodeName || 'OpenClaw Browser Host',
    runtime: 'chrome-extension-mv3',
    token: config.token || undefined,
    capabilities: CAPABILITIES,
    userAgent: navigator.userAgent,
    connectedAt: new Date().toISOString()
  };

  sendGatewayMessage(payload);
}

function startHeartbeat(config, identity) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (config.protocol === 'node-compatible') {
      sendGatewayMessage({
        type: 'req',
        id: crypto.randomUUID(),
        method: 'ping',
        params: {
          client: NODE_CLIENT_ID,
          deviceId: identity.hostId,
          sentAt: new Date().toISOString()
        }
      });
      return;
    }

    const heartbeat = {
      type: 'browser.host.heartbeat',
      hostId: identity.hostId,
      hostName: config.nodeName || 'OpenClaw Browser Host',
      sentAt: new Date().toISOString()
    };
    sendGatewayMessage(heartbeat);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function executeCommand(command, args) {
  switch (command) {
    case 'browser.notify':
    case 'system.notify':
      return showNotification(args);
    case 'browser.current_tab.info':
      return currentTabInfo();
    case 'browser.current_tab.extract':
      return currentPageSummary();
    case 'browser.downloads.summary':
      return downloadsSummary(args);
    case 'browser.pattern.open':
      return openPatternAndEmit(args);
    case 'browser.suggestion.show':
      return showSuggestion(args);
    case 'user.confirm':
      return userConfirm(args);
    default:
      return { ok: false, error: `Unsupported command: ${command}` };
  }
}

async function handleNotificationClick(notificationId) {
  const payload = {
    notificationId,
    clickedAt: new Date().toISOString()
  };

  try {
    if (await emitOpenClawEvent('notification.clicked', payload)) {
      return;
    }
  } catch {
    // Nothing else to do; notification clicks are best-effort telemetry.
  }
}

async function handleOpenClawNodeMessage(message, config) {
  if (message.type === 'event') {
    const eventType = message.event || '';
    if (eventType === 'connect.challenge') {
      await sendOpenClawNodeConnect(config, message.payload || {});
      return true;
    }

    if (eventType === 'node.invoke.request') {
      await handleNodeInvokeEvent(message.payload || {});
      return true;
    }

    if (eventType === 'node.pair.requested' || eventType === 'device.pair.requested') {
      const stored = await chrome.storage.local.get(['browserDeviceToken']);
      if (stored.browserDeviceToken || status.pairing === 'paired') {
        return true;
      }
      setStatus({ pairing: 'pending', lastError: 'Pairing approval required' });
      return true;
    }

    if (eventType === 'node.pair.resolved' || eventType === 'device.pair.resolved') {
      const decision = message.payload?.decision || 'unknown';
      setStatus({ pairing: decision, lastError: decision === 'approved' ? '' : status.lastError });
      if (decision === 'approved' && socket) {
        socket.close();
      }
      return true;
    }

    return false;
  }

  if (message.type === 'res') {
    await handleNodeResponse(message);
    return true;
  }

  if (message.type === 'req') {
    await handleNodeRequest(message);
    return true;
  }

  return false;
}

async function sendOpenClawNodeConnect(config, challengePayload) {
  const identity = await ensureHostIdentity();
  const stored = await chrome.storage.local.get(['browserDeviceToken']);
  const auth = buildNodeAuth(config, stored.browserDeviceToken);
  const nonce = challengePayload.nonce || '';
  const signedAt = Date.now();
  const signature = await signNodeConnectPayload(identity, nonce, signedAt, auth.tokenForSignature);

  sendGatewayMessage({
    type: 'req',
    id: crypto.randomUUID(),
    method: 'connect',
    params: {
      minProtocol: NODE_PROTOCOL_VERSION,
      maxProtocol: NODE_PROTOCOL_VERSION,
      client: {
        id: NODE_CLIENT_ID,
        version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
        platform: 'browser',
        mode: 'node',
        displayName: config.nodeName || 'OpenClaw Browser Host'
      },
      role: 'node',
      scopes: [],
      caps: NODE_CATEGORIES,
      commands: CAPABILITIES,
      permissions: {},
      auth: auth.payload,
      locale: navigator.language || 'zh-CN',
      userAgent: navigator.userAgent,
      device: {
        id: identity.hostId,
        publicKey: identity.publicKeyBase64Url,
        signature,
        signedAt,
        nonce
      }
    }
  });
}

function buildNodeAuth(config, deviceToken) {
  if (deviceToken) {
    return {
      payload: { token: deviceToken },
      tokenForSignature: deviceToken
    };
  }

  if (config.authMode === 'bootstrap-token') {
    return {
      payload: { bootstrapToken: config.token || '' },
      tokenForSignature: config.token || ''
    };
  }

  return {
    payload: { token: config.token || '' },
    tokenForSignature: config.token || ''
  };
}

async function signNodeConnectPayload(identity, nonce, signedAt, authToken) {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    identity.privateKeyJwk,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  const payload = `v2|${identity.hostId}|${NODE_CLIENT_ID}|node|node||${signedAt}|${authToken || ''}|${nonce || ''}`;
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(payload)
  );
  return base64UrlEncode(signature);
}

async function handleNodeResponse(message) {
  if (message.ok === false) {
    const code = message.error?.code || '';
    const errorMessage = message.error?.message || 'Node request failed';
    if (code === 'NOT_PAIRED') {
      setStatus({
        pairing: 'pending',
        lastError: `Pairing required: ${message.error?.details?.requestId || 'pending approval'}`
      });
      reconnectEnabled = false;
      return;
    }
    setStatus({ lastError: errorMessage });
    return;
  }

  const payload = message.payload || {};
  if (payload.type !== 'hello-ok') {
    return;
  }

  const patch = {
    registered: true,
    connected: true,
    connecting: false,
    online: true,
    pairing: 'paired',
    nodeId: payload.nodeId || status.hostId,
    lastError: ''
  };

  const deviceToken = payload.auth?.deviceToken;
  if (deviceToken) {
    chrome.storage.local.set({ browserDeviceToken: deviceToken });
  }

  setStatus(patch);
  chrome.storage.local.set({ browserPairingStatus: 'paired' });
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  const identity = await ensureHostIdentity();
  startHeartbeat(config, identity);
}

async function handleNodeRequest(message) {
  if (message.method === 'ping') {
    sendGatewayMessage({
      type: 'res',
      id: message.id,
      ok: true,
      payload: { pong: true }
    });
    return;
  }

  if (message.method === 'node.invoke') {
    const command = message.params?.command || '';
    const args = message.params?.args || {};
    lastInvokeId = message.id || '';
    setStatus({ lastCommand: command });
    const result = await executeCommand(command, args);
    sendGatewayMessage({
      type: 'res',
      id: message.id,
      ok: result.ok,
      payload: result.payload,
      error: result.ok ? undefined : { message: result.error || 'Command failed' }
    });
    return;
  }

  sendGatewayMessage({
    type: 'res',
    id: message.id,
    ok: false,
    error: { message: `Unknown method: ${message.method}` }
  });
}

async function handleNodeInvokeEvent(payload) {
  const requestId = payload.requestId || payload.id || '';
  const command = payload.command || '';
  let args = payload.args || {};

  if (!payload.args && typeof payload.paramsJSON === 'string') {
    try {
      args = JSON.parse(payload.paramsJSON);
    } catch {
      args = {};
    }
  }

  if (!requestId || !command) {
    return;
  }

  lastInvokeId = requestId;
  setStatus({ lastCommand: command });
  const result = await executeCommand(command, args);

  sendGatewayMessage({
    type: 'req',
    id: crypto.randomUUID(),
    method: 'node.invoke.result',
    params: {
      id: requestId,
      nodeId: status.nodeId || status.hostId,
      ok: result.ok,
      payload: result.payload,
      error: result.ok ? undefined : { message: result.error || 'Command failed' }
    }
  });
}

async function sendNodeEvent(eventName, payload) {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (config.protocol !== 'node-compatible') {
    return false;
  }
  return sendGatewayMessage({
    type: 'req',
    id: crypto.randomUUID(),
    method: 'node.event',
    params: {
      event: eventName,
      payloadJSON: JSON.stringify(payload || {})
    }
  });
}

function sendGatewayMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

function setStatus(patch) {
  status = { ...status, ...patch };
  chrome.storage.local.set({ connectionStatus: status });
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function showNotification(args) {
  const id = `openclaw-${Date.now()}`;
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: '../icons/icon-128.png',
    title: args.title || 'OpenClaw',
    message: args.body || args.message || ''
  });
  return {
    ok: true,
    payload: {
      sent: true,
      notificationId: id,
      requestId: lastInvokeId || undefined
    }
  };
}

async function currentTabInfo() {
  const tab = await getActiveWebTab();
  if (!tab) {
    return { ok: false, error: 'No active web tab' };
  }

  return {
    ok: true,
    payload: {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId
    }
  };
}

async function currentPageSummary() {
  const tab = await getActiveWebTab();
  if (!tab?.id) {
    return { ok: false, error: 'No active web tab' };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content.js']
    });
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'pageSummary' });
    return { ok: true, payload: response };
  } catch (error) {
    return { ok: false, error: `Page summary failed: ${error.message}` };
  }
}

async function getActiveWebTab() {
  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const direct = focused.find(isWebTab);
  if (direct) {
    return direct;
  }

  const candidates = await chrome.tabs.query({});
  return candidates
    .filter(isWebTab)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

function isWebTab(tab) {
  return typeof tab.url === 'string' &&
    (tab.url.startsWith('http://') || tab.url.startsWith('https://'));
}

async function downloadsSummary(args) {
  const lookbackMinutes = Math.max(1, Math.min(Number(args.lookbackMinutes || 60), 60 * 24 * 30));
  const since = Date.now() - lookbackMinutes * 60 * 1000;
  const items = await chrome.downloads.search({
    startedAfter: new Date(since).toISOString(),
    orderBy: ['-startTime'],
    limit: Math.max(1, Math.min(Number(args.maxItems || 50), 200))
  });

  return {
    ok: true,
    payload: {
      lookbackMinutes,
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        filename: item.filename,
        url: item.url,
        finalUrl: item.finalUrl,
        state: item.state,
        mime: item.mime,
        bytesReceived: item.bytesReceived,
        totalBytes: item.totalBytes,
        startTime: item.startTime,
        endTime: item.endTime,
        exists: item.exists
      }))
    }
  };
}

async function handlePatternSnapshotAlarm() {
  const result = await patternMemory.captureHourlySnapshot();
  if (!result.ok) {
    return;
  }

  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.patternUploadEnabled) {
    return;
  }

  await emitOpenClawEvent('browser.pattern.snapshot', result.summary);
  if (result.candidates.length) {
    await emitOpenClawEvent('browser.pattern.detected', {
      detectedAt: new Date().toISOString(),
      candidates: result.candidates.map(summarizePatternForEvent)
    });
  }
}

async function saveCurrentPattern(args) {
  const result = await patternMemory.saveCurrentWindowPattern(args.name);
  if (!result.ok) {
    return result;
  }

  await maybeEmitPatternEvent('browser.pattern.detected', {
    detectedAt: new Date().toISOString(),
    source: 'manual',
    pattern: summarizePatternForEvent(result.pattern)
  });
  return result;
}

async function savePatternCandidate(args) {
  const result = await patternMemory.saveCandidate(args.candidateId);
  if (!result.ok) {
    return result;
  }

  await maybeEmitPatternEvent('browser.pattern.detected', {
    detectedAt: new Date().toISOString(),
    source: 'candidate',
    pattern: summarizePatternForEvent(result.pattern)
  });
  return result;
}

async function openPatternAndEmit(args) {
  const result = await patternMemory.openPattern(args);
  if (!result.ok) {
    return result;
  }

  await emitOpenClawEvent('browser.pattern.opened', {
    patternId: result.payload.patternId,
    name: result.payload.name,
    openedAt: result.payload.openedAt,
    windowId: result.payload.windowId,
    urlCount: result.payload.urls.length,
    origins: uniqueOrigins(result.payload.urls)
  });

  return result;
}

async function captureCurrentContext() {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.contextCaptureEnabled) {
    return { ok: false, error: 'Context Capture is disabled' };
  }

  const summary = await currentPageSummary();
  if (!summary.ok) {
    return summary;
  }

  const payload = {
    url: summary.payload.url,
    title: summary.payload.title,
    selectedText: summary.payload.selection || '',
    textPreview: summary.payload.textPreview || '',
    capturedAt: new Date().toISOString()
  };

  const sent = await emitOpenClawEvent('browser.context.capture', payload);
  if (!sent) {
    return {
      ok: false,
      error: 'OpenClaw is not connected',
      payload
    };
  }

  return {
    ok: true,
    payload: {
      ...payload,
      sent: true
    }
  };
}

async function showSuggestion(args) {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.suggestionsEnabled) {
    return { ok: false, error: 'Suggestions are disabled' };
  }

  const suggestion = normalizeSuggestion(args);
  const stored = await chrome.storage.local.get([SUGGESTIONS_STORAGE_KEY]);
  const suggestions = [
    suggestion,
    ...(stored[SUGGESTIONS_STORAGE_KEY] || []).filter((item) => item.id !== suggestion.id)
  ].slice(0, MAX_SUGGESTIONS);
  await chrome.storage.local.set({ [SUGGESTIONS_STORAGE_KEY]: suggestions });

  return {
    ok: true,
    payload: suggestion
  };
}

async function listSuggestions() {
  const stored = await chrome.storage.local.get([SUGGESTIONS_STORAGE_KEY]);
  return {
    ok: true,
    payload: {
      suggestions: stored[SUGGESTIONS_STORAGE_KEY] || []
    }
  };
}

async function handleSuggestionFeedback(args) {
  const suggestionId = args.suggestionId || '';
  const action = args.action || '';
  const stored = await chrome.storage.local.get([SUGGESTIONS_STORAGE_KEY]);
  const suggestions = stored[SUGGESTIONS_STORAGE_KEY] || [];
  const suggestion = suggestions.find((item) => item.id === suggestionId);

  if (!suggestion || (action !== 'accepted' && action !== 'dismissed')) {
    return { ok: false, error: 'Unknown suggestion feedback' };
  }

  const feedbackAt = new Date().toISOString();
  if (action === 'accepted' && suggestion.urls.length) {
    await patternMemory.openPattern({
      patternId: suggestion.id,
      urls: suggestion.urls
    });
  }

  await chrome.storage.local.set({
    [SUGGESTIONS_STORAGE_KEY]: suggestions.filter((item) => item.id !== suggestionId)
  });

  const eventName = action === 'accepted' ? 'browser.suggestion.accepted' : 'browser.suggestion.dismissed';
  const sent = await emitOpenClawEvent(eventName, {
    suggestionId: suggestion.id,
    title: suggestion.title,
    action,
    feedbackAt,
    urlCount: suggestion.urls.length,
    origins: uniqueOrigins(suggestion.urls)
  });

  return {
    ok: true,
    payload: {
      suggestionId,
      action,
      sent,
      feedbackAt
    }
  };
}

async function maybeEmitPatternEvent(eventName, payload) {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.patternUploadEnabled) {
    return false;
  }
  return emitOpenClawEvent(eventName, payload);
}

async function emitOpenClawEvent(eventName, payload) {
  try {
    if (await sendNodeEvent(eventName, payload)) {
      return true;
    }
  } catch {
    // Browser Host fallback below preserves the existing best-effort event path.
  }

  return sendGatewayMessage({
    type: 'browser.host.event',
    event: eventName,
    payload
  });
}

function normalizeSuggestion(args) {
  const urls = Array.isArray(args.urls)
    ? args.urls.filter(isWebUrl).slice(0, 10)
    : [];

  return {
    id: args.id || args.suggestionId || crypto.randomUUID(),
    title: (args.title || 'OpenClaw suggestion').slice(0, 120),
    message: (args.message || args.body || '').slice(0, 500),
    urls,
    createdAt: new Date().toISOString(),
    source: 'openclaw'
  };
}

function summarizePatternForEvent(pattern) {
  const urls = (pattern.tabs || []).map((tab) => tab.url).filter(Boolean);
  return {
    id: pattern.id,
    name: pattern.name,
    source: pattern.source,
    savedAt: pattern.savedAt,
    firstSeenAt: pattern.firstSeenAt,
    lastSeenAt: pattern.lastSeenAt,
    cooccurrenceCount: pattern.cooccurrenceCount,
    confidence: pattern.confidence,
    urlCount: urls.length,
    origins: uniqueOrigins(urls)
  };
}

function uniqueOrigins(urls) {
  return [...new Set(urls.filter(isWebUrl).map((url) => new URL(url).origin))];
}

function isWebUrl(url) {
  return typeof url === 'string' &&
    (url.startsWith('http://') || url.startsWith('https://'));
}

async function userConfirm(args) {
  if (pendingConfirm) {
    return { ok: false, error: 'Another confirmation is already pending' };
  }

  const title = args.title || 'OpenClaw confirmation';
  const message = args.message || args.body || 'Allow this action?';
  pendingConfirm = { title, message, createdAt: new Date().toISOString() };

  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL(
        `src/confirm.html?title=${encodeURIComponent(title)}&message=${encodeURIComponent(message)}`
      ),
      type: 'popup',
      width: 420,
      height: 260,
      focused: true
    });

    const result = await waitForConfirmation();
    return {
      ok: true,
      payload: {
        confirmed: result.confirmed,
        action: result.confirmed ? 'confirmed' : 'rejected',
        respondedAt: new Date().toISOString()
      }
    };
  } finally {
    pendingConfirm = null;
  }
}

function waitForConfirmation() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ confirmed: false });
    }, CONFIRM_TIMEOUT_MS);

    const listener = (message) => {
      if (message?.type !== 'confirmResult') {
        return;
      }
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ confirmed: Boolean(message.confirmed) });
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}
