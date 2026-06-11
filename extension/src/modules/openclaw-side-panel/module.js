const MODULE_ID = 'openclaw-side-panel';
const MODULE_NAME = 'OpenClaw Side Panel';
const SIDE_PANEL_PATH = 'src/sidepanel/sidepanel.html';
export const SIDE_PANEL_DEFAULT_CONFIG = {
  sidePanelEnabled: true,
  sidePanelAdapter: 'session-bridge',
  sessionBridgeBaseUrl: '',
  sessionBridgeToken: '',
  sessionBridgeTimeoutMs: 20000,
  sidePanelWorkspaceId: 'default',
  sidePanelRouteKey: 'browser:default',
  sidePanelRouteLabel: 'Browser'
};
export const SIDE_PANEL_CONFIG_KEYS = Object.keys(SIDE_PANEL_DEFAULT_CONFIG);

export const openClawSidePanelModule = {
  id: MODULE_ID,
  name: MODULE_NAME,
  version: '0.1.0',
  type: 'extension-feature-module',
  ui: {
    sidePanel: SIDE_PANEL_PATH
  },
  capabilities: [
    'openclaw.sessions.list',
    'openclaw.sessions.new',
    'openclaw.sessions.switch',
    'openclaw.sessions.signal'
  ],
  messages: {
    'sidePanel.status': handleStatus,
    'sidePanel.bridge.status': handleBridgeStatus,
    'sidePanel.scope.current': handleScopeCurrent,
    'sidePanel.settings.get': handleSettingsGet
  }
};

async function handleStatus({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);
  const bridge = buildBridgeStatus(config, module.enabled);
  const scope = buildScope(config, identity, connection);
  const state = derivePanelState(module, connection, bridge);

  return ok({
    state,
    module,
    connection,
    configuration: {
      adapter: module.adapter,
      bridgeConfigured: bridge.configured,
      authConfigured: bridge.authConfigured
    },
    bridge,
    scope,
    phase: {
      current: 'Phase 2: Side Panel shell and registry ready',
      next: 'Phase 3: Session Bridge Adapter MVP'
    },
    updatedAt: new Date().toISOString()
  });
}

async function handleBridgeStatus({ context }) {
  const { config } = await readPanelContext(context);
  const module = buildModuleStatus(config);

  return ok({
    bridge: buildBridgeStatus(config, module.enabled),
    module
  });
}

async function handleScopeCurrent({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);

  return ok({
    scope: buildScope(config, identity, connection),
    connection
  });
}

async function handleSettingsGet({ context }) {
  const { config } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const bridge = buildBridgeStatus(config, module.enabled);

  return ok({
    module,
    settings: {
      sidePanelEnabled: module.enabled,
      sidePanelAdapter: module.adapter,
      sessionBridgeBaseUrlConfigured: bridge.baseUrlConfigured,
      sessionBridgeAuthConfigured: bridge.authConfigured,
      sessionBridgeTimeoutMs: bridge.timeoutMs,
      sidePanelWorkspaceId: config.sidePanelWorkspaceId,
      sidePanelRouteKey: config.sidePanelRouteKey,
      sidePanelRouteLabel: config.sidePanelRouteLabel
    }
  });
}

async function readPanelContext(context) {
  const [storedConfig, identity, trustedPairing] = await Promise.all([
    context.getConfig(SIDE_PANEL_CONFIG_KEYS),
    context.ensureHostIdentity(),
    context.getTrustedPairingState()
  ]);

  return {
    config: normalizeConfig(storedConfig),
    coreStatus: context.getConnectionStatus(),
    identity,
    trustedPairing
  };
}

