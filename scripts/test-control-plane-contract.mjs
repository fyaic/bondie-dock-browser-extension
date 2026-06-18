import assert from 'node:assert/strict';

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

console.log(JSON.stringify({
  ok: true,
  instances: instancesPayload.instances.length,
  sessions: sessionsPayload.sessions.length
}));
