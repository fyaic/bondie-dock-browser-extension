import assert from 'node:assert/strict';

import { BondieControlPlaneAdapter } from '../extension/src/modules/bondie-side-panel/control-plane-adapter.js';
import { bondieSidePanelModule } from '../extension/src/modules/bondie-side-panel/module.js';
import {
  buildSessionBridgeActionPayload,
  buildSessionBridgeQuery
} from '../extension/src/modules/bondie-side-panel/contract.js';
import {
  normalizeOAuthTokenState,
  publicOAuthTokenState
} from '../extension/src/modules/bondie-side-panel/oauth-token-contract.js';
import {
  CONTROL_PLANE_ENDPOINTS,
  buildControlPlaneHeaders,
  buildControlPlaneUrl,
  isControlPlaneActionConfirmed,
  normalizeControlPlaneActionResult,
  normalizeControlPlaneIdentity,
  normalizeControlPlaneInstancesPayload,
  normalizeControlPlaneSessionsPayload
} from '../extension/src/modules/bondie-side-panel/control-plane-contract.js';

const identity = normalizeControlPlaneIdentity({
  authenticated: true,
  viewer: {
    user_id: 'veil',
    display_name: 'Veil'
  }
});

assert.equal(identity.authenticated, true);
assert.equal(identity.viewer.user_id, 'veil');
assert.equal(normalizeControlPlaneIdentity({ authenticated: true, viewer: {} }).authenticated, false);

const instancesPayload = normalizeControlPlaneInstancesPayload({
  instances: [
    {
      instance_id: 'bondie-a',
      display_name: 'Bondie A',
      relationship_type: 'subordinate',
      visibility_policy: 'all_sessions',
      status: 'online',
      roles: ['owner']
    },
    {
      instance_id: 'bondie-b',
      display_name: 'Bondie B',
      relationship_type: 'communication',
      visibility_policy: 'participant_sessions',
      status: 'online',
      roles: ['participant']
    },
    {
      instance_id: 'bad-escalation',
      relationship_type: 'communication',
      visibility_policy: 'all_sessions'
    },
    {
      instance_id: 'no-relationship',
      visibility_policy: 'participant_sessions'
    },
    {
      instance_id: 'missing-policy',
      relationship_type: 'subordinate'
    }
  ]
});

assert.equal(instancesPayload.instances.length, 2);
assert.equal(instancesPayload.instances[0].visibility_label, '查看全部');
assert.equal(instancesPayload.instances[1].visibility_label, '仅相关');

const degradedInstancesPayload = normalizeControlPlaneInstancesPayload({
  instances: [
    {
      instance_id: 'bondie-c',
      display_name: 'Bondie C',
      relationship_type: 'communication',
      visibility_policy: 'participant_sessions',
      status: 'degraded',
      health: {
        state: 'sessions_degraded',
        checked_at: '2026-06-18T08:00:00Z',
        stale: false,
        latency_ms: 820,
        sessions_ready: false
      }
    }
  ]
});
assert.equal(degradedInstancesPayload.instances.length, 1);
assert.equal(degradedInstancesPayload.instances[0].actions_enabled, false);
assert.equal(degradedInstancesPayload.instances[0].health.state, 'sessions_degraded');
assert.equal(degradedInstancesPayload.instances[0].health.sessions_ready, false);

const staleInstancesPayload = normalizeControlPlaneInstancesPayload({
  instances: [
    {
      instance_id: 'bondie-stale',
      display_name: 'Bondie Stale',
      relationship_type: 'subordinate',
      visibility_policy: 'all_sessions',
      status: 'online',
      health: {
        state: 'online',
        checked_at: '2026-06-18T07:00:00Z',
        stale: true,
        sessions_ready: true
      }
    }
  ]
});
assert.equal(staleInstancesPayload.instances.length, 1);
assert.equal(staleInstancesPayload.instances[0].health.stale, true);
assert.equal(staleInstancesPayload.instances[0].actions_enabled, false);

const now = new Date('2026-06-18T09:00:00Z');
const authenticatedToken = normalizeOAuthTokenState({
  state: 'authenticated',
  provider: 'openclaw',
  accessToken: 'redacted-token',
  expiresAt: '2026-06-18T09:10:00Z',
  viewer: {
    user_id: 'veil',
    display_name: 'Veil'
  }
}, { now });
assert.equal(authenticatedToken.authenticated, true);
assert.equal(authenticatedToken.accessToken, 'redacted-token');
assert.equal(authenticatedToken.expiresSoon, false);
assert.equal(publicOAuthTokenState(authenticatedToken).accessToken, undefined);

