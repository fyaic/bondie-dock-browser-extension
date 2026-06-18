const fields = [
  'gatewayUrl',
  'token',
  'authMode',
  'nodeName',
  'protocol',
  'autoConnect',
  'patternMemoryEnabled',
  'patternUploadEnabled',
  'patternRetentionLimit',
  'patternSnapshotRetentionLimit',
  'patternCandidateMinCooccurrence',
  'contextCaptureEnabled',
  'captureSessionKey',
  'handoffTimeoutMinutes',
  'mediaToNotesEnabled',
  'mediaToNotesPluginPath',
  'mediaToNotesOutputDir',
  'mediaToNotesEnvFile',
  'mediaToNotesDefaultFlags',
  'suggestionsEnabled',
  'sidePanelEnabled',
  'sidePanelAdapter',
  'sessionBridgeBaseUrl',
  'sessionBridgeToken',
  'sessionBridgeTimeoutMs',
  'sidePanelBondieFixtureMode',
  'sidePanelIdentityMode',
  'sidePanelWorkspaceId',
  'sidePanelOrganization',
  'sidePanelRouteType',
  'sidePanelRouteKey',
  'sidePanelRouteLabel',
  'sidePanelOperatorId'
];
const DEFAULT_CAPTURE_SESSION_KEY = 'browser-inbox';
const DEFAULT_CAPTURE_SESSION_NAME = 'OpenClaw 本地通道';
const fieldDefaults = {
  sidePanelEnabled: true,
  sidePanelAdapter: 'session-bridge',
  sessionBridgeBaseUrl: '',
  sessionBridgeToken: '',
  sessionBridgeTimeoutMs: 20000,
  sidePanelBondieFixtureMode: 'off',
  sidePanelIdentityMode: 'legacy-paired',
  sidePanelWorkspaceId: 'default',
  sidePanelOrganization: 'default',
  sidePanelRouteType: 'browser',
  sidePanelRouteKey: 'browser:default',
  sidePanelRouteLabel: 'Browser',
  sidePanelOperatorId: ''
};
const message = document.getElementById('message');

load();
document.getElementById('save').addEventListener('click', save);
document.getElementById('clearPatterns').addEventListener('click', clearPatterns);

async function load() {
  const data = await chrome.storage.local.get(fields);
  for (const field of fields) {
    const el = document.getElementById(field);
    const value = data[field] ?? fieldDefaults[field];
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else if (el.type === 'number') {
      el.value = value || '';
    } else if (field === 'captureSessionKey') {
      el.value = displaySessionKey(value);
    } else {
      el.value = value || '';
    }
  }
}

async function save() {
  const next = {};
  for (const field of fields) {
    const el = document.getElementById(field);
    if (el.type === 'checkbox') {
      next[field] = el.checked;
    } else if (el.type === 'number') {
      next[field] = Number(el.value);
    } else if (field === 'captureSessionKey') {
      next[field] = storageSessionKey(el.value);
    } else {
      next[field] = el.value.trim();
    }
  }
  await chrome.storage.local.set(next);
  showMessage('已保存');
}

async function clearPatterns() {
  const response = await chrome.runtime.sendMessage({ type: 'clearPatternData' });
  showMessage(response?.ok ? '已清空本地 Pattern 数据' : response?.error || '清空失败');
}

function showMessage(text) {
  message.textContent = text;
  setTimeout(() => {
    message.textContent = '';
  }, 1800);
}

function displaySessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === DEFAULT_CAPTURE_SESSION_KEY || raw === `agent:main:${DEFAULT_CAPTURE_SESSION_KEY}`) {
    return DEFAULT_CAPTURE_SESSION_NAME;
  }
  return raw.replace(/^agent:[^:]+:/, '');
}

function storageSessionKey(value) {
  const raw = String(value || '').trim();
  return !raw || raw === DEFAULT_CAPTURE_SESSION_NAME ? DEFAULT_CAPTURE_SESSION_KEY : raw;
}
