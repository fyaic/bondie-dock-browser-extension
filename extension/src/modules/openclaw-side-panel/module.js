import { OpenClawSessionAdapter } from './session-adapter.js';

const MODULE_ID = 'openclaw-side-panel';
const MODULE_NAME = 'OpenClaw Side Panel';
const SIDE_PANEL_PATH = 'src/sidepanel/sidepanel.html';
export const SIDE_PANEL_DEFAULT_CONFIG = {
  sidePanelEnabled: true,
  sidePanelAdapter: 'session-bridge',
  sessionBridgeBaseUrl: '',
  sessionBridgeToken: '',
  sessionBridgeTimeoutMs: 20000,
  sidePanelBondieFixtureMode: 'off',
  sidePanelIdentityMode: 'legacy-paired',
  sidePanelInstanceProvider: 'legacy-session-bridge',
  sidePanelLocalRelationshipType: 'communication',
  sidePanelControlPlaneBaseUrl: '',
  sidePanelWorkspaceId: 'default',
  sidePanelOrganization: 'default',
  sidePanelRouteType: 'browser',
  sidePanelRouteKey: 'browser:default',
  sidePanelRouteLabel: 'Browser',
  sidePanelOperatorId: ''
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
    'sidePanel.sessions.list': handleListSessions,
    'sidePanel.sessions.new': handleNewSession,
    'sidePanel.sessions.switch': handleSwitchSession,
    'sidePanel.identity.status': handleIdentityStatus,
    'sidePanel.instances.list': handleInstancesList,
    'sidePanel.scope.current': handleScopeCurrent,
    'sidePanel.settings.get': handleSettingsGet
  }
};

async function handleStatus({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);
  const identityState = buildIdentityState(config, identity, connection);
  const instanceProvider = buildInstanceProviderState(config, identityState);
  const bridge = shouldReadBridge(identityState, instanceProvider)
    ? await readBridgeStatus({ config, module, connection, context })
    : buildBridgeStatus(config, module.enabled);
  const scope = buildScope(config, identity, connection);
  const state = derivePanelState(module, connection, bridge, identityState, instanceProvider);

  return ok({
    state,
    viewer: identityState.viewer,
    identity: publicIdentityState(identityState),
    instanceProvider,
    module,
    connection,
    configuration: {
      adapter: module.adapter,
      bridgeConfigured: bridge.configured,
      authConfigured: bridge.authConfigured
    },
    bridge,
    scope,
    instances: buildInstanceSummaries({ config, bridge, scope, identityState, instanceProvider }),
    phase: {
      current: 'Phase 7: Bondie multi-instance permission UI',
      next: 'Phase 7B: Identity adapter and instance-level session contract'
    },
    updatedAt: new Date().toISOString()
  });
}

async function handleNewSession({ message, context }) {
  const actionContext = await readActionContext(context);
  const instanceId = requestedInstanceId(message);
  const instanceGate = deriveActionInstanceGate(actionContext, instanceId);
  if (instanceGate !== 'ready') {
    return ok(buildBlockedActionPayload('new', {
      ...actionContext,
      gate: instanceGate,
      instanceId
    }));
  }
  if (actionContext.gate !== 'ready') {
    return ok(buildBlockedActionPayload('new', {
      ...actionContext,
      instanceId
    }));
  }

  const result = await createSessionAdapter(actionContext.config, context).newConversation(actionContext.scope, {
    messageCardStyle: message?.messageCardStyle || 'friendly',
    sessionId: message?.sessionId
  });

  return ok(buildActionPayload('new', { ...actionContext, instanceId }, result));
}

async function handleSwitchSession({ message, context }) {
  const actionContext = await readActionContext(context);
  const instanceId = requestedInstanceId(message);
  const instanceGate = deriveActionInstanceGate(actionContext, instanceId);
  if (instanceGate !== 'ready') {
    return ok(buildBlockedActionPayload('switch', {
      ...actionContext,
      gate: instanceGate,
      instanceId
    }));
  }
  if (actionContext.gate !== 'ready') {
    return ok(buildBlockedActionPayload('switch', {
      ...actionContext,
      instanceId
    }));
  }

  const result = await createSessionAdapter(actionContext.config, context).switchSession(
    actionContext.scope,
    message?.sessionId,
    {
      messageCardStyle: message?.messageCardStyle || 'friendly'
    }
  );

  return ok(buildActionPayload('switch', { ...actionContext, instanceId }, result));
}