const expiringToken = normalizeOAuthTokenState({
  state: 'authenticated',
  accessToken: 'redacted-token',
  expiresAt: '2026-06-18T09:03:00Z',
  viewer: {
    user_id: 'veil'
  }
}, { now });
assert.equal(expiringToken.authenticated, true);
assert.equal(expiringToken.expiresSoon, true);

const expiredToken = normalizeOAuthTokenState({
  state: 'authenticated',
  accessToken: 'redacted-token',
  expiresAt: '2026-06-18T08:59:00Z',
  viewer: {
    user_id: 'veil'
  }
}, { now });
assert.equal(expiredToken.state, 'token_expired');
assert.equal(expiredToken.accessToken, '');

const missingAccessToken = normalizeOAuthTokenState({
  state: 'authenticated',
  viewer: {
    user_id: 'veil'
  }
}, { now });
assert.equal(missingAccessToken.state, 'identity_required');
assert.equal(missingAccessToken.accessToken, '');

const subordinateScope = {
  workspace_id: 'default',
  organization: '弗忧联盟',
  route_type: 'direct',
  route_key: 'wo_test',
  route_label: '周威',
  device_id: 'host-1',
  operator_id: 'Veil',
  visibility_policy: 'all_sessions'
};
const subordinateBridgeQuery = buildSessionBridgeQuery(subordinateScope);
assert.equal(subordinateBridgeQuery.visibility_policy, 'all_sessions');

const communicationBridgeQuery = buildSessionBridgeQuery({
  workspace_id: 'default',
  route_type: 'direct',
  route_key: 'wo_test',
  route_label: '周威',
  device_id: 'host-1',
  operator_id: 'Veil'
});
assert.equal(communicationBridgeQuery.visibility_policy, 'participant_sessions');
assert.equal(buildSessionBridgeActionPayload(subordinateScope, { sessionId: 'session-current' }).session_id, 'session-current');

assert.equal(
  CONTROL_PLANE_ENDPOINTS.instanceSessions('bondie/b'),
  '/v1/bondie-instances/bondie%2Fb/sessions'
);
assert.equal(CONTROL_PLANE_ENDPOINTS.instanceSessions(''), '');
assert.equal(
  buildControlPlaneUrl('https://bondie.example.com/api', CONTROL_PLANE_ENDPOINTS.instanceSessions('bondie/b'), { limit: 20 }),
  'https://bondie.example.com/api/v1/bondie-instances/bondie%2Fb/sessions?limit=20'
);
assert.equal(buildControlPlaneUrl('not a url', '/v1/me'), '');

const headers = buildControlPlaneHeaders('redacted-token', {
  Authorization: 'unexpected-overwrite',
  'X-Trace': 'contract-smoke'
});
assert.equal(headers.Authorization, 'Bearer redacted-token');
assert.equal(headers['X-Trace'], 'contract-smoke');

const sessionsPayload = normalizeControlPlaneSessionsPayload({
  sessions: [
    {
      session_id: 'session-1',
      title: 'Product discussion',
      updated_at: '2026-06-18T10:00:00Z',
      restorable: true
    },
    {
      title: 'invalid-no-session-id'
    }
  ]
}, instancesPayload.instances[1]);

assert.equal(sessionsPayload.sessions.length, 1);
assert.equal(sessionsPayload.sessions[0].instance_id, 'bondie-b');
assert.equal(sessionsPayload.sessions[0].relationship_type, 'communication');
assert.equal(sessionsPayload.sessions[0].visibility_policy, 'participant_sessions');
assert.equal(sessionsPayload.sessions[0].actions_enabled, true);

const newResult = normalizeControlPlaneActionResult({
  new_conversation_confirmed: true,
  session: {
    session_id: 'session-2'
  }
}, 'new', instancesPayload.instances[0]);

assert.equal(newResult.confirmed, true);
assert.equal(isControlPlaneActionConfirmed({ ok: true }, 'new'), false);
assert.equal(isControlPlaneActionConfirmed({ session_switch_confirmed: true }, 'switch'), true);
assert.equal(isControlPlaneActionConfirmed({ route_switch_confirmed: true }, 'switch'), true);

