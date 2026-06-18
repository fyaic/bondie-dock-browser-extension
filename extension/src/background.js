import {
  DEFAULT_PATTERN_SETTINGS,
  SNAPSHOT_ALARM_NAME,
  createPatternMemory
} from './pattern-memory.js';
import {
  SIDE_PANEL_DEFAULT_CONFIG,
  openClawSidePanelModule
} from './modules/openclaw-side-panel/module.js';
import {
  normalizeOAuthTokenState
} from './modules/openclaw-side-panel/oauth-token-contract.js';

const DEFAULT_CONFIG = {
  gatewayUrl: '',
  token: '',
  authMode: 'gateway-token',
  nodeName: 'OpenClaw Browser Host',
  protocol: 'node-compatible',
  autoConnect: false,
  contextCaptureEnabled: true,
  captureSessionKey: 'browser-inbox',
  handoffTimeoutMinutes: 10,
  mediaToNotesEnabled: true,
  mediaToNotesPluginPath: '',
  mediaToNotesOutputDir: '~/.openclaw/workspace/browser-notes',
  mediaToNotesEnvFile: '',
  mediaToNotesDefaultFlags: '--skip-polish',
  suggestionsEnabled: true,
  ...SIDE_PANEL_DEFAULT_CONFIG,
  ...DEFAULT_PATTERN_SETTINGS
};
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const RECONNECT_ALARM_MINUTES = 1;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const PATTERN_OBSERVE_DEBOUNCE_MS = 3 * 1000;
const PATTERN_OBSERVE_MIN_INTERVAL_MS = 60 * 1000;
const PATTERN_OBSERVE_STATE_KEY = 'browserPatternObserveState';
const PATTERN_SUGGESTION_STATE_KEY = 'browserPatternSuggestionState';
const PATTERN_SUGGESTION_COOLDOWN_MS = 60 * 60 * 1000;
const PATTERN_SUGGESTION_DISMISS_MS = 24 * 60 * 60 * 1000;
const NODE_CLIENT_ID = 'node-host';
const NODE_PROTOCOL_VERSION = 4;
const NODE_CATEGORIES = ['browser', 'user'];
const DEFAULT_CAPTURE_SESSION_KEY = 'browser-inbox';
const MEDIA_TO_NOTES_PLUGIN_ID = 'media-to-notes';
const MEDIA_TO_NOTES_PLUGIN_NAME = 'Media to Notes';
const CAPABILITIES = [
  'browser.notify',
  'system.notify',
  'browser.current_tab.info',
  'browser.current_tab.extract',
  'browser.downloads.summary',
  'browser.pattern.open',
  'browser.page.service',
  'browser.knowledge.capture',
  'browser.suggestion.show',
  'user.confirm'
];
const FEATURE_MODULES = [
  openClawSidePanelModule
];
const FEATURE_MESSAGE_HANDLERS = buildFeatureMessageHandlers(FEATURE_MODULES);
const SUGGESTIONS_STORAGE_KEY = 'browserSuggestions';
const HANDOFFS_STORAGE_KEY = 'browserHandoffs';
const HANDOFF_TIMEOUT_ALARM_NAME = 'openclaw-handoff-timeout';
const HANDOFF_TIMEOUT_CHECK_MINUTES = 1;
const MIN_HANDOFF_TIMEOUT_MINUTES = 1;
const MAX_HANDOFF_TIMEOUT_MINUTES = 120;
const MAX_SUGGESTIONS = 20;
const MAX_HANDOFFS = 20;
const MAX_HANDOFF_REPLY_CHARS = 8000;

let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnectEnabled = false;
let nextAutoConnectAt = 0;
let patternObserveTimer = null;
let lastInvokeId = '';
let pendingConfirm = null;
let hostIdentity = null;
const pendingEventRequests = new Map();
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
  await initializeServiceWorker();
});

chrome.runtime.onStartup.addListener(() => {
  initializeServiceWorker().catch((error) => setStatus({ lastError: error.message }));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'openclaw-reconnect') {
    connectGateway().catch((error) => setStatus({ lastError: error.message }));
    return;
  }

  if (alarm.name === SNAPSHOT_ALARM_NAME) {
    handlePatternSnapshotAlarm().catch((error) => setStatus({ lastError: error.message }));
    return;
  }

  if (alarm.name === HANDOFF_TIMEOUT_ALARM_NAME) {
    reconcileHandoffTimeouts().catch((error) => setStatus({ lastError: error.message }));
  }
});

chrome.tabs.onActivated.addListener(() => {
  schedulePatternObservation('tab-activated');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url || tab?.active) {
    schedulePatternObservation('tab-updated');
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    schedulePatternObservation('window-focused');
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
  await ensureDefaultConfig();
  await restorePersistedStatus();
  await ensureHostIdentity();
  await patternMemory.ensureDefaults();
  await patternMemory.ensureSnapshotAlarm();
  await reconcileHandoffTimeouts();
  await scheduleHandoffTimeoutAlarm();
  schedulePatternObservation('service-worker-ready', { immediate: true });
  await maybeAutoConnect();
}

async function ensureDefaultConfig() {
  const keys = Object.keys(DEFAULT_CONFIG);
  const existing = await chrome.storage.local.get(keys);
  const missing = {};
  for (const key of keys) {
    if (existing[key] === undefined) {
      missing[key] = DEFAULT_CONFIG[key];
    }
  }
  if (Object.keys(missing).length) {
    await chrome.storage.local.set(missing);
  }
}

async function restorePersistedStatus() {
  const stored = await chrome.storage.local.get([
    'connectionStatus',
    'browserDeviceToken',
    'browserPairingStatus'
  ]);
  const previous = stored.connectionStatus || {};
  status = {
    ...status,
    ...previous,
    connected: false,
    connecting: false,
    registered: false,
    online: false,
    pairing: stored.browserDeviceToken ? 'paired' : stored.browserPairingStatus || previous.pairing || status.pairing,
    lastDisconnectedAt: previous.lastDisconnectedAt || new Date().toISOString()
  };
  await chrome.storage.local.set({ connectionStatus: status });
}

async function maybeAutoConnect() {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.autoConnect || !config.gatewayUrl || socket || status.connecting || Date.now() < nextAutoConnectAt) {
    return;
  }

  connectGateway().catch((error) => setStatus({
    connecting: false,
    lastError: error.message
  }));
}