async function handleBridgeStatus({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);

  return ok({
    bridge: await readBridgeStatus({ config, module, connection, context }),
    module
  });
}

async function handleListSessions({ message, context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);
  const identityState = buildIdentityState(config, identity, connection);
  const instanceProvider = buildInstanceProviderState(config, identityState);
  const bridge = shouldReadBridge(identityState, instanceProvider)
    ? await readBridgeStatus({ config, module, connection, context })
    : buildBridgeStatus(config, module.enabled);
  const scope = buildScope(config, identity, connection);
  const gate = derivePanelState(module, connection, bridge, identityState, instanceProvider);
  const instanceId = requestedInstanceId(message);

  if (gate !== 'ready') {
    return ok({
      state: gate,
      viewer: identityState.viewer,
      identity: publicIdentityState(identityState),
      instanceProvider,
      bridge,
      scope,
      instances: buildInstanceSummaries({ config, bridge, scope, identityState, instanceProvider }),
      groups: [],
      sessions: [],
      requestedInstanceId: instanceId,
      currentBinding: null,
      updatedAt: new Date().toISOString()
    });
  }

  if (config.sidePanelBondieFixtureMode === 'fixtures') {
    return ok(filterSessionsPayloadByInstance(
      buildFixtureSessionsPayload({ bridge, scope, viewer: identityState.viewer }),
      instanceId
    ));
  }

  const result = await createSessionAdapter(config, context).listSessions(scope);
  const grouped = buildLegacySessionGroups({ result, bridge, scope });
  return ok(filterSessionsPayloadByInstance({
    state: result.state,
    viewer: identityState.viewer,
    identity: publicIdentityState(identityState),
    instanceProvider,
    bridge: result.bridge ? mergeBridgeStatus(bridge, result.bridge) : bridge,
    scope,
    instances: grouped.instances,
    groups: grouped.groups,
    sessions: grouped.sessions,
    requestedInstanceId: instanceId,
    currentBinding: result.currentBinding || null,
    bridgeId: result.bridgeId || bridge.remote?.bridgeId || '',
    unresolved: Boolean(result.unresolved),
    error: result.ok === false ? redactDiagnostic(result.message || result.error) : '',
    updatedAt: new Date().toISOString()
  }, instanceId));
}

async function handleScopeCurrent({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);

  return ok({
    scope: buildScope(config, identity, connection),
    connection
  });
}

async function handleIdentityStatus({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);
  const identityState = buildIdentityState(config, identity, connection);

  return ok({
    viewer: identityState.viewer,
    identity: publicIdentityState(identityState),
    connection,
    identityRequired: !identityState.authenticated,
    updatedAt: new Date().toISOString()
  });
}