const calls = [];
const adapter = new BondieControlPlaneAdapter({
  config: {
    sidePanelControlPlaneBaseUrl: 'https://bondie.example.com/api',
    sidePanelControlPlaneTimeoutMs: 5000
  },
  accessToken: 'redacted-token',
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/me')) {
      return jsonResponse({
        authenticated: true,
        viewer: {
          user_id: 'veil',
          display_name: 'Veil'
        }
      });
    }
    if (url.endsWith('/api/v1/bondie-instances')) {
      return jsonResponse({
        instances: [
          {
            instance_id: 'bondie-a',
            display_name: 'Bondie A',
            relationship_type: 'subordinate',
            visibility_policy: 'all_sessions',
            status: 'online'
          },
          {
            instance_id: 'bondie-b',
            display_name: 'Bondie B',
            relationship_type: 'communication',
            visibility_policy: 'participant_sessions',
            status: 'online'
          },
          {
            instance_id: 'bad-escalation',
            relationship_type: 'communication',
            visibility_policy: 'all_sessions',
            status: 'online'
          }
        ]
      });
    }
    if (url.endsWith('/api/v1/bondie-instances/bondie-b/sessions')) {
      return jsonResponse({
        sessions: [
          {
            session_id: 'session-3',
            title: 'Adapter session'
          }
        ]
      });
    }
    if (url.endsWith('/api/v1/bondie-instances/bondie-a/sessions/new')) {
      return jsonResponse({
        new_conversation_confirmed: true,
        session: {
          session_id: 'session-4'
        }
      });
    }
    return jsonResponse({}, 404);
  }
});

const missingUrl = await new BondieControlPlaneAdapter({ accessToken: 'redacted-token' }).listInstances();
assert.equal(missingUrl.state, 'permission_unresolved');

const missingToken = await new BondieControlPlaneAdapter({
  config: { sidePanelControlPlaneBaseUrl: 'https://bondie.example.com' }
}).listInstances();
assert.equal(missingToken.state, 'identity_required');

const adapterStatus = await adapter.status();
assert.equal(adapterStatus.ok, true);
assert.equal(adapterStatus.identity.viewer.user_id, 'veil');

const adapterInstances = await adapter.listInstances();
assert.equal(adapterInstances.instances.length, 2);

const adapterSessions = await adapter.listSessions(adapterInstances.instances[1]);
assert.equal(adapterSessions.sessions.length, 1);
assert.equal(adapterSessions.sessions[0].instance_id, 'bondie-b');

const missingSwitchTarget = await adapter.switchSession(adapterInstances.instances[1], '');
assert.equal(missingSwitchTarget.state, 'missing_session_id');

const adapterNewResult = await adapter.newConversation(adapterInstances.instances[0]);
assert.equal(adapterNewResult.state, 'action_confirmed');
assert.equal(adapterNewResult.result.confirmed, true);
assert.equal(calls.length, 4);
assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer redacted-token'));
assert.ok(calls.every((call) => call.url.startsWith('https://bondie.example.com/api/v1/')));

const beforeDisabledActionCalls = calls.length;
const disabledActionResult = await adapter.newConversation({
  ...adapterInstances.instances[1],
  actions_enabled: false
});
assert.equal(disabledActionResult.state, 'instance_action_unavailable');
assert.equal(calls.length, beforeDisabledActionCalls);

const unauthorizedAdapter = new BondieControlPlaneAdapter({
  config: {
    sidePanelControlPlaneBaseUrl: 'https://bondie.example.com/api'
  },
  accessToken: 'redacted-token',
  fetchImpl: async () => jsonResponse({}, 401)
});
const unauthorizedInstances = await unauthorizedAdapter.listInstances();
assert.equal(unauthorizedInstances.state, 'control_plane_http_error');
assert.equal(unauthorizedInstances.controlPlane.baseUrlConfigured, true);

const pairedButNoOAuthContext = createModuleContext({
  sidePanelIdentityMode: 'oauth',
  sidePanelInstanceProvider: 'bondie-control-plane',
  sidePanelControlPlaneBaseUrl: 'https://bondie.example.com/api'
});
const moduleListResult = await bondieSidePanelModule.messages['sidePanel.sessions.list']({
  message: {},
  context: pairedButNoOAuthContext
});
assert.equal(moduleListResult.ok, true);
assert.equal(moduleListResult.payload.state, 'identity_required');
assert.equal(moduleListResult.payload.sessions.length, 0);
assert.equal(moduleListResult.payload.instances.length, 0);
assert.equal(moduleListResult.payload.identity.authenticated, false);
assert.equal(moduleListResult.payload.instanceProvider.provider, 'bondie-control-plane');

const moduleNewResult = await bondieSidePanelModule.messages['sidePanel.sessions.new']({
  message: {
    instanceId: 'bondie-a'
  },
  context: pairedButNoOAuthContext
});
assert.equal(moduleNewResult.ok, true);
assert.equal(moduleNewResult.payload.state, 'identity_required');
assert.equal(moduleNewResult.payload.confirmed, false);
assert.equal(moduleNewResult.payload.instanceId, 'bondie-a');