async function handleRuntimeMessage(message, sender) {
  const featureResponse = await maybeHandleFeatureModuleMessage(message, sender);
  if (featureResponse) {
    return featureResponse;
  }

  switch (message?.type) {
    case 'status':
      await maybeAutoConnect();
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
    case 'pageMeta':
      return pageServiceInfo();
    case 'pageService':
      return runPageService(message.payload ?? {});
    case 'pageSummary':
      return currentPageSummary();
    case 'downloadsSummary':
      return downloadsSummary(message.payload ?? {});
    case 'userConfirm':
      return userConfirm(message.payload ?? {});
    case 'patterns':
      return listPatternsWithRelated();
    case 'saveCurrentPattern':
      return saveCurrentPattern(message.payload ?? {});
    case 'scanPatterns':
      return scanPatternsNow();
    case 'openPattern':
      return openPatternAndEmit(message.payload ?? {});
    case 'saveCandidate':
      return savePatternCandidate(message.payload ?? {});
    case 'clearPatternData':
      return patternMemory.clearLocalData();
    case 'contextCapture':
      return captureCurrentContext(message.payload ?? {});
    case 'suggestions':
      return listSuggestions();
    case 'suggestionFeedback':
      return handleSuggestionFeedback(message.payload ?? {});
    case 'retryHandoff':
      return retryHandoff(message.payload ?? {});
    case 'handoffs':
      return listHandoffs();
    default:
      return { ok: false, error: `Unknown message type: ${message?.type}` };
  }
}

function buildFeatureMessageHandlers(modules) {
  const handlers = new Map();
  for (const module of modules) {
    for (const [type, handler] of Object.entries(module.messages || {})) {
      handlers.set(type, { module, handler });
    }
  }
  return handlers;
}

async function maybeHandleFeatureModuleMessage(message, sender) {
  const route = FEATURE_MESSAGE_HANDLERS.get(message?.type);
  if (!route) {
    return null;
  }

  return route.handler({
    message,
    sender,
    context: {
      chrome,
      ensureHostIdentity,
      getConfig: (keys) => chrome.storage.local.get(keys),
      getConnectionStatus: () => ({ ...status }),
      getSidePanelOAuthToken,
      getTrustedPairingState
    }
  });
}

async function getSidePanelOAuthToken() {
  return normalizeOAuthTokenState({
    state: 'provider_unconfigured',
    accessToken: '',
    expiresAt: '',
    provider: '',
    viewer: null
  });
}