async function handleInstancesList({ context }) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);
  const identityState = buildIdentityState(config, identity, connection);
  const instanceProvider = buildInstanceProviderState(config, identityState);
  const bridge = shouldReadBridge(identityState, instanceProvider)
    ? await readBridgeStatus({ config, module, connection, context })
    : buildBridgeStatus(config, module.enabled);
  const scope = buildScope(config, identity, connection);

  return ok({
    state: identityState.authenticated ? instanceProvider.state : 'identity_required',
    viewer: identityState.viewer,
    identity: publicIdentityState(identityState),
    instanceProvider,
    instances: buildInstanceSummaries({ config, bridge, scope, identityState, instanceProvider }),
    updatedAt: new Date().toISOString()
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
      sidePanelBondieFixtureMode: config.sidePanelBondieFixtureMode,
      sidePanelIdentityMode: config.sidePanelIdentityMode,
      sidePanelInstanceProvider: config.sidePanelInstanceProvider,
      sidePanelLocalRelationshipType: config.sidePanelLocalRelationshipType,
      sidePanelControlPlaneBaseUrlConfigured: Boolean(config.sidePanelControlPlaneBaseUrl),
      sidePanelWorkspaceId: config.sidePanelWorkspaceId,
      sidePanelOrganization: config.sidePanelOrganization,
      sidePanelRouteType: config.sidePanelRouteType,
      sidePanelRouteKey: config.sidePanelRouteKey,
      sidePanelRouteLabel: config.sidePanelRouteLabel,
      sidePanelOperatorId: config.sidePanelOperatorId
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

async function readActionContext(context) {
  const { config, coreStatus, identity, trustedPairing } = await readPanelContext(context);
  const module = buildModuleStatus(config);
  const connection = buildConnectionStatus(coreStatus, identity, trustedPairing);
  const identityState = buildIdentityState(config, identity, connection);
  const instanceProvider = buildInstanceProviderState(config, identityState);
  const bridge = shouldReadBridge(identityState, instanceProvider)
    ? await readBridgeStatus({ config, module, connection, context })
    : buildBridgeStatus(config, module.enabled);
  const scope = buildScope(config, identity, connection);

  return {
    config,
    module,
    connection,
    identity: identityState,
    instanceProvider,
    bridge,
    scope,
    gate: derivePanelState(module, connection, bridge, identityState, instanceProvider)
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
  config.sidePanelBondieFixtureMode = cleanString(config.sidePanelBondieFixtureMode) === 'fixtures' ? 'fixtures' : 'off';
  config.sidePanelIdentityMode = normalizeIdentityMode(config.sidePanelIdentityMode);
  config.sidePanelInstanceProvider = normalizeInstanceProvider(config.sidePanelInstanceProvider);
  config.sidePanelLocalRelationshipType = normalizeLocalRelationshipType(config.sidePanelLocalRelationshipType);
  config.sidePanelControlPlaneBaseUrl = cleanString(config.sidePanelControlPlaneBaseUrl);
  config.sidePanelWorkspaceId = cleanString(config.sidePanelWorkspaceId) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelWorkspaceId;
  config.sidePanelOrganization = cleanString(config.sidePanelOrganization) || config.sidePanelWorkspaceId;
  config.sidePanelRouteType = normalizeRouteType(config.sidePanelRouteType);
  config.sidePanelRouteKey = cleanString(config.sidePanelRouteKey) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelRouteKey;
  config.sidePanelRouteLabel = cleanString(config.sidePanelRouteLabel) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelRouteLabel;
  config.sidePanelOperatorId = cleanString(config.sidePanelOperatorId);
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
    timeoutMs: config.sessionBridgeTimeoutMs,
    permission: {
      required: configured,
      granted: false,
      origin: ''
    },
    available: false,
    remote: null,
    error: ''
  };
}

async function readBridgeStatus({ config, module, connection, context }) {
  const bridge = buildBridgeStatus(config, module.enabled);
  if (!module.enabled || !connection.paired || !connection.online || !bridge.configured) {
    return bridge;
  }

  const adapterStatus = await createSessionAdapter(config, context).status();
  return mergeBridgeStatus(bridge, adapterStatus);
}

function mergeBridgeStatus(bridge, adapterStatus) {
  const next = {
    ...bridge,
    state: adapterStatus.state || bridge.state,
    permission: adapterStatus.permission || bridge.permission,
    timeoutMs: adapterStatus.timeoutMs || bridge.timeoutMs,
    available: Boolean(adapterStatus.available),
    error: redactDiagnostic(adapterStatus.error || ''),
    remote: adapterStatus.metadata
      ? {
          bridgeId: adapterStatus.metadata.bridgeId,
          bridgeName: adapterStatus.metadata.bridgeName,
          adapter: adapterStatus.metadata.adapter,
          capabilities: adapterStatus.metadata.capabilities
        }
      : null
  };
  if (adapterStatus.ready && adapterStatus.state === 'configured') {
    next.state = 'configured';
  }
  return next;
}

function buildScope(config, identity, connection) {
  return {
    scope_version: 1,
    agent: 'openclaw',
    workspace_id: config.sidePanelWorkspaceId,
    organization: config.sidePanelOrganization,
    route_type: config.sidePanelRouteType,
    route_key: config.sidePanelRouteKey,
    route_label: config.sidePanelRouteLabel,
    device_id: cleanString(identity.hostId) || connection.hostId,
    operator_id: config.sidePanelOperatorId || (connection.paired ? 'paired-browser-host' : 'unpaired'),
    relationship_type: config.sidePanelLocalRelationshipType,
    visibility_policy: localVisibilityPolicy(config.sidePanelLocalRelationshipType),
    source: 'browser-extension-side-panel'
  };
}

function buildIdentityState(config, identity, connection) {
  if (config.sidePanelIdentityMode === 'oauth') {
    return {
      mode: 'oauth',
      required: true,
      authenticated: false,
      source: 'oauth',
      viewer: null,
      reason: 'oauth_adapter_not_configured'
    };
  }

  const hostId = cleanString(identity.hostId) || cleanString(connection.hostId);
  return {
    mode: 'legacy-paired',
    required: false,
    authenticated: Boolean(connection.paired),
    source: connection.paired ? 'paired-browser-host' : 'identity_required',
    viewer: connection.paired
      ? {
          user_id: cleanString(connection.nodeId) || hostId || 'local-viewer',
          display_name: 'Legacy paired device',
          source: 'paired-browser-host',
          device_id: hostId
        }
      : null,
    reason: connection.paired ? '' : 'device_pairing_required'
  };
}

function publicIdentityState(identityState) {
  return {
    mode: identityState.mode,
    required: identityState.required,
    authenticated: identityState.authenticated,
    source: identityState.source,
    reason: identityState.reason || ''
  };
}

function buildInstanceProviderState(config, identityState) {
  if (config.sidePanelBondieFixtureMode === 'fixtures') {
    return {
      provider: 'fixtures',
      state: 'ready',
      ready: true,
      reason: ''
    };
  }
  if (config.sidePanelInstanceProvider === 'bondie-control-plane') {
    if (identityState.mode !== 'oauth' || !identityState.authenticated) {
      return {
        provider: 'bondie-control-plane',
        state: 'identity_required',
        ready: false,
        reason: 'control_plane_requires_oauth'
      };
    }
    if (!config.sidePanelControlPlaneBaseUrl) {
      return {
        provider: 'bondie-control-plane',
        state: 'permission_unresolved',
        ready: false,
        reason: 'control_plane_not_configured'
      };
    }
    return {
      provider: 'bondie-control-plane',
      state: 'permission_unresolved',
      ready: false,
      reason: 'control_plane_adapter_not_implemented'
    };
  }

  return {
    provider: 'legacy-session-bridge',
    state: 'ready',
    ready: true,
    reason: ''
  };
}

function shouldReadBridge(identityState, instanceProvider) {
  return Boolean(identityState.authenticated && instanceProvider.provider === 'legacy-session-bridge');
}

function buildInstanceSummaries({ config, bridge, scope, identityState, instanceProvider }) {
  if (identityState && !identityState.authenticated) {
    return [];
  }
  if (instanceProvider && !instanceProvider.ready) {
    return [];
  }
  if (config.sidePanelBondieFixtureMode === 'fixtures') {
    return fixtureInstances();
  }
  return [buildLegacyInstance({ bridge, scope })];
}

function buildLegacySessionGroups({ result, bridge, scope }) {
  const instance = buildLegacyInstance({ bridge, scope, bridgeId: result.bridgeId });
  const sessions = (result.sessions || []).map((session) => attachInstanceToSession(session, instance, true));
  return {
    instances: [instance],
    groups: [
      {
        instance_id: instance.instance_id,
        instance,
        state: result.state,
        visibility_policy: instance.visibility_policy,
        actions_enabled: true,
        sessions
      }
    ],
    sessions
  };
}

function buildLegacyInstance({ bridge, scope, bridgeId = '' }) {
  const remote = bridge.remote || {};
  const displayName = cleanString(remote.bridgeName) || 'OpenClaw Mac mini';
  const relationshipType = cleanString(scope.relationship_type) || 'communication';
  const visibilityPolicy = cleanString(scope.visibility_policy) || localVisibilityPolicy(relationshipType);
  return {
    instance_id: 'legacy-session-bridge',
    display_name: displayName,
    short_name: 'Mac mini',
    relationship_type: relationshipType,
    relationship_label: localRelationshipLabel(relationshipType),
    visibility_policy: visibilityPolicy,
    visibility_label: localVisibilityLabel(visibilityPolicy),
    status: bridge.available ? 'online' : bridge.state || 'unknown',
    bridge_id: cleanString(bridgeId) || cleanString(remote.bridgeId),
    route_label: scope.route_label,
    actions_enabled: true,
    source: 'direct_session_bridge'
  };
}

function attachInstanceToSession(session, instance, actionsEnabled) {
  return {
    ...session,
    instance_id: instance.instance_id,
    instance_name: instance.display_name,
    visibility_policy: instance.visibility_policy,
    visibility_label: instance.visibility_label,
    relationship_type: instance.relationship_type,
    relationship_label: instance.relationship_label,
    actions_enabled: actionsEnabled
  };
}

function buildFixtureSessionsPayload({ bridge, scope, viewer }) {
  const instances = fixtureInstances();
  const groups = instances.map((instance) => ({
    instance_id: instance.instance_id,
    instance,
    state: instance.status === 'online' ? 'ready' : 'instance_unavailable',
    visibility_policy: instance.visibility_policy,
    actions_enabled: false,
    sessions: fixtureSessionsFor(instance).map((session) => attachInstanceToSession(session, instance, false))
  }));
  const sessions = groups.flatMap((group) => group.sessions);
  return {
    state: 'ready',
    viewer,
    bridge,
    scope,
    instances,
    groups,
    sessions,
    currentBinding: null,
    bridgeId: bridge.remote?.bridgeId || '',
    unresolved: false,
    error: '',
    updatedAt: new Date().toISOString()
  };
}

function filterSessionsPayloadByInstance(payload, instanceId) {
  const targetId = cleanString(instanceId);
  if (!targetId) {
    return payload;
  }

  const instances = Array.isArray(payload.instances) ? payload.instances : [];
  const instanceExists = instances.some((instance) => instance.instance_id === targetId);
  if (!instanceExists) {
    return {
      ...payload,
      state: 'instance_unavailable',
      requestedInstanceId: targetId,
      instances: [],
      groups: [],
      sessions: [],
      currentBinding: null,
      unresolved: true,
      error: 'instance_unavailable'
    };
  }

  const groups = (payload.groups || []).filter((group) => group.instance_id === targetId);
  const sessions = groups.flatMap((group) => group.sessions || []);
  const sessionIds = new Set(sessions.flatMap((session) => [
    cleanString(session.session_id),
    cleanString(session.session_key)
  ]).filter(Boolean));
  const currentBinding = payload.currentBinding && (
    sessionIds.has(cleanString(payload.currentBinding.session_id))
      || sessionIds.has(cleanString(payload.currentBinding.session_key))
  )
    ? payload.currentBinding
    : null;

  return {
    ...payload,
    state: sessions.length ? payload.state : 'empty_sessions',
    requestedInstanceId: targetId,
    instances: instances.filter((instance) => instance.instance_id === targetId),
    groups,
    sessions,
    currentBinding
  };
}

function fixtureInstances() {
  return [
    {
      instance_id: 'bondie-a',
      display_name: 'Bondie A',
      short_name: 'A',
      relationship_type: 'subordinate',
      relationship_label: '个人私助',
      visibility_policy: 'all_sessions',
      visibility_label: '查看全部',
      status: 'online',
      bridge_id: 'openclaw-a',
      route_label: '个人私助',
      actions_enabled: false,
      source: 'fixture'
    },
    {
      instance_id: 'bondie-b',
      display_name: 'Bondie B',
      short_name: 'B',
      relationship_type: 'communication',
      relationship_label: '团队共享',
      visibility_policy: 'participant_sessions',
      visibility_label: '仅相关',
      status: 'online',
      bridge_id: 'openclaw-b',
      route_label: '团队共享',
      actions_enabled: false,
      source: 'fixture'
    },
    {
      instance_id: 'bondie-c',
      display_name: 'Bondie C',
      short_name: 'C',
      relationship_type: 'communication',
      relationship_label: '他人分享',
      visibility_policy: 'participant_sessions',
      visibility_label: '仅相关',
      status: 'degraded',
      bridge_id: 'openclaw-c',
      route_label: '他人分享',
      actions_enabled: false,
      source: 'fixture'
    }
  ];
}

function fixtureSessionsFor(instance) {
  const common = {
    updated_at: new Date().toISOString(),
    model: 'bondie-fixture',
    project: instance.display_name,
    context_window: 204800,
    context_used: 12000,
    generation_type: 'fixture',
    restorable: false
  };
  if (instance.instance_id === 'bondie-a') {
    return [
      {
        ...common,
        session_id: 'bondie-a-session-owner',
        session_key: 'bondie-a:all:owner',
        title: '个人私助 · 今日工作线',
        summary: '从属关系可查看该 Bondie 的全部会话，包括由他人触发的工作线。',
        is_current: true,
        last_messages: ['整理上午任务', '已合并到今日工作线']
      },
      {
        ...common,
        session_id: 'bondie-a-session-shared',
        session_key: 'bondie-a:all:shared',
        title: '个人私助 · 他人协作记录',
        summary: '示例：从属关系下可见他人与该私助的历史对话。',
        last_messages: ['请同步给 Veil', '已记录并等待确认']
      }
    ];
  }
  if (instance.instance_id === 'bondie-b') {
    return [
      {
        ...common,
        session_id: 'bondie-b-session-veil',
        session_key: 'bondie-b:participant:veil',
        title: '团队共享 · Veil 相关',
        summary: '沟通关系只返回当前用户参与或被授权的 sessions。',
        last_messages: ['更新侧栏权限模型', '仅展示用户相关会话']
      }
    ];
  }
  return [
    {
      ...common,
      session_id: 'bondie-c-session-veil',
      session_key: 'bondie-c:participant:veil',
      title: '他人分享 · 需求确认',
      summary: '分享型 Bondie 只显示当前用户可访问的沟通会话。',
      last_messages: ['确认可见范围', '不展示其他用户对话']
    }
  ];
}

function derivePanelState(module, connection, bridge, identityState, instanceProvider) {
  if (!module.enabled) {
    return 'disabled';
  }
  if (!connection.paired) {
    return 'unpaired';
  }
  if (!connection.online) {
    return 'offline';
  }
  if (identityState && !identityState.authenticated) {
    return 'identity_required';
  }
  if (instanceProvider && !instanceProvider.ready) {
    return instanceProvider.state || 'permission_unresolved';
  }
  if (!bridge.configured) {
    return 'missing_config';
  }
  if (bridge.state === 'permission_required') {
    return 'bridge_permission_required';
  }
  if (bridge.state === 'invalid_base_url') {
    return 'missing_config';
  }
  if (bridge.state === 'unauthorized' || bridge.state === 'timeout' || bridge.state === 'fetch_failed' || bridge.state === 'http_error' || bridge.state === 'unavailable') {
    return 'bridge_unavailable';
  }
  return 'ready';
}

function requestedInstanceId(message) {
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
  const value = cleanString(message?.instanceId) || cleanString(payload.instanceId);
  return value === 'all' ? '' : value;
}

function deriveActionInstanceGate(actionContext, instanceId) {
  if (actionContext.instanceProvider && !actionContext.instanceProvider.ready) {
    return actionContext.instanceProvider.state || 'permission_unresolved';
  }
  if (actionContext.config.sidePanelBondieFixtureMode === 'fixtures') {
    return 'fixture_read_only';
  }
  const targetId = cleanString(instanceId);
  if (!targetId || targetId === 'legacy-session-bridge') {
    return 'ready';
  }
  return 'instance_unavailable';
}

function createSessionAdapter(config, context) {
  return new OpenClawSessionAdapter({
    config,
    chromeApi: context.chrome
  });
}

function buildBlockedActionPayload(action, actionContext) {
  return {
    action,
    state: actionContext.gate,
    instanceId: actionContext.instanceId || '',
    bridge: actionContext.bridge,
    scope: actionContext.scope,
    confirmed: false,
    result: null,
    error: actionContext.gate,
    updatedAt: new Date().toISOString()
  };
}

function buildActionPayload(action, actionContext, result) {
  return {
    action,
    state: result.state,
    instanceId: actionContext.instanceId || '',
    bridge: result.bridge ? mergeBridgeStatus(actionContext.bridge, result.bridge) : actionContext.bridge,
    scope: actionContext.scope,
    confirmed: Boolean(result.result?.confirmed),
    result: result.result || null,
    error: result.ok === false ? redactDiagnostic(result.message || result.error) : '',
    updatedAt: new Date().toISOString()
  };
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

function normalizeRouteType(value) {
  const routeType = cleanString(value) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelRouteType;
  return ['browser', 'direct', 'group'].includes(routeType) ? routeType : SIDE_PANEL_DEFAULT_CONFIG.sidePanelRouteType;
}

function normalizeIdentityMode(value) {
  const mode = cleanString(value) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelIdentityMode;
  return mode === 'oauth' ? 'oauth' : SIDE_PANEL_DEFAULT_CONFIG.sidePanelIdentityMode;
}

function normalizeInstanceProvider(value) {
  const provider = cleanString(value) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelInstanceProvider;
  return provider === 'bondie-control-plane' ? 'bondie-control-plane' : SIDE_PANEL_DEFAULT_CONFIG.sidePanelInstanceProvider;
}

function normalizeLocalRelationshipType(value) {
  const relationshipType = cleanString(value) || SIDE_PANEL_DEFAULT_CONFIG.sidePanelLocalRelationshipType;
  return relationshipType === 'subordinate' ? 'subordinate' : SIDE_PANEL_DEFAULT_CONFIG.sidePanelLocalRelationshipType;
}

function localVisibilityPolicy(relationshipType) {
  return relationshipType === 'subordinate' ? 'all_sessions' : 'participant_sessions';
}

function localRelationshipLabel(relationshipType) {
  return relationshipType === 'subordinate' ? '从属关系' : '服务关系';
}

function localVisibilityLabel(visibilityPolicy) {
  return visibilityPolicy === 'all_sessions' ? '查看全部' : '仅相关';
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
