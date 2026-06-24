#!/usr/bin/env node

import { bondieSidePanelModule } from '../extension/src/modules/bondie-side-panel/module.js';
import { normalizeOAuthTokenState } from '../extension/src/modules/bondie-side-panel/oauth-token-contract.js';

const options = parseArgs(process.argv.slice(2));
const baseUrl = options.url
  || process.env.BONDIE_CONTROL_PLANE_URL
  || process.env.SIDE_PANEL_CONTROL_PLANE_URL
  || 'http://127.0.0.1:8790';
const token = options.token
  || process.env.BONDIE_CONTROL_PLANE_TOKEN
  || process.env.SIDE_PANEL_CONTROL_PLANE_DEV_TOKEN
  || process.env.BONDIE_DEV_TOKEN;
const expectInstance = options.expectInstance || process.env.BONDIE_SMOKE_EXPECT_INSTANCE || '';
const expectMinSessions = Number(options.expectMinSessions || process.env.BONDIE_SMOKE_EXPECT_MIN_SESSIONS || 0);

if (!token) {
  fail('Missing Control Plane token. Set BONDIE_CONTROL_PLANE_TOKEN, SIDE_PANEL_CONTROL_PLANE_DEV_TOKEN, or BONDIE_DEV_TOKEN.');
}

const tokenState = normalizeOAuthTokenState({
  state: 'authenticated',
  accessToken: token,
  provider: 'dev-token',
  viewer: {
    user_id: options.viewerId || process.env.BONDIE_SMOKE_VIEWER_ID || 'dev-user',
    display_name: options.viewerName || process.env.BONDIE_SMOKE_VIEWER_NAME || 'Dev User'
  }
});

const config = {
  sidePanelEnabled: true,
  sidePanelIdentityMode: 'oauth',
  sidePanelInstanceProvider: 'bondie-control-plane',
  sidePanelControlPlaneBaseUrl: baseUrl,
  sidePanelControlPlaneDevToken: token,
  sessionBridgeTimeoutMs: Number(options.timeoutMs || process.env.BONDIE_CONTROL_PLANE_TIMEOUT_MS || 20000)
};

const context = {
  chrome: {
    permissions: {
      contains: (_permission, callback) => callback(true)
    }
  },
  fetchImpl: (...args) => fetch(...args),
  getConfig: async () => config,
  ensureHostIdentity: async () => ({
    hostId: options.hostId || process.env.BONDIE_SMOKE_HOST_ID || 'runtime-smoke-host'
  }),
  getTrustedPairingState: async () => ({
    paired: false,
    hasDeviceToken: false
  }),
  getConnectionStatus: () => ({
    connected: false,
    connecting: false,
    online: false,
    paired: false
  }),
  getSidePanelOAuthToken: async () => tokenState
};

const status = await send('sidePanel.status', {});
const sessions = await send('sidePanel.sessions.list', {});
const instances = await send('sidePanel.instances.list', {});
const target = expectInstance
  ? await send('sidePanel.sessions.list', { instanceId: expectInstance })
  : null;

const summary = {
  ok: true,
  baseUrl,
  status: status.payload.state,
  bridge: {
    adapter: status.payload.bridge?.adapter || '',
    state: status.payload.bridge?.state || '',
    available: status.payload.bridge?.available === true,
    configured: status.payload.bridge?.configured === true,
    permissionGranted: status.payload.bridge?.permission?.granted === true
  },
  provider: status.payload.instanceProvider,
  identity: status.payload.identity,
  instances: (instances.payload.instances || []).map((instance) => ({
    id: instance.instance_id,
    relationship: instance.relationship_type,
    visibility: instance.visibility_policy,
    status: instance.status,
    actionsEnabled: instance.actions_enabled !== false
  })),
  groups: (sessions.payload.groups || []).map((group) => ({
    id: group.instance_id,
    visibility: group.visibility_policy,
    state: group.state,
    sessions: (group.sessions || []).length
  })),
  totalSessions: (sessions.payload.sessions || []).length,
  target: target ? {
    id: expectInstance,
    state: target.payload.state,
    sessions: (target.payload.sessions || []).length
  } : null
};

assertEqual(summary.status, 'ready', `Expected sidePanel.status=ready, got ${summary.status}`);
assertEqual(summary.bridge.adapter, 'bondie-control-plane', `Expected bondie-control-plane adapter, got ${summary.bridge.adapter}`);
assertEqual(summary.bridge.available, true, 'Expected Control Plane to be available');
if (expectInstance && !summary.instances.some((instance) => instance.id === expectInstance)) {
  fail(`Expected instance ${expectInstance} in visible instances`);
}
if (expectMinSessions > 0 && (!summary.target || summary.target.sessions < expectMinSessions)) {
  fail(`Expected at least ${expectMinSessions} sessions for ${expectInstance || 'target instance'}, got ${summary.target?.sessions || 0}`);
}

console.log(JSON.stringify(summary, null, 2));

async function send(type, message) {
  const handler = bondieSidePanelModule.messages[type];
  if (!handler) {
    fail(`Unknown message type: ${type}`);
  }
  const response = await handler({ context, message });
  if (!response?.ok) {
    fail(`Message ${type} failed: ${response?.error || 'unknown error'}`);
  }
  return response;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const value = inlineValue !== undefined ? inlineValue : args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    parsed[key] = value || '';
  }
  return parsed;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(message);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