async function getTrustedPairingState() {
  const stored = await chrome.storage.local.get([
    'browserDeviceToken',
    'browserPairingStatus'
  ]);
  const hasDeviceToken = Boolean(cleanConfigString(stored.browserDeviceToken));
  const pairing = hasDeviceToken
    ? 'paired'
    : cleanConfigString(stored.browserPairingStatus) || cleanConfigString(status.pairing) || 'unpaired';

  return {
    paired: hasDeviceToken && pairing === 'paired',
    hasDeviceToken,
    pairing
  };
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
      connecting: config.protocol !== 'browser-host',
      online: config.protocol === 'browser-host',
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

  socket.addEventListener('close', (event) => {
    if (socket !== activeSocket) {
      return;
    }
    socket = null;
    stopHeartbeat();
    const closeError = formatWebSocketCloseError(event);
    setStatus({
      connected: false,
      connecting: false,
      online: false,
      lastError: closeError || status.lastError,
      lastDisconnectedAt: new Date().toISOString()
    });
    if (reconnectEnabled) {
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', () => {
    if (socket !== activeSocket) {
      return;
    }
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
  nextAutoConnectAt = Date.now() + delay;
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
  nextAutoConnectAt = 0;
  chrome.alarms.clear('openclaw-reconnect');
}

function formatWebSocketCloseError(event) {
  if (!event || event.code === 1000) {
    return '';
  }
  const reason = event.reason ? `: ${event.reason}` : '';
  return `WebSocket closed ${event.code}${reason}`;
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
      const sentAt = new Date().toISOString();
      sendNodeEvent('node.presence.alive', {
        trigger: 'connect',
        sentAtMs: Date.now(),
        displayName: config.nodeName || 'OpenClaw Browser Host',
        version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
        platform: 'chrome-extension-mv3',
        deviceFamily: 'browser'
      }).then((sent) => {
        if (sent) {
          setStatus({ lastHeartbeatAt: sentAt });
        }
      }).catch(() => {});
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
    case 'browser.page.service':
      return runPageService(args);
    case 'browser.knowledge.capture':
      return runPageService({ ...args, service: 'knowledge' });
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

    if (eventType === 'chat') {
      await handleSubscribedChatEvent(message.payload || {});
      return true;
    }

    if (eventType === 'agent') {
      await handleSubscribedAgentEvent(message.payload || {});
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
  if (await handleNodeEventResponse(message)) {
    return;
  }

  if (message.ok === false) {
    const code = message.error?.code || '';
    const errorMessage = formatNodeConnectError(message.error);
    if (await handleRecoverableNodeAuthError(errorMessage)) {
      return;
    }
    if (code === 'NOT_PAIRED') {
      setStatus({
        pairing: 'pending',
        lastError: `Pairing required: ${message.error?.details?.requestId || 'pending approval'}`
      });
      reconnectEnabled = false;
      return;
    }
    if (isAuthRateLimitedError(errorMessage)) {
      reconnectEnabled = false;
      clearReconnectSchedule();
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
  await subscribeToCaptureSession(config);
}

function formatNodeConnectError(error) {
  const message = error?.message || 'Node request failed';
  const details = error?.details || {};
  if (details.code !== 'PROTOCOL_MISMATCH') {
    return message;
  }

  const clientMin = details.clientMinProtocol ?? 'unknown';
  const clientMax = details.clientMaxProtocol ?? 'unknown';
  const expected = details.expectedProtocol ?? 'unknown';
  return `${message}: client ${clientMin}-${clientMax}, expected ${expected}`;
}

async function handleRecoverableNodeAuthError(errorMessage) {
  const stored = await chrome.storage.local.get(['browserDeviceToken', 'token']);
  if (!stored.browserDeviceToken || !stored.token) {
    return false;
  }

  if (!isDeviceTokenStaleError(errorMessage) && !isAuthRateLimitedError(errorMessage)) {
    return false;
  }

  await chrome.storage.local.remove(['browserDeviceToken']);
  await chrome.storage.local.set({ browserPairingStatus: 'stale' });
  setStatus({
    pairing: 'stale',
    lastError: 'Stored device token is no longer accepted; retrying with gateway token.'
  });
  reconnectAttempt = 0;
  if (socket) {
    socket.close(1000, 'stale device token reset');
  }
  scheduleReconnect();
  return true;
}

function isDeviceTokenStaleError(errorMessage) {
  return /device token scope mismatch|re-pair|approve scope upgrade/i.test(errorMessage || '');
}

function isAuthRateLimitedError(errorMessage) {
  return /too many failed authentication attempts|retry later/i.test(errorMessage || '');
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
  const id = crypto.randomUUID();
  const sent = sendGatewayMessage({
    type: 'req',
    id,
    method: 'node.event',
    params: {
      event: eventName,
      payloadJSON: JSON.stringify(payload || {})
    }
  });

  if (sent) {
    pendingEventRequests.set(id, {
      eventName,
      payload: payload || {},
      sentAt: new Date().toISOString()
    });
  }

  return sent;
}

async function handleNodeEventResponse(message) {
  const pending = pendingEventRequests.get(message.id);
  if (!pending) {
    return false;
  }

  pendingEventRequests.delete(message.id);
  if (pending.eventName !== 'agent.request') {
    return true;
  }

  const captureId = pending.payload.captureId || '';
  if (!captureId) {
    return true;
  }

  if (message.ok === false) {
    await patchHandoff(captureId, {
      state: 'error',
      error: message.error?.message || 'OpenClaw agent request failed',
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  const replyText = extractAgentResponseText(message.payload);
  await patchHandoff(captureId, {
    state: replyText ? 'done' : 'processing',
    latestReply: replyText,
    updatedAt: new Date().toISOString()
  });
  return true;
}

function extractAgentResponseText(payload) {
  if (!payload) {
    return '';
  }
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (Array.isArray(payload)) {
    return payload.map(extractAgentResponseText).filter(Boolean).join('\n\n').trim();
  }
  if (typeof payload !== 'object') {
    return String(payload);
  }
  if (payload.ok === true && Object.keys(payload).length === 1) {
    return '';
  }

  const direct = [
    payload.text,
    payload.output,
    payload.reply,
    payload.answer,
    payload.result,
    payload.content
  ].map(extractAgentResponseText).find(Boolean);
  if (direct) {
    return direct;
  }

  if (payload.message) {
    return extractChatText(payload.message) || extractAgentResponseText(payload.message);
  }
  if (payload.response) {
    return extractAgentResponseText(payload.response);
  }
  if (payload.data) {
    return extractAgentResponseText(payload.data);
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return '';
  }
}

async function subscribeToCaptureSession(config) {
  if (config.protocol !== 'node-compatible') {
    return false;
  }

  const sessionKey = normalizeCaptureSessionKey(config.captureSessionKey);
  const results = await Promise.all(
    deriveOpenClawSessionKeys(sessionKey).map((key) => sendNodeEvent('chat.subscribe', { sessionKey: key }))
  );
  return results.some(Boolean);
}

async function handleSubscribedChatEvent(payload) {
  const text = extractChatText(payload.message);
  const state = normalizeChatState(payload.state);
  const errorMessage = typeof payload.errorMessage === 'string' ? payload.errorMessage : '';
  if (!text && !errorMessage && state !== 'processing') {
    return;
  }

  await updateLatestHandoffForSession(payload.sessionKey, {
    runId: typeof payload.runId === 'string' ? payload.runId : '',
    state: errorMessage ? 'error' : state,
    latestReply: text,
    error: errorMessage,
    updatedAt: new Date().toISOString()
  });
}

async function handleSubscribedAgentEvent(payload) {
  const stream = typeof payload.stream === 'string' ? payload.stream : '';
  const phase = typeof payload.data?.phase === 'string' ? payload.data.phase : '';
  if (stream !== 'lifecycle' || (phase !== 'start' && phase !== 'end' && phase !== 'error')) {
    return;
  }

  await updateLatestHandoffForSession(payload.sessionKey, {
    runId: typeof payload.runId === 'string' ? payload.runId : '',
    state: phase === 'error' ? 'error' : phase === 'end' ? 'done' : 'processing',
    error: phase === 'error' ? String(payload.data?.error || 'OpenClaw processing failed') : '',
    updatedAt: new Date().toISOString()
  });
}

function extractChatText(message) {
  if (!message || !Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .map((part) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_HANDOFF_REPLY_CHARS);
}

function normalizeChatState(state) {
  if (state === 'final') {
    return 'done';
  }
  if (state === 'error') {
    return 'error';
  }
  return 'processing';
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

async function pageServiceInfo() {
  const tab = await getActiveWebTab();
  if (!tab) {
    return { ok: false, error: 'No active web tab' };
  }

  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  const pageType = detectPageServiceType(tab.url);
  return {
    ok: true,
    payload: {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId,
      contentType: pageType.contentType,
      contentLabel: pageType.label,
      platform: pageType.platform,
      knowledgeSupported: pageType.knowledgeSupported,
      knowledgeAbility: buildPageAbility(config, 'knowledge', pageType)
    }
  };
}

async function runPageService(args = {}) {
  return captureCurrentContext({
    ...args,
    intent: normalizePageService(args.service || args.intent)
  });
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
  const result = await patternMemory.captureHourlySnapshot('scheduled');
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

async function scanPatternsNow() {
  const result = await patternMemory.captureHourlySnapshot('manual-scan');
  if (!result.ok) {
    return result;
  }

  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (config.patternUploadEnabled) {
    await emitOpenClawEvent('browser.pattern.snapshot', result.summary);
    if (result.candidates.length) {
      await emitOpenClawEvent('browser.pattern.detected', {
        detectedAt: new Date().toISOString(),
        candidates: result.candidates.map(summarizePatternForEvent)
      });
    }
  }

  await maybeSuggestRelatedPattern('manual-scan');
  return listPatternsWithRelated();
}

function schedulePatternObservation(source, options = {}) {
  if (patternObserveTimer) {
    clearTimeout(patternObserveTimer);
  }

  patternObserveTimer = setTimeout(() => {
    patternObserveTimer = null;
    Promise.all([
      observePatternsFromActivity(source),
      maybeSuggestRelatedPattern(source)
    ]).catch((error) => setStatus({ lastError: error.message }));
  }, options.immediate ? 0 : PATTERN_OBSERVE_DEBOUNCE_MS);
}

async function listPatternsWithRelated() {
  await maybeSuggestRelatedPattern('popup-open');
  const [patternsResult, relatedResult] = await Promise.all([
    patternMemory.listPatterns(),
    patternMemory.findRelatedForActiveTab()
  ]);
  if (!patternsResult.ok) {
    return patternsResult;
  }

  return {
    ok: true,
    payload: {
      ...patternsResult.payload,
      related: relatedResult?.payload?.match || null
    }
  };
}

async function observePatternsFromActivity(source) {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.patternMemoryEnabled) {
    return;
  }

  const now = Date.now();
  const stored = await chrome.storage.local.get([PATTERN_OBSERVE_STATE_KEY]);
  const lastObservedAt = Number(stored[PATTERN_OBSERVE_STATE_KEY]?.lastObservedAt || 0);
  if (now - lastObservedAt < PATTERN_OBSERVE_MIN_INTERVAL_MS) {
    return;
  }

  await chrome.storage.local.set({
    [PATTERN_OBSERVE_STATE_KEY]: {
      lastObservedAt: now,
      source
    }
  });

  const result = await patternMemory.captureHourlySnapshot(source || 'browser-activity');
  if (!result.ok) {
    return;
  }

  await maybeSuggestRelatedPattern(source || 'browser-activity');

  if (config.patternUploadEnabled) {
    await emitOpenClawEvent('browser.pattern.snapshot', result.summary);
    if (result.candidates.length) {
      await emitOpenClawEvent('browser.pattern.detected', {
        detectedAt: new Date().toISOString(),
        candidates: result.candidates.map(summarizePatternForEvent)
      });
    }
  }
}

async function maybeSuggestRelatedPattern(source) {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.patternMemoryEnabled || !config.suggestionsEnabled) {
    await prunePatternMemorySuggestions();
    return;
  }

  const result = await patternMemory.findRelatedForActiveTab();
  const match = result?.payload?.match;
  if (!match?.urls?.length) {
    await prunePatternMemorySuggestions();
    return;
  }

  const now = Date.now();
  const stored = await chrome.storage.local.get([
    SUGGESTIONS_STORAGE_KEY,
    PATTERN_SUGGESTION_STATE_KEY
  ]);
  const state = normalizePatternSuggestionState(stored[PATTERN_SUGGESTION_STATE_KEY]);
  const patternKey = match.patternId || match.id;
  const dismissedUntil = Number(state.dismissedUntilByPattern[patternKey] || 0);
  if (dismissedUntil > now) {
    await prunePatternMemorySuggestions();
    return;
  }

  const lastShownAt = Number(state.lastShownAtByPattern[patternKey] || 0);
  const existingSuggestions = stored[SUGGESTIONS_STORAGE_KEY] || [];
  const suggestionId = `pattern-memory:${patternKey}`;
  const existingSuggestion = existingSuggestions.find((item) => item.id === suggestionId);
  const alreadyVisible = Boolean(existingSuggestion);
  if (!alreadyVisible && now - lastShownAt < PATTERN_SUGGESTION_COOLDOWN_MS) {
    await prunePatternMemorySuggestions();
    return;
  }

  const previewTitles = suggestionPreviewTitles(match.relatedTabs || []);
  const suggestion = normalizeSuggestion({
    id: suggestionId,
    source: 'pattern-memory',
    kind: 'related-pattern',
    patternId: patternKey,
    title: `恢复「${match.name || '这个工作流'}」`,
    message: previewTitles.length
      ? `可恢复：${previewTitles.join('、')}`
      : `Pattern Memory 识别到当前页面属于这个工作流，可打开 ${match.urls.length} 个相关页面。`,
    urls: match.urls,
    previewTitles,
    reason: match.reason,
    evidence: match.evidence,
    confidence: match.confidence,
    matchedBy: match.matchedBy,
    trigger: source
  });
  if (existingSuggestion) {
    suggestion.createdAt = existingSuggestion.createdAt || suggestion.createdAt;
  }

  if (existingSuggestion && isSameSuggestionContent(existingSuggestion, suggestion)) {
    await prunePatternMemorySuggestions(suggestion.id);
    return;
  }

  const suggestions = [
    suggestion,
    ...existingSuggestions.filter((item) => item.id !== suggestion.id && item.source !== 'pattern-memory')
  ].slice(0, MAX_SUGGESTIONS);

  await chrome.storage.local.set({
    [SUGGESTIONS_STORAGE_KEY]: suggestions,
    [PATTERN_SUGGESTION_STATE_KEY]: {
      ...state,
      lastShownAtByPattern: {
        ...state.lastShownAtByPattern,
        [patternKey]: now
      }
    }
  });
  await updateActionBadge(suggestions.length);
}

function isSameSuggestionContent(left, right) {
  return left.title === right.title &&
    left.message === right.message &&
    left.reason === right.reason &&
    left.patternId === right.patternId &&
    left.matchedBy === right.matchedBy &&
    sameStringArray(left.urls, right.urls) &&
    sameStringArray(left.previewTitles, right.previewTitles);
}

function sameStringArray(left, right) {
  const leftItems = Array.isArray(left) ? left : [];
  const rightItems = Array.isArray(right) ? right : [];
  if (leftItems.length !== rightItems.length) {
    return false;
  }
  return leftItems.every((item, index) => item === rightItems[index]);
}

async function prunePatternMemorySuggestions(keepId = '') {
  const stored = await chrome.storage.local.get([SUGGESTIONS_STORAGE_KEY]);
  const suggestions = stored[SUGGESTIONS_STORAGE_KEY] || [];
  const nextSuggestions = suggestions.filter((item) => item.source !== 'pattern-memory' || item.id === keepId);
  if (nextSuggestions.length !== suggestions.length) {
    await chrome.storage.local.set({ [SUGGESTIONS_STORAGE_KEY]: nextSuggestions });
  }
  await updateActionBadge(nextSuggestions.length);
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

async function captureCurrentContext(args = {}) {
  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  if (!config.contextCaptureEnabled) {
    return { ok: false, error: 'Context Capture is disabled' };
  }

  const summary = await currentPageSummary();
  if (!summary.ok) {
    return summary;
  }

  const intent = normalizeCaptureIntent(args.intent);
  const pageType = detectPageServiceType(summary.payload.url);
  const service = normalizePageService(args.service || intent);
  const payload = {
    captureId: crypto.randomUUID(),
    url: summary.payload.url,
    title: summary.payload.title,
    selectedText: summary.payload.selection || '',
    textPreview: summary.payload.textPreview || '',
    intent,
    service,
    contentType: pageType.contentType,
    contentLabel: pageType.label,
    platform: pageType.platform,
    ability: buildPageAbility(config, service, pageType),
    route: {
      sessionKey: normalizeCaptureSessionKey(config.captureSessionKey),
      canonicalSessionKey: canonicalizeOpenClawSessionKey(config.captureSessionKey),
      display: 'OpenClaw 本地通道'
    },
    capturedAt: new Date().toISOString()
  };

  const handoff = createHandoffRecord(payload);
  await saveHandoff(handoff);

  const contextEventSent = await emitOpenClawEvent('browser.context.capture', payload);
  await subscribeToCaptureSession(config);
  const agentRequestSent = await emitOpenClawAgentRequest(payload);
  const state = agentRequestSent ? 'processing' : 'captured-local';
  const requestedAt = new Date().toISOString();
  await patchHandoff(payload.captureId, {
    state,
    contextEventSent,
    agentRequestSent,
    attemptCount: agentRequestSent ? 1 : 0,
    lastRequestAt: agentRequestSent ? requestedAt : '',
    deadlineAt: agentRequestSent ? handoffDeadlineAt(config, requestedAt) : '',
    updatedAt: new Date().toISOString()
  });

  if (!contextEventSent && !agentRequestSent) {
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
      sent: contextEventSent || agentRequestSent,
      contextEventSent,
      agentRequestSent,
      state
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
  await updateActionBadge(suggestions.length);

  return {
    ok: true,
    payload: suggestion
  };
}

async function listSuggestions() {
  const stored = await chrome.storage.local.get([SUGGESTIONS_STORAGE_KEY]);
  await updateActionBadge((stored[SUGGESTIONS_STORAGE_KEY] || []).length);
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
      patternId: suggestion.patternId || suggestion.id,
      urls: suggestion.urls
    });
  }
  if (suggestion.source === 'pattern-memory' && suggestion.patternId) {
    await patternMemory.recordFeedback(suggestion.patternId, action);
  }

  const statePatch = {};
  if (action === 'dismissed' && suggestion.source === 'pattern-memory' && suggestion.patternId) {
    const stateStored = await chrome.storage.local.get([PATTERN_SUGGESTION_STATE_KEY]);
    const state = normalizePatternSuggestionState(stateStored[PATTERN_SUGGESTION_STATE_KEY]);
    statePatch[PATTERN_SUGGESTION_STATE_KEY] = {
      ...state,
      dismissedUntilByPattern: {
        ...state.dismissedUntilByPattern,
        [suggestion.patternId]: Date.now() + PATTERN_SUGGESTION_DISMISS_MS
      }
    };
  }

  const nextSuggestions = suggestions.filter((item) => item.id !== suggestionId);
  await chrome.storage.local.set({
    [SUGGESTIONS_STORAGE_KEY]: nextSuggestions,
    ...statePatch
  });
  await updateActionBadge(nextSuggestions.length);

  const eventName = action === 'accepted' ? 'browser.suggestion.accepted' : 'browser.suggestion.dismissed';
  const sent = await emitOpenClawEvent(eventName, {
    suggestionId: suggestion.id,
    source: suggestion.source,
    kind: suggestion.kind,
    patternId: suggestion.patternId,
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

async function emitOpenClawAgentRequest(capture) {
  return sendNodeEvent('agent.request', {
    sessionKey: capture.route.canonicalSessionKey || capture.route.sessionKey,
    message: buildAgentRequestMessage(capture),
    thinking: 'low',
    deliver: false,
    receipt: false,
    source: 'browser-extension',
    captureId: capture.captureId,
    url: capture.url,
    title: capture.title,
    intent: capture.intent,
    service: capture.service,
    contentType: capture.contentType,
    platform: capture.platform,
    ability: capture.ability,
    capturedAt: capture.capturedAt
  });
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

async function listHandoffs() {
  await reconcileHandoffTimeouts();
  const stored = await chrome.storage.local.get([HANDOFFS_STORAGE_KEY]);
  return {
    ok: true,
    payload: {
      handoffs: stored[HANDOFFS_STORAGE_KEY] || []
    }
  };
}

function createHandoffRecord(capture) {
  return {
    id: capture.captureId,
    title: capture.title || 'Untitled page',
    url: capture.url,
    intent: capture.intent,
    service: capture.service,
    contentType: capture.contentType,
    contentLabel: capture.contentLabel,
    platform: capture.platform,
    ability: capture.ability,
    sessionKey: capture.route.sessionKey,
    canonicalSessionKey: capture.route.canonicalSessionKey,
    state: 'queued',
    contextEventSent: false,
    agentRequestSent: false,
    attemptCount: 0,
    lastRequestAt: '',
    lastRetriedAt: '',
    deadlineAt: '',
    timedOutAt: '',
    latestReply: '',
    error: '',
    notifiedAt: '',
    capturedAt: capture.capturedAt,
    updatedAt: capture.capturedAt
  };
}

async function saveHandoff(record) {
  const stored = await chrome.storage.local.get([HANDOFFS_STORAGE_KEY]);
  const next = [
    record,
    ...(stored[HANDOFFS_STORAGE_KEY] || []).filter((item) => item.id !== record.id)
  ].slice(0, MAX_HANDOFFS);
  await chrome.storage.local.set({ [HANDOFFS_STORAGE_KEY]: next });
  await scheduleHandoffTimeoutAlarm(next);
}

async function patchHandoff(id, patch) {
  const stored = await chrome.storage.local.get([HANDOFFS_STORAGE_KEY]);
  const items = stored[HANDOFFS_STORAGE_KEY] || [];
  let completed = null;
  await chrome.storage.local.set({
    [HANDOFFS_STORAGE_KEY]: items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      const next = normalizeHandoffAfterPatch({ ...item, ...patch });
      if (shouldNotifyHandoffComplete(next, item)) {
        next.notifiedAt = new Date().toISOString();
        completed = next;
      }
      return next;
    })
  });
  if (completed) {
    await notifyHandoffComplete(completed);
  }
  await scheduleHandoffTimeoutAlarm();
}

async function updateLatestHandoffForSession(sessionKey, patch) {
  const normalizedSessionKey = normalizeCaptureSessionKey(sessionKey);
  const stored = await chrome.storage.local.get([HANDOFFS_STORAGE_KEY]);
  const items = stored[HANDOFFS_STORAGE_KEY] || [];
  const index = items.findIndex((item) => item.sessionKey === normalizedSessionKey || item.canonicalSessionKey === normalizedSessionKey);
  if (index < 0) {
    return;
  }

  const next = [...items];
  const previous = next[index];
  next[index] = {
    ...previous,
    ...patch
  };
  next[index] = normalizeHandoffAfterPatch(next[index]);
  if (shouldNotifyHandoffComplete(next[index], previous)) {
    next[index].notifiedAt = new Date().toISOString();
  }
  await chrome.storage.local.set({ [HANDOFFS_STORAGE_KEY]: next });
  if (next[index].notifiedAt && next[index].notifiedAt !== previous.notifiedAt) {
    await notifyHandoffComplete(next[index]);
  }
  await scheduleHandoffTimeoutAlarm(next);
}

async function retryHandoff(args = {}) {
  const handoffId = args.id || args.handoffId || '';
  if (!handoffId) {
    return { ok: false, error: 'Missing handoff id' };
  }

  const stored = await chrome.storage.local.get([HANDOFFS_STORAGE_KEY]);
  const handoff = (stored[HANDOFFS_STORAGE_KEY] || []).find((item) => item.id === handoffId);
  if (!handoff) {
    return { ok: false, error: 'Handoff not found' };
  }
  if (handoff.state === 'processing' || handoff.state === 'queued') {
    return { ok: false, error: 'Handoff is already processing' };
  }
  if (handoff.state === 'done') {
    return { ok: false, error: 'Handoff is already complete' };
  }

  const config = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  const capture = captureFromHandoff(handoff, config);
  await subscribeToCaptureSession(config);
  const agentRequestSent = await emitOpenClawAgentRequest(capture);
  const requestedAt = new Date().toISOString();
  const patch = agentRequestSent ? {
    state: 'processing',
    error: '',
    latestReply: '',
    agentRequestSent: true,
    attemptCount: Number(handoff.attemptCount || 0) + 1,
    lastRequestAt: requestedAt,
    lastRetriedAt: requestedAt,
    deadlineAt: handoffDeadlineAt(config, requestedAt),
    timedOutAt: '',
    updatedAt: requestedAt
  } : {
    state: 'error',
    error: 'OpenClaw is not connected',
    lastRetriedAt: requestedAt,
    updatedAt: requestedAt
  };

  await patchHandoff(handoffId, patch);
  return {
    ok: agentRequestSent,
    error: agentRequestSent ? undefined : 'OpenClaw is not connected',
    payload: {
      handoffId,
      state: agentRequestSent ? 'processing' : 'error',
      retriedAt: requestedAt
    }
  };
}

function captureFromHandoff(handoff, config) {
  const sessionKey = normalizeCaptureSessionKey(handoff.sessionKey || config.captureSessionKey);
  return {
    captureId: handoff.id,
    url: handoff.url,
    title: handoff.title,
    selectedText: '',
    textPreview: '',
    intent: normalizeCaptureIntent(handoff.intent || handoff.service),
    service: normalizePageService(handoff.service || handoff.intent),
    contentType: handoff.contentType || 'webpage',
    contentLabel: handoff.contentLabel || '网页',
    platform: handoff.platform || 'web',
    ability: handoff.ability || buildPageAbility(config, handoff.service || handoff.intent, {
      contentType: handoff.contentType || 'webpage',
      label: handoff.contentLabel || '网页',
      platform: handoff.platform || 'web',
      knowledgeSupported: true
    }),
    route: {
      sessionKey,
      canonicalSessionKey: handoff.canonicalSessionKey || canonicalizeOpenClawSessionKey(sessionKey),
      display: 'OpenClaw 本地通道'
    },
    capturedAt: handoff.capturedAt || new Date().toISOString(),
    retryOf: handoff.id
  };
}

function normalizeHandoffAfterPatch(handoff) {
  if (handoff.state === 'done' || handoff.state === 'error' || handoff.state === 'captured-local') {
    return {
      ...handoff,
      deadlineAt: handoff.state === 'captured-local' ? handoff.deadlineAt || '' : ''
    };
  }
  return handoff;
}

async function reconcileHandoffTimeouts() {
  const [stored, config] = await Promise.all([
    chrome.storage.local.get([HANDOFFS_STORAGE_KEY]),
    chrome.storage.local.get(Object.keys(DEFAULT_CONFIG))
  ]);
  const now = Date.now();
  let changed = false;
  const timeoutMinutes = normalizeHandoffTimeoutMinutes(config.handoffTimeoutMinutes);
  const handoffs = (stored[HANDOFFS_STORAGE_KEY] || []).map((handoff) => {
    if (!isPendingHandoff(handoff)) {
      return handoff;
    }

    const deadlineMs = Date.parse(handoff.deadlineAt || '');
    if (!Number.isFinite(deadlineMs) || deadlineMs > now) {
      return handoff;
    }

    changed = true;
    const timedOutAt = new Date(now).toISOString();
    return {
      ...handoff,
      state: 'error',
      error: `OpenClaw processing timed out after ${timeoutMinutes} minutes. You can retry from the record.`,
      deadlineAt: '',
      timedOutAt,
      updatedAt: timedOutAt
    };
  });

  if (changed) {
    await chrome.storage.local.set({ [HANDOFFS_STORAGE_KEY]: handoffs });
  }
  await scheduleHandoffTimeoutAlarm(handoffs);
  return changed;
}

async function scheduleHandoffTimeoutAlarm(handoffs) {
  const items = handoffs || (await chrome.storage.local.get([HANDOFFS_STORAGE_KEY]))[HANDOFFS_STORAGE_KEY] || [];
  if (!items.some(isPendingHandoff)) {
    await chrome.alarms.clear(HANDOFF_TIMEOUT_ALARM_NAME);
    return;
  }
  await chrome.alarms.create(HANDOFF_TIMEOUT_ALARM_NAME, {
    delayInMinutes: HANDOFF_TIMEOUT_CHECK_MINUTES,
    periodInMinutes: HANDOFF_TIMEOUT_CHECK_MINUTES
  });
}

function isPendingHandoff(handoff) {
  return (handoff.state === 'queued' || handoff.state === 'processing') && Boolean(handoff.deadlineAt);
}

function handoffDeadlineAt(config, startAt = new Date().toISOString()) {
  const timeoutMinutes = normalizeHandoffTimeoutMinutes(config.handoffTimeoutMinutes);
  const startMs = Date.parse(startAt);
  const baseMs = Number.isFinite(startMs) ? startMs : Date.now();
  return new Date(baseMs + timeoutMinutes * 60 * 1000).toISOString();
}

function normalizeHandoffTimeoutMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_CONFIG.handoffTimeoutMinutes;
  }
  return Math.max(MIN_HANDOFF_TIMEOUT_MINUTES, Math.min(MAX_HANDOFF_TIMEOUT_MINUTES, Math.trunc(number)));
}

function shouldNotifyHandoffComplete(next, previous) {
  if (next.state !== 'done' || previous.notifiedAt) {
    return false;
  }
  return Boolean(next.latestReply || next.error);
}

async function notifyHandoffComplete(handoff) {
  const service = handoff.service || handoff.intent;
  const path = extractMarkdownPath(handoff.latestReply);
  const title = service === 'knowledge' ? '知识笔记已生成' : 'OpenClaw 处理完成';
  const body = [
    handoff.title || '当前页面',
    path ? `路径：${path}` : compactNotificationText(handoff.latestReply || '处理完成')
  ].filter(Boolean).join('\n');

  await showNotification({
    title,
    body: compactNotificationText(body),
    data: {
      captureId: handoff.id,
      service,
      notePath: path,
      url: handoff.url
    }
  });
}

function extractMarkdownPath(text) {
  const raw = typeof text === 'string' ? text : '';
  const match = raw.match(/(?:~|\/Users|\/tmp|\/var|\/private|\/)[^\n\r"'`<>]*?\.md\b/);
  return match ? match[0].trim() : '';
}

function compactNotificationText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function buildAgentRequestMessage(capture) {
  const instruction = buildCaptureInstruction(capture);
  const selected = capture.selectedText ? `\n\n选中文本：\n${capture.selectedText}` : '';

  return [
    '来自 OpenClaw Browser Host 的主动网页上下文。',
    '',
    instruction,
    '',
    `Capture ID: ${capture.captureId}`,
    `Service: ${capture.service || capture.intent}`,
    `Content Type: ${capture.contentLabel || capture.contentType || '网页'}`,
    `Platform: ${capture.platform || 'web'}`,
    `URL: ${capture.url}`,
    `Title: ${capture.title || 'Untitled'}`,
    `Captured At: ${capture.capturedAt}`,
    selected,
    '',
    '页面正文预览：',
    capture.textPreview || '(无正文预览)',
    '',
    '请把结果返回到当前 OpenClaw 会话；如果有适合继续浏览的链接或工作流建议，请生成可执行建议。'
  ].filter((line) => line !== '').join('\n');
}

function buildCaptureInstruction(capture) {
  if (capture.intent === 'knowledge') {
    const ability = capture.ability || {};
    const pluginPath = ability.localPath || '(未配置，请先在扩展设置中填写本机插件目录)';
    const envFile = ability.envFile || '(默认读取插件目录下 .env，或由 OPENCLAW_MEDIA_NOTES_ENV_FILE 指定)';
    const outputDir = ability.outputDir || '~/.openclaw/workspace/browser-notes';
    const flags = ability.defaultFlags || '(按内容类型自行判断)';
    return [
      '请把这个页面转成 OpenClaw 本地知识库条目，不要只做摘要。',
      `请优先使用浏览器插件自带能力模块「${ability.name || MEDIA_TO_NOTES_PLUGIN_NAME}」，不要依赖外部 Projects 目录里的旧 skill。`,
      `能力模块 ID: ${ability.id || MEDIA_TO_NOTES_PLUGIN_ID}`,
      `能力模块本机目录: ${pluginPath}`,
      `能力模块入口: ${ability.entry || './run.sh'}`,
      `环境配置: ${envFile}`,
      `输出目录: ${outputDir}`,
      `默认参数: ${flags}`,
      '该能力应覆盖文章、GitHub 仓库、YouTube、Bilibili、Douyin、TikTok、抖音和通用网页/视频。',
      '执行要求：进入能力模块目录后运行入口脚本，让入口脚本自行加载 .env、依赖和输出目录；Markdown 必须写入 OpenClaw workspace 下的输出目录。',
      '如果能力模块目录或必要 token 缺失，请直接返回可操作的配置缺口，不要悄悄改用外部旧目录。',
      '完成后请返回：处理状态、内容类型、笔记路径、TLDR、关键点、失败原因和下一步建议。'
    ].join('\n');
  }

  if (capture.intent === 'relate') {
    return [
      '这是“找库内关联”请求，不要把它当成网页摘要，也不要重复生成知识笔记。',
      '浏览器插件的主产物应是本地 Markdown 知识文稿；本请求要把该文稿接入 OpenClaw 的本地知识体系。',
      '请优先利用已安装 skill：obsidian-qa 检索本地知识库，knowledge-graphify 发现 wikilink 关联。',
      '如果能根据 URL、标题或正文预览定位到刚生成的笔记，请围绕该笔记工作；如果没有定位到，先用当前页面作为查询种子检索相关笔记。',
      '默认不要自动改写已有笔记；knowledge-graphify 请先以 auto_write=false 或等价方式返回建议。',
      '请返回：命中的本地笔记路径、3-5 个相关笔记/理由、建议 wikilink、建议下一步打开的 Obsidian 本地链接。'
    ].join('\n');
  }

  if (capture.intent === 'research') {
    return [
      '这是“发起深研”请求，不要只做摘要，也不要重复生成知识笔记。',
      '请把当前页面作为研究种子，优先利用已安装 skill：dsearch；必要时结合 obsidian-qa 做本地知识预检索。',
      '如果 dsearch skill 要求研究口径确认，请返回可直接确认的研究 brief，而不是跳过确认流程。',
      '研究 brief 必须包含：研究主题、不研究范围、核心问题、时间/地域/对象边界、预期交付物。',
      '如果上下文已足够且 skill 允许启动，请按 dsearch 的交付契约创建独立研究目录，并把进度和最终报告路径回传。',
      '请返回：研究口径、是否已启动、输出目录/报告路径、需要用户确认的问题。'
    ].join('\n');
  }

  if (capture.intent === 'issue') {
    return [
      '这是“Issue 草案”请求，不要只做页面摘要，也不要重复生成知识笔记。',
      '目标是把当前页面或已生成知识文稿转成可进入 Linear 看板的工作项草案。',
      '请优先利用已安装 skill：linear-issues；创建草案前先检索相关 Obsidian 笔记和已有 Linear issue，避免重复提单。',
      '默认只返回草案，不直接创建或更新 Linear；除非用户在 OpenClaw 会话中明确确认。',
      '草案必须包含：标题、背景、目标、验收标准、关联 issue/文档、建议优先级和风险。',
      '如果当前页面不适合转成工作项，请明确说明不适合，并给出更合适的处理方式。'
    ].join('\n');
  }

  if (capture.intent === 'workflow' || capture.intent === 'next') {
    return [
      '这是“转成行动”请求，不要把它当成普通摘要，也不要生成知识库笔记。',
      '目标是判断这个页面是否能变成用户当前工作的下一步。',
      '请优先返回：建议动作、可能关联的项目/issue/文档、为什么相关、需要打开或恢复的链接。',
      '如果页面只能提供背景信息，请给出最小下一步；如果没有可靠关联，请明确说“未发现明确工作关联”，不要编造项目。'
    ].join('\n');
  }

  if (capture.intent === 'later' || capture.intent === 'save') {
    return [
      '这是“稍后处理”请求，请不要生成知识笔记，也不要做完整研究总结。',
      '目标是把当前页面保存成以后能快速恢复上下文的短线索。',
      '请返回：一句话线索标题、为什么值得稍后继续、恢复时第一步、关键词。',
      '内容应短，方便从历史记录里快速找回，并避免扩写成项目计划。'
    ].join('\n');
  }

  return [
    '这是“快速读懂”请求，请只帮助用户扫清当前页面内容，不要生成知识库笔记，也不要做项目关联分析。',
    '请返回：一句话结论、最多 3 个关键点、一个可选继续阅读方向。',
    '控制在 150 字以内，适合直接显示在浏览器插件通知里。'
  ].join('\n');
}

function normalizeSuggestion(args) {
  const urls = Array.isArray(args.urls)
    ? args.urls.filter(isWebUrl).slice(0, 10)
    : [];
  const source = ['openclaw', 'pattern-memory'].includes(args.source) ? args.source : 'openclaw';
  const previewTitles = Array.isArray(args.previewTitles)
    ? args.previewTitles
      .map((title) => String(title || '').trim())
      .filter(Boolean)
      .slice(0, 4)
    : [];

  return {
    id: args.id || args.suggestionId || crypto.randomUUID(),
    title: (args.title || 'OpenClaw suggestion').slice(0, 120),
    message: (args.message || args.body || '').slice(0, 500),
    urls,
    previewTitles,
    reason: (args.reason || '').slice(0, 180),
    evidence: normalizeSuggestionEvidence(args.evidence),
    patternId: args.patternId || '',
    source,
    kind: (args.kind || (source === 'pattern-memory' ? 'related-pattern' : 'openclaw')).slice(0, 80),
    confidence: Number.isFinite(Number(args.confidence)) ? Number(args.confidence) : undefined,
    matchedBy: args.matchedBy || '',
    trigger: args.trigger || '',
    createdAt: new Date().toISOString(),
  };
}

function normalizeSuggestionEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return {};
  }
  return {
    tokenOverlap: Number(evidence.tokenOverlap || 0),
    cooccurrenceCount: Number(evidence.cooccurrenceCount || 0),
    useCount: Number(evidence.useCount || 0),
    acceptedCount: Number(evidence.acceptedCount || 0),
    dismissCount: Number(evidence.dismissCount || 0)
  };
}

function suggestionPreviewTitles(tabs) {
  const seen = new Set();
  const titles = [];
  for (const tab of tabs) {
    const title = cleanSuggestionTitle(tab?.title) || originLabel(tab?.url);
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);
    titles.push(title);
    if (titles.length >= 3) {
      break;
    }
  }
  return titles;
}

function cleanSuggestionTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+闲置标签页\s+-\s+已释放.*$/u, '')
    .replace(/\s+-\s+Google\s+搜索$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function originLabel(url) {
  if (!isWebUrl(url)) {
    return '';
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeCaptureIntent(intent) {
  return ['knowledge', 'relate', 'research', 'issue', 'summarize', 'workflow', 'later', 'save', 'next'].includes(intent) ? intent : 'relate';
}

function normalizePageService(service) {
  if (service === 'save') {
    return 'later';
  }
  if (service === 'next') {
    return 'workflow';
  }
  return ['knowledge', 'relate', 'research', 'issue', 'summarize', 'workflow', 'later'].includes(service) ? service : 'relate';
}

function buildPageAbility(config, service, pageType) {
  if (service !== 'knowledge') {
    const serviceAbilities = {
      relate: {
        id: 'openclaw-knowledge-relations',
        name: 'Obsidian QA + Knowledge Graphify',
        skills: ['obsidian-qa', 'knowledge-graphify']
      },
      research: {
        id: 'openclaw-dsearch',
        name: 'DSearch',
        skills: ['dsearch', 'obsidian-qa']
      },
      issue: {
        id: 'openclaw-linear-issues',
        name: 'Linear Issues',
        skills: ['linear-issues', 'obsidian-qa']
      }
    };
    const ability = serviceAbilities[service] || {
      id: 'openclaw-page-context',
      name: 'OpenClaw Page Context',
      skills: []
    };
    return {
      ...ability,
      owner: 'openclaw',
      contentType: pageType.contentType,
      platform: pageType.platform
    };
  }

  return {
    id: MEDIA_TO_NOTES_PLUGIN_ID,
    name: MEDIA_TO_NOTES_PLUGIN_NAME,
    owner: 'browser-extension',
    bundled: true,
    enabled: Boolean(config.mediaToNotesEnabled),
    localPath: cleanConfigString(config.mediaToNotesPluginPath),
    entry: './run.sh',
    envFile: cleanConfigString(config.mediaToNotesEnvFile),
    outputDir: cleanConfigString(config.mediaToNotesOutputDir) || DEFAULT_CONFIG.mediaToNotesOutputDir,
    defaultFlags: cleanConfigString(config.mediaToNotesDefaultFlags),
    contentType: pageType.contentType,
    platform: pageType.platform,
    supportsCurrentPage: Boolean(pageType.knowledgeSupported),
    requiredEnv: ['MEDIA_API_KEY'],
    optionalEnv: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DEEPGRAM_API_KEY', 'GITHUB_TOKEN']
  };
}

function cleanConfigString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function detectPageServiceType(url) {
  if (!isWebUrl(url)) {
    return {
      contentType: 'webpage',
      label: '网页',
      platform: 'web',
      knowledgeSupported: false
    };
  }

  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const pathname = parsed.pathname;

  if (hostname === 'github.com' && pathname.split('/').filter(Boolean).length >= 2) {
    return {
      contentType: 'github-repository',
      label: 'GitHub 仓库',
      platform: 'github',
      knowledgeSupported: true
    };
  }

  if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) {
    return {
      contentType: 'video',
      label: 'YouTube 视频',
      platform: 'youtube',
      knowledgeSupported: true
    };
  }

  if (hostname.endsWith('bilibili.com')) {
    return {
      contentType: 'video',
      label: 'Bilibili 视频',
      platform: 'bilibili',
      knowledgeSupported: true
    };
  }

  if (hostname.endsWith('douyin.com')) {
    return {
      contentType: 'video',
      label: '抖音视频',
      platform: 'douyin',
      knowledgeSupported: true
    };
  }

  if (hostname.endsWith('tiktok.com')) {
    return {
      contentType: 'video',
      label: 'TikTok 视频',
      platform: 'tiktok',
      knowledgeSupported: true
    };
  }

  const articleHosts = ['medium.com', 'substack.com', 'zhihu.com', 'juejin.cn', 'mp.weixin.qq.com'];
  const isKnownArticle = articleHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  return {
    contentType: isKnownArticle ? 'article' : 'webpage',
    label: isKnownArticle ? '文章' : '网页',
    platform: isKnownArticle ? hostname : 'web',
    knowledgeSupported: true
  };
}

function normalizePatternSuggestionState(state) {
  return {
    lastShownAtByPattern: state?.lastShownAtByPattern || {},
    dismissedUntilByPattern: state?.dismissedUntilByPattern || {}
  };
}

async function updateActionBadge(count) {
  const suggestionCount = Number.isFinite(Number(count))
    ? Number(count)
    : (await chrome.storage.local.get([SUGGESTIONS_STORAGE_KEY]))[SUGGESTIONS_STORAGE_KEY]?.length || 0;
  await chrome.action.setBadgeBackgroundColor({ color: '#0a7f42' });
  await chrome.action.setBadgeText({
    text: suggestionCount > 0 ? String(Math.min(suggestionCount, 9)) : ''
  });
}

function normalizeCaptureSessionKey(sessionKey) {
  return typeof sessionKey === 'string' && sessionKey.trim()
    ? sessionKey.trim()
    : DEFAULT_CAPTURE_SESSION_KEY;
}

function canonicalizeOpenClawSessionKey(sessionKey) {
  const normalized = normalizeCaptureSessionKey(sessionKey);
  return normalized.startsWith('agent:') ? normalized : `agent:main:${normalized}`;
}

function deriveOpenClawSessionKeys(sessionKey) {
  const normalized = normalizeCaptureSessionKey(sessionKey);
  return [...new Set([normalized, canonicalizeOpenClawSessionKey(normalized)])];
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
