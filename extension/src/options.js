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
  'suggestionsEnabled'
];
const message = document.getElementById('message');

load();
document.getElementById('save').addEventListener('click', save);
document.getElementById('clearPatterns').addEventListener('click', clearPatterns);

async function load() {
  const data = await chrome.storage.local.get(fields);
  for (const field of fields) {
    const el = document.getElementById(field);
    if (el.type === 'checkbox') {
      el.checked = Boolean(data[field]);
    } else if (el.type === 'number') {
      el.value = data[field] || '';
    } else {
      el.value = data[field] || '';
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