function normalizeConfig(storedConfig) {
  const config = {
    ...SIDE_PANEL_DEFAULT_CONFIG,
    ...storedConfig
  };

  config.sidePanelEnabled = config.sidePanelEnabled !== false;
  config.sidePanelAdapter = cleanString(config.sidePanelAdapter) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelAdapter;
  config.sessionBridgeBaseUrl = cleanString(config.sessionBridgeBaseUrl);
  config.sessionBridgeToken = cleanString(config.sessionBridgeToken);
  config.sessionBridgeTimeoutMs = normalizeTimeout(config.sessionBridgeTimeoutMs);
  config.sidePanelWorkspaceId = cleanString(config.sidePanelWorkspaceId) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelWorkspaceId;
  config.sidePanelRouteKey = cleanString(config.sidePanelRouteKey) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelRouteKey;
  config.sidePanelRouteLabel = cleanString(config.sidePanelRouteLabel) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelRouteLabel;
  return config;
}

function buildModuleStatus(config) {
  return {
    id: MODULE_ID,
    name: MODULE_NAME,
    type: 'extension-feature-module',
    enabled: config.sidePanelEnabled,
    adapter: config.sidePanelAdapter,
    sidePanelPath: SIDE_PANEL_PATH,
    capabilities: openClawSidePanelModule.capabilities
  };
}

function buildConnectionStatus(coreStatus, identity, trustedPairing) {
  const pairing = cleanString(trustedPairing.pairing) || 'unpaired';
  const paired = Boolean(trustedPairing.paired);
  const hostId = cleanString(coreStatus.hostId) || cleanString(identity.hostId);

  return {
    connected: Boolean(coreStatus.connected),
    connecting: Boolean(coreStatus.connecting),
    online: Boolean(coreStatus.online),
    paired,
    hasDeviceToken: Boolean(trustedPairing.hasDeviceToken),
    pairing,
    hostId,
    nodeId: cleanString(coreStatus.nodeId),
    lastError: redactDiagnostic(coreStatus.lastError)
  };
}

function buildBridgeStatus(config, moduleEnabled) {
  const baseUrlConfigured = Boolean(config.sessionBridgeBaseUrl);
  const authConfigured = Boolean(config.sessionBridgeToken);
  const configured = baseUrlConfigured && authConfigured;
  let state = 'missing_config';
  if (!moduleEnabled) {
    state = 'disabled';
  } else if (!baseUrlConfigured) {
    state = 'missing_base_url';
  } else if (!authConfigured) {
    state = 'missing_auth';
  } else if (configured) {
    state = 'configured';
  }

  return {
    adapter: config.sidePanelAdapter,
    state,
    configured,
    baseUrlConfigured,
    authConfigured,
    timeoutMs: config.sessionBridgeTimeoutMs
  };
}

function buildScope(config, identity, connection) {
  return {
    scope_version: 1,
    agent: 'openclaw',
    workspace_id: config.sidePanelWorkspaceId,
    route_type: 'browser',
    route_key: config.sidePanelRouteKey,
    route_label: config.sidePanelRouteLabel,
    device_id: cleanString(identity.hostId) || connection.hostId,
    operator_id: connection.paired ? 'paired-browser-host' : 'unpaired',
    source: 'browser-extension-side-panel'
  };
}

function derivePanelState(module, connection, bridge) {
  if (!module.enabled) {
    return 'disabled';
  }
  if (!connection.paired) {
    return 'unpaired';
  }
  if (!connection.online) {
    return 'offline';
  }
  if (!bridge.configured) {
    return 'missing_config';
  }
  return 'ready';
}

function ok(payload) {
  return {
    ok: true,
    payload,
    error: null,
    diagnostic: {
      moduleId: MODULE_ID
    }
  };
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) {
    return SIDE_PANEL_DEFAULT_CONFIG.sessionBridgeTimeoutMs;
  }
  return Math.max(1000, Math.min(timeout, 120000));
}

function cleanString(value) {
  return String(value || '').trim();
}

function redactDiagnostic(value) {
  const text = cleanString(value);
  if (!text) {
    return '';
  }
  return text
    .replace(/(token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"',\s]+/gi, '$1[redacted]');
}
