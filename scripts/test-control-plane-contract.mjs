import assert from 'node:assert/strict';

import { BondieControlPlaneAdapter } from '../extension/src/modules/openclaw-side-panel/control-plane-adapter.js';
import { openClawSidePanelModule } from '../extension/src/modules/openclaw-side-panel/module.js';
import {
  CONTROL_PLANE_ENDPOINTS,
  buildControlPlaneHeaders,
  buildControlPlaneUrl,
  isControlPlaneActionConfirmed,
  normalizeControlPlaneActionResult,
  normalizeControlPlaneIdentity,
  normalizeControlPlaneInstancesPayload,
  normalizeControlPlaneSessionsPayload
} from '../extension/src/modules/openclaw-side-panel/control-plane-contract.js';

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
      instance_id: 'missing-policy',
      relationship_type: 'subordinate'
    }
  ]
});

assert.equal(instancesPayload.instances.length, 2);
assert.equal(instancesPayload.instances[0].visibility_label, '查看全部');
assert.equal(instancesPayload.instances[1].visibility_label, '仅相关');

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

const pairedButNoOAuthContext = createModuleContext({
  sidePanelIdentityMode: 'oauth',
  sidePanelInstanceProvider: 'bondie-control-plane',
  sidePanelControlPlaneBaseUrl: 'https://bondie.example.com/api'
});
const moduleListResult = await openClawSidePanelModule.messages['sidePanel.sessions.list']({
  message: {},
  context: pairedButNoOAuthContext
});
assert.equal(moduleListResult.ok, true);
assert.equal(moduleListResult.payload.state, 'identity_required');
assert.equal(moduleListResult.payload.sessions.length, 0);
assert.equal(moduleListResult.payload.instances.length, 0);
assert.equal(moduleListResult.payload.identity.authenticated, false);
assert.equal(moduleListResult.payload.instanceProvider.provider, 'bondie-control-plane');

const moduleNewResult = await openClawSidePanelModule.messages['sidePanel.sessions.new']({
  message: {
    instanceId: 'bondie-a'
  },
  context: pairedButNoOAuthContext
});
assert.equal(moduleNewResult.ok, true);
assert.equal(moduleNewResult.payload.state, 'identity_required');
assert.equal(moduleNewResult.payload.confirmed, false);
assert.equal(moduleNewResult.payload.instanceId, 'bondie-a');

console.log(JSON.stringify({
  ok: true,
  instances: instancesPayload.instances.length,
  sessions: sessionsPayload.sessions.length,
  adapterCalls: calls.length,
  moduleFailClosed: true
}));

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function createModuleContext(configOverrides = {}) {
  return {
    chrome: {},
    getConfig: async () => configOverrides,
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
