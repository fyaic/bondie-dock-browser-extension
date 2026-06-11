const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const filterButtons = [...document.querySelectorAll('[data-history-filter]')];
let currentFilter = 'all';
let cachedHandoffs = [];

document.getElementById('refreshHistory').addEventListener('click', loadHistory);
historyList.addEventListener('click', handleHistoryAction);
for (const button of filterButtons) {
  button.addEventListener('click', () => {
    currentFilter = button.dataset.historyFilter;
    renderHistory();
  });
}

async function handleHistoryAction(event) {
  const button = event.target.closest('button[data-action="retry-handoff"]');
  if (!button) {
    return;
  }
  button.disabled = true;
  await chrome.runtime.sendMessage({ type: 'retryHandoff', payload: { handoffId: button.dataset.id } });
  await loadHistory();
}

loadHistory();

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'handoffs' });
  cachedHandoffs = response?.payload?.handoffs || [];
  renderHistory();
}

function renderHistory() {
  replaceChildren(historyList);
  updateFilterState();

  if (!cachedHandoffs.length) {
    historyCount.textContent = '0 条';
    historyList.appendChild(emptyState('暂无处理记录'));
    return;
  }

  const visible = cachedHandoffs.filter(matchesCurrentFilter);
  historyCount.textContent = visible.length === cachedHandoffs.length
    ? `${visible.length} 条`
    : `${visible.length} / ${cachedHandoffs.length} 条`;

  if (!visible.length) {
    historyList.appendChild(emptyState('没有匹配记录'));
    return;
  }

  for (const handoff of visible) {
    historyList.appendChild(historyItem(handoff));
  }
}

function historyItem(handoff) {
  const item = document.createElement('article');
  item.className = 'history-item';
  item.dataset.state = handoff.state || 'idle';

  const main = document.createElement('div');
  main.className = 'history-main';

  const title = document.createElement('h2');
  title.textContent = handoff.title || 'Untitled page';
  main.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'history-meta';
  meta.textContent = [
    stateText(handoff.state),
    serviceText(handoff.service || handoff.intent),
    handoff.ability?.name,
    formatTime(handoff.updatedAt || handoff.capturedAt)
  ].filter(Boolean).join(' · ');
  main.appendChild(meta);

  const reply = summarizeReply(handoff.latestReply || handoff.error || '');
  if (reply) {
    const body = document.createElement('p');
    body.className = handoff.error ? 'error-text' : 'reply-text';
    body.textContent = reply;
    main.appendChild(body);
  }

  const path = extractMarkdownPath(handoff.latestReply);
  if (path) {
    const artifact = document.createElement('p');
    artifact.className = 'artifact-path';
    artifact.textContent = path;
    main.appendChild(artifact);
  }

  const actions = document.createElement('div');
  actions.className = 'history-actions';
  if (isWebUrl(handoff.url)) {
    const open = document.createElement('a');
    open.className = 'button-link';
    open.href = handoff.url;
    open.target = '_blank';
    open.rel = 'noreferrer';
    open.textContent = '打开来源';
    actions.appendChild(open);
  }
  if (canRetryHandoff(handoff)) {
    const retry = document.createElement('button');
    retry.className = 'button-link';
    retry.type = 'button';
    retry.dataset.action = 'retry-handoff';
    retry.dataset.id = handoff.id;
    retry.textContent = '重试';
    actions.appendChild(retry);
  }

  item.appendChild(main);
  item.appendChild(actions);
  return item;
}

function canRetryHandoff(handoff) {
  return handoff?.state === 'error' || handoff?.state === 'captured-local';
}

function updateFilterState() {
  for (const button of filterButtons) {
    const active = button.dataset.historyFilter === currentFilter;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function matchesCurrentFilter(handoff) {
  if (currentFilter === 'all') {
    return true;
  }
  if (currentFilter === 'processing') {
    return handoff.state === 'processing' || handoff.state === 'queued';
  }
  return handoff.state === currentFilter;
}

function stateText(state) {
  const states = {
    queued: '排队中',
    processing: '处理中',
    done: '已完成',
    error: '失败',
    'captured-local': '本地已捕获'
  };
  return states[state] || '待命';
}

function serviceText(service) {
  const labels = {
    knowledge: '入库为知识笔记',
    relate: '找库内关联',
    research: '发起深研',
    issue: 'Issue 草案',
    summarize: '快速读懂',
    workflow: '转成行动',
    later: '稍后处理',
    save: '稍后处理',
    next: '转成行动'
  };
  return labels[service] || '页面处理';
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function extractMarkdownPath(text) {
  const raw = typeof text === 'string' ? text : '';
  const match = raw.match(/(?:~|\/Users|\/tmp|\/var|\/private|\/)[^\n\r"'`<>]*?\.md\b/);
  return match ? match[0].trim() : '';
}

function summarizeReply(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === '{"ok":true}') {
    return '';
  }
  const path = extractMarkdownPath(normalized);
  const withoutPath = path ? normalized.replace(path, '').trim() : normalized;
  return compactText(withoutPath || normalized, 420);
}

function compactText(text, limit) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function isWebUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

function emptyState(text) {
  const node = document.createElement('p');
  node.className = 'empty';
  node.textContent = text;
  return node;
}

function replaceChildren(container) {
  while (container.firstChild) {
    container.firstChild.remove();
  }
}