const moduleControlPlaneCalls = [];
const moduleControlPlaneContext = createModuleContext({
  sidePanelIdentityMode: 'oauth',
  sidePanelInstanceProvider: 'bondie-control-plane',
  sidePanelControlPlaneBaseUrl: 'https://bondie.example.com/api'
}, {
  accessToken: 'redacted-token',
  fetchImpl: async (url, options) => {
    moduleControlPlaneCalls.push({ url, options });
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/me') {
      return jsonResponse({
        authenticated: true,
        source: 'dev-token',
        viewer: {
          user_id: 'veil',
          display_name: 'Veil'
        }
      });
    }
    if (parsed.pathname === '/api/v1/bondie-instances') {
      return jsonResponse({
        viewer: {
          user_id: 'veil',
          display_name: 'Veil'
        },
        instances: [
          {
            instance_id: 'bondie-a',
            display_name: 'Bondie A',
            relationship_type: 'subordinate',
            visibility_policy: 'all_sessions',
            status: 'online',
            actions_enabled: true
          }
        ]
      });
    }
    if (parsed.pathname === '/api/v1/bondie-instances/bondie-a/sessions') {
      return jsonResponse({
        instance: {
          instance_id: 'bondie-a',
          display_name: 'Bondie A',
          relationship_type: 'subordinate',
          visibility_policy: 'all_sessions',
          status: 'online',
          actions_enabled: true
        },
        sessions: [
          {
            session_id: 'sess-a',
            title: 'Bondie A session',
            updated_at: '2026-06-23T00:00:00Z'
          }
        ]
      });
    }
    if (parsed.pathname === '/api/v1/bondie-instances/bondie-a/sessions/new') {
      return jsonResponse({
        operation_status: 'confirmed',
        new_conversation_confirmed: true,
        session: {
          session_id: 'sess-new',
          title: 'New Bondie A session'
        }
      });
    }
    return jsonResponse({}, 404);
  }
});
const moduleControlPlaneList = await bondieSidePanelModule.messages['sidePanel.sessions.list']({
  message: {},
  context: moduleControlPlaneContext
});
assert.equal(moduleControlPlaneList.ok, true);
assert.equal(moduleControlPlaneList.payload.state, 'ready');
assert.equal(moduleControlPlaneList.payload.instances.length, 1);
assert.equal(moduleControlPlaneList.payload.groups.length, 1);
assert.equal(moduleControlPlaneList.payload.sessions.length, 1);
assert.equal(moduleControlPlaneList.payload.sessions[0].instance_id, 'bondie-a');
assert.ok(moduleControlPlaneCalls.every((call) => call.options.headers.Authorization === 'Bearer redacted-token'));

const moduleControlPlaneNew = await bondieSidePanelModule.messages['sidePanel.sessions.new']({
  message: {
    instanceId: 'bondie-a'
  },
  context: moduleControlPlaneContext
});
assert.equal(moduleControlPlaneNew.ok, true);
assert.equal(moduleControlPlaneNew.payload.state, 'action_confirmed');
assert.equal(moduleControlPlaneNew.payload.confirmed, true);

const subordinateLocalContext = createModuleContext({
  sidePanelLocalRelationshipType: 'subordinate'
});
const subordinateLocalList = await bondieSidePanelModule.messages['sidePanel.sessions.list']({
  message: {},
  context: subordinateLocalContext
});
assert.equal(subordinateLocalList.ok, true);
assert.equal(subordinateLocalList.payload.scope.visibility_policy, 'all_sessions');
assert.equal(subordinateLocalList.payload.scope.relationship_type, 'subordinate');

console.log(JSON.stringify({
  ok: true,
  instances: instancesPayload.instances.length,
  sessions: sessionsPayload.sessions.length,
  adapterCalls: calls.length,
  moduleFailClosed: true,
  moduleControlPlaneCalls: moduleControlPlaneCalls.length
}));

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function createModuleContext(configOverrides = {}, options = {}) {
  return {
    chrome: {},
    fetchImpl: options.fetchImpl,
    getConfig: async () => configOverrides,
    getSidePanelOAuthToken: async () => normalizeOAuthTokenState(options.accessToken
      ? {
          state: 'authenticated',
          accessToken: options.accessToken,
          provider: 'dev-token'
        }
      : {
          state: 'provider_unconfigured'
        }),
    ensureHostIdentity: async () => ({
      hostId: 'host-1'
    }),
    getTrustedPairingState: async () => ({
      paired: true,
      pairing: 'paired',
      hasDeviceToken: true
    }),
    getConnectionStatus: () => ({
      connected: true,
      connecting: false,
      online: true,
      hostId: 'host-1',
      nodeId: 'node-1',
      lastError: ''
    })
  };
}
