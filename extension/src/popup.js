const output = document.getElementById('output');
const status = document.getElementById('status');
const routeLabel = document.getElementById('routeLabel');
const pageHint = document.getElementById('pageHint');
const pageKind = document.getElementById('pageKind');
const handoffState = document.getElementById('handoffState');
const handoffList = document.getElementById('handoffList');
const patternList = document.getElementById('patternList');
const candidateList = document.getElementById('candidateList');
const suggestionList = document.getElementById('suggestionList');
const mediaPluginLabel = document.getElementById('mediaPluginLabel');
const captureContextButton = document.getElementById('captureContext');
const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const popupViews = {
  page: document.getElementById('pageView'),
  workflow: document.getElementById('workflowView'),
  activity: document.getElementById('activityView')
};
const viewButtons = [...document.querySelectorAll('[data-popup-view]')];
const DISMISSED_NOTIFICATIONS_KEY = 'browserDismissedHandoffNotifications';
const MAX_DISMISSED_NOTIFICATIONS = 120;
let pageHintHoldUntil = 0;

bind('connect', { type: 'connect' });
bind('disconnect', { type: 'disconnect' });
bind('notify', {
  type: 'notify',
  payload: {
    title: 'OpenClaw Browser Host',
    body: '浏览器插件通知测试'
  }
});
bind('tab', { type: 'currentTab' });
bindPageSummary();
bind('downloads', {
  type: 'downloadsSummary',
  payload: { lookbackMinutes: 60, maxItems: 20 }
});
bind('confirm', {
  type: 'userConfirm',
  payload: {
    title: 'OpenClaw Browser Host',
    message: '允许这次来自 OpenClaw 的测试确认请求吗？'
  }
});
bind('savePattern', { type: 'saveCurrentPattern' });
bind('scanPatterns', { type: 'scanPatterns' });
bindPageServices();
bindPopupViews();
document.addEventListener('click', handleWorkflowClick);
document.getElementById('openSettings').addEventListener('click', () => showSettings(true));
document.getElementById('closeSettings').addEventListener('click', () => showSettings(false));
document.getElementById('openHistory').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/history.html') });
});

refreshStatus();
refreshWorkflow();
refreshPageMeta();
setInterval(() => {
  refreshStatus();
  refreshWorkflow();
  refreshPageMeta();
}, 2500);

function bind(id, message) {
  document.getElementById(id).addEventListener('click', async () => {
    await sendAndRender(message);
  });
}

function bindPageSummary() {
  document.getElementById('summary').addEventListener('click', async () => {
    await sendPageScopedMessage({ type: 'pageSummary' }, 'extracting-page-summary');
  });
}

function bindPageServices() {
  captureContextButton.addEventListener('click', async () => {
    await sendPageService('knowledge');
  });

  for (const button of document.querySelectorAll('[data-page-service]')) {
    button.addEventListener('click', async () => {
      await sendPageService(button.dataset.pageService);
    });
  }
}

function bindPopupViews() {
  for (const button of viewButtons) {
    button.addEventListener('click', () => showPopupView(button.dataset.popupView));
  }
}

function showPopupView(name) {
  const nextView = popupViews[name] ? name : 'page';
  for (const [viewName, view] of Object.entries(popupViews)) {
    view.hidden = viewName !== nextView;
  }
  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', button.dataset.popupView === nextView ? 'true' : 'false');
  }
}

async function sendPageService(service) {
  await sendPageScopedMessage({
    type: 'pageService',
    payload: { service }
  }, service);
}

async function refreshPageMeta() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'pageMeta' });
    if (!response?.ok) {
      pageKind.textContent = '网页';
      pageHint.textContent = '等待当前网页';
      captureContextButton.textContent = '解析当前页';
      captureContextButton.disabled = true;
      return;
    }
    const payload = response.payload || {};
    pageKind.textContent = payload.contentLabel || pageKindText(payload.contentType);
    captureContextButton.textContent = primaryActionText(payload.contentType);
    captureContextButton.disabled = !payload.knowledgeSupported;
    if (Date.now() >= pageHintHoldUntil) {
      pageHint.textContent = compactText(payload.title || payload.url || '当前网页', 42);
    }
  } catch {
    pageKind.textContent = '网页';
    captureContextButton.textContent = '解析当前页';
    captureContextButton.disabled = true;
    if (Date.now() >= pageHintHoldUntil) {
      pageHint.textContent = '等待当前网页';
    }
  }
}

function pageKindText(contentType) {
  const labels = {
    article: '文章',
    webpage: '网页',
    video: '视频',
    'github-repository': 'GitHub 仓库'
  };
  return labels[contentType] || '网页';
}

function primaryActionText(contentType) {
  const labels = {
    article: '解析文章为知识笔记',
    webpage: '解析当前页',
    video: '解析视频内容',
    'github-repository': '解析 GitHub 仓库'
  };
  return labels[contentType] || '解析当前页';
}

function pageServiceText(service) {
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

function pendingText(service) {
  const labels = {
    knowledge: '正在启动 Media to Notes',
    relate: '正在查找库内关联',
    research: '正在准备深研任务',
    issue: '正在生成 Issue 草案',
    summarize: '正在快速读懂',
    workflow: '正在转成行动',
    later: '正在保存稍后线索',
    save: '正在保存稍后线索',
    next: '正在转成行动'
  };
  return labels[service] || '正在发送';
}

function doneText(service) {
  const labels = {
    knowledge: '已交给 Media to Notes',
    relate: '已交给 OpenClaw 查找关联',
    research: '已交给 OpenClaw 发起深研',
    issue: '已交给 OpenClaw 生成草案',
    summarize: '已交给 OpenClaw 快速读懂',
    workflow: '已交给 OpenClaw 转成行动',
    later: '已交给 OpenClaw 稍后处理',
    save: '已交给 OpenClaw 稍后处理',
    next: '已交给 OpenClaw 转成行动'
  };
  return labels[service] || '已交给 OpenClaw';
}

function statusText(statusValue) {
  const labels = {
    'extracting-page-summary': '正在读取页面',
    'capturing-context': '正在发送',
    'requesting-page-permission': '等待页面权限',
    'capturing-knowledge': '正在入库',
    'capturing-relate': '正在找关联',
    'capturing-research': '正在准备深研',
    'capturing-issue': '正在生成草案',
    'capturing-summarize': '正在快速读懂',
    'capturing-workflow': '正在生成行动',
    'capturing-later': '正在保存线索'
  };
  return labels[statusValue] || statusValue;
}

function serviceStatus(service) {
  return `capturing-${service}`;
}

function servicePayloadDetail(payload) {
  if (!payload?.status) {
    return '';
  }
  return payload.origin ? `${statusText(payload.status)} · ${payload.origin}` : statusText(payload.status);
}

function serviceFailureText(response) {
  return response?.error || '发送失败';
}

function serviceMessage(service, phase) {
  return phase === 'done' ? doneText(service) : pendingText(service);
}

function renderServiceResult(response, service) {
  render(response);
  pageHintHoldUntil = Date.now() + 8000;
  pageHint.textContent = response?.ok ? serviceMessage(service, 'done') : serviceFailureText(response);
}

function renderServicePending(service, origin = '') {
  const statusValue = serviceStatus(service);
  render({
    ok: true,
    payload: {
      status: statusValue,
      origin
    }
  });
  pageHintHoldUntil = Date.now() + 8000;
  pageHint.textContent = origin ? `${pendingText(service)} · ${origin}` : pendingText(service);
}

async function sendPageScopedMessage(message, service) {
  try {
    renderServicePending(service);
    const firstAttempt = await chrome.runtime.sendMessage(message);
    if (firstAttempt?.ok) {
      renderServiceResult(firstAttempt, service);
      await refreshStatus();
      await refreshWorkflow();
      return;
    }

    const tabResponse = await chrome.runtime.sendMessage({ type: 'currentTab' });
    if (!tabResponse?.ok || !tabResponse.payload?.url) {
      render(firstAttempt || tabResponse);
      return;
    }

    const origin = new URL(tabResponse.payload.url).origin;
    render({ ok: true, payload: { status: 'requesting-page-permission', origin, detail: servicePayloadDetail({ status: 'requesting-page-permission', origin }) } });
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      render(firstAttempt);
      return;
    }

    renderServicePending(service, origin);
    const response = await chrome.runtime.sendMessage(message);
    renderServiceResult(response, service);
    await refreshStatus();
    await refreshWorkflow();
  } catch (error) {
    pageHintHoldUntil = Date.now() + 8000;
    pageHint.textContent = '发送失败';
    render({ ok: false, error: error.message });
  }
}

async function sendAndRender(message) {
  const response = await chrome.runtime.sendMessage(message);
  render(response);
  await refreshStatus();
  await refreshWorkflow();
  return response;
}

async function refreshStatus() {
  const [statusResponse, config] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'status' }),
    chrome.storage.local.get(['captureSessionKey', 'mediaToNotesPluginPath', 'mediaToNotesOutputDir'])
  ]);
  const current = statusResponse?.status || {};
  const connected = Boolean(current.connected);
  const online = Boolean(current.online);
  const connecting = Boolean(current.connecting);
  const paired = current.pairing === 'paired' || Boolean(current.registered);
  const sessionKey = config.captureSessionKey || 'browser-inbox';

  routeLabel.textContent = displayInboxName(sessionKey);
  mediaPluginLabel.textContent = mediaPluginStatus(config);
  if (online && paired) {
    status.textContent = '在线';
  } else if (connecting) {
    status.textContent = '连接中';
  } else if (paired) {
    status.textContent = '重连中';
  } else if (current.pairing === 'pending') {
    status.textContent = '待授权';
  } else {
    status.textContent = connected ? '握手中' : '离线';
  }
  status.dataset.state = online && paired ? 'online' : paired ? 'paired' : connecting ? 'connecting' : 'offline';
}

function showSettings(visible) {
  mainView.hidden = visible;
  settingsView.hidden = !visible;
}

async function refreshWorkflow() {
  const patternsResponse = await chrome.runtime.sendMessage({ type: 'patterns' });
  const [suggestionsResponse, handoffsResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'suggestions' }),
    chrome.runtime.sendMessage({ type: 'handoffs' })
  ]);
  const suggestions = suggestionsResponse?.payload?.suggestions || [];
  const dismissed = await loadDismissedNotifications();

  renderHandoffs(handoffsResponse?.payload?.handoffs || [], dismissed);
  renderPatterns(patternsResponse?.payload || {}, suggestions.length);
  renderSuggestions(suggestions);
}

async function handleWorkflowClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;
  if (action === 'open-pattern') {
    await sendAndRender({ type: 'openPattern', payload: { patternId: id } });
    return;
  }

  if (action === 'save-candidate') {
    await sendAndRender({ type: 'saveCandidate', payload: { candidateId: id } });
    return;
  }

  if (action === 'accept-suggestion' || action === 'dismiss-suggestion') {
    await sendAndRender({
      type: 'suggestionFeedback',
      payload: {
        suggestionId: id,
        action: action === 'accept-suggestion' ? 'accepted' : 'dismissed'
      }
    });
    return;
  }

  if (action === 'dismiss-notification') {
    await dismissNotification(id);
    await refreshWorkflow();
  }
}

function renderHandoffs(handoffs, dismissed) {
  replaceChildren(handoffList);
  const visible = handoffs.filter((item) => !dismissed.has(item.id));
  const latest = visible[0];
  handoffState.textContent = latest ? stateText(latest.state) : handoffs.length ? '无新通知' : '待命';
  handoffState.dataset.state = latest?.state || 'idle';
  handoffList.hidden = false;

  if (!visible.length) {
    handoffList.hidden = true;
    return;
  }

  for (const handoff of visible.slice(0, 2)) {
    handoffList.appendChild(handoffCard(handoff, true));
  }
}

function handoffCard(handoff, isCurrent) {
  const row = document.createElement('article');
  row.className = isCurrent ? 'handoff-item handoff-current' : 'handoff-item handoff-compact';
  row.dataset.state = handoff.state || 'idle';
  const meta = [
    stateText(handoff.state),
    pageServiceText(handoff.service || handoff.intent),
    handoff.ability?.name
  ].filter(Boolean).join(' · ');
  row.appendChild(itemText(handoff.title, meta));
  const replyText = popupReplyText(handoff.latestReply);
  const notePath = extractMarkdownPath(handoff.latestReply);
  if (isCurrent && (replyText || handoff.error)) {
    const reply = document.createElement('p');
    reply.className = handoff.error ? 'error-text' : 'reply-text';
    reply.textContent = handoff.error ? compactText(handoff.error, 180) : replyText;
    row.appendChild(reply);
  }
  if (isCurrent && notePath) {
    const path = document.createElement('p');
    path.className = 'artifact-path';
    path.textContent = notePath;
    row.appendChild(path);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button close-card';
  close.dataset.action = 'dismiss-notification';
  close.dataset.id = handoff.id;
  close.title = '关闭通知';
  close.setAttribute('aria-label', '关闭通知');
  close.textContent = '×';
  row.appendChild(close);
  return row;
}

function popupReplyText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed === '{"ok":true}') {
    return '';
  }
  return compactText(extractReadableSummary(trimmed), 180);
}

function extractReadableSummary(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const path = extractMarkdownPath(normalized);
  const withoutPath = path ? normalized.replace(path, '').trim() : normalized;
  const markerPatterns = [
    /(?:TL;?DR|TL；?DR|TLDR)[：:]\s*([^【\[]+)/i,
    /【摘要】\s*([^【\[]+)/,
    /摘要[：:]\s*([^【\[]+)/
  ];
  for (const pattern of markerPatterns) {
    const match = withoutPath.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return withoutPath;
}

function renderPatterns(payload) {
  renderPatternGroup(patternList, payload.patterns || [], {
    emptyText: '还没有固定组合',
    itemKind: 'saved',
    buttonAction: 'open-pattern',
    buttonText: '打开'
  });
  renderPatternGroup(candidateList, payload.candidates || [], {
    emptyText: '',
    itemKind: 'candidate',
    buttonAction: 'save-candidate',
    buttonText: '固定',
    limit: 2
  });
}

function renderPatternGroup(container, patterns, options) {
  replaceChildren(container);
  if (!patterns.length) {
    if (options.emptyText) {
      container.appendChild(emptyState(options.emptyText));
    }
    return;
  }

  for (const pattern of patterns.slice(0, options.limit || 4)) {
    const row = document.createElement('article');
    row.className = `workflow-item ${options.itemKind === 'candidate' ? 'candidate-item' : ''}`.trim();
    row.appendChild(itemText(pattern.name, describePattern(pattern)));
    if (options.buttonAction && options.buttonText) {
      row.appendChild(actionButton(options.buttonText, options.buttonAction, pattern.id));
    }
    container.appendChild(row);
  }
}

function renderSuggestions(suggestions) {
  replaceChildren(suggestionList);
  const visibleSuggestions = uniqueSuggestions(suggestions);
  if (!visibleSuggestions.length) {
    suggestionList.appendChild(emptyState('当前页暂无可恢复页面'));
    return;
  }

  for (const suggestion of visibleSuggestions.slice(0, 2)) {
    const row = document.createElement('article');
    row.className = 'workflow-item suggestion-card';
    row.appendChild(suggestionText(suggestion));
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    actions.appendChild(actionButton(suggestion.source === 'pattern-memory' ? '打开' : '接受', 'accept-suggestion', suggestion.id));
    actions.appendChild(actionButton('忽略', 'dismiss-suggestion', suggestion.id));
    row.appendChild(actions);
    suggestionList.appendChild(row);
  }
}

function uniqueSuggestions(suggestions) {
  const seen = new Set();
  const result = [];
  for (const suggestion of suggestions) {
    const urls = Array.isArray(suggestion.urls) ? suggestion.urls : [];
    const userFacingKey = `${displaySuggestionTitle(suggestion)}::${describeSuggestion(suggestion)}`;
    const key = userFacingKey || (urls.length ? urls.slice().sort().join('|') : suggestion.patternId || suggestion.id);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
  }
  return result;
}

function displaySuggestionTitle(suggestion) {
  return suggestion.source === 'pattern-memory' ? '恢复相关页面' : suggestion.title;
}

function describeSuggestion(suggestion) {
  const count = Array.isArray(suggestion.urls) ? suggestion.urls.length : 0;
  if (suggestion.source === 'pattern-memory') {
    const preview = Array.isArray(suggestion.previewTitles)
      ? suggestion.previewTitles.map((title) => String(title || '').trim()).filter(Boolean).slice(0, 2)
      : [];
    if (preview.length) {
      return `${preview.join('、')}${count > preview.length ? ` 等 ${count} 个页面` : ''}`;
    }
    return `当前页有 ${count} 个相关页面可恢复`;
  }
  return `OpenClaw · ${suggestion.message || `${count} 个链接`}`;
}

function describeSuggestionReason(suggestion) {
  if (suggestion.source !== 'pattern-memory') {
    return suggestion.reason || '';
  }

  return [
    matchedByText(suggestion.matchedBy),
    confidenceText(suggestion.confidence),
    suggestion.reason
  ].filter(Boolean).join(' · ');
}

function matchedByText(matchedBy) {
  const labels = {
    url: 'URL 命中',
    topic: '主题命中',
    origin: '站点命中'
  };
  return labels[matchedBy] || '';
}

function confidenceText(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) {
    return '';
  }
  return `置信度 ${Math.round(value * 100)}%`;
}

function describePattern(pattern) {
  const origins = [...new Set((pattern.tabs || []).map((tab) => tab.origin).filter(Boolean))];
  const suffix = pattern.cooccurrenceCount ? ` · 出现 ${pattern.cooccurrenceCount} 次` : '';
  return `${(pattern.tabs || []).length} 个链接 · ${origins.slice(0, 3).join('、')}${suffix}`;
}

function suggestionText(suggestion) {
  const wrapper = itemText(displaySuggestionTitle(suggestion), describeSuggestion(suggestion));
  const reason = describeSuggestionReason(suggestion);
  if (reason) {
    const small = document.createElement('small');
    small.className = 'suggestion-reason';
    small.textContent = reason;
    wrapper.appendChild(small);
  }
  return wrapper;
}

function itemText(title, detail) {
  const wrapper = document.createElement('div');
  wrapper.className = 'item-text';

  const strong = document.createElement('strong');
  strong.textContent = title || 'Untitled';
  wrapper.appendChild(strong);

  const small = document.createElement('small');
  small.textContent = detail || '';
  wrapper.appendChild(small);

  return wrapper;
}

function actionButton(text, action, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'compact';
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = text;
  return button;
}

function emptyState(text) {
  const node = document.createElement('p');
  node.className = 'empty';
  node.textContent = text;
  return node;
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

function displayInboxName(sessionKey) {
  const raw = String(sessionKey || '').trim();
  if (!raw || raw === 'browser-inbox' || raw === 'agent:main:browser-inbox') {
    return 'OpenClaw 本地通道';
  }
  return raw.replace(/^agent:[^:]+:/, '');
}

function mediaPluginStatus(config) {
  const path = String(config.mediaToNotesPluginPath || '').trim();
  const output = String(config.mediaToNotesOutputDir || '').trim();
  if (!path) {
    return 'Media to Notes 待配置';
  }
  return output ? `Media to Notes · ${compactText(output, 34)}` : 'Media to Notes 已配置';
}

async function loadDismissedNotifications() {
  const stored = await chrome.storage.local.get([DISMISSED_NOTIFICATIONS_KEY]);
  return new Set(Array.isArray(stored[DISMISSED_NOTIFICATIONS_KEY]) ? stored[DISMISSED_NOTIFICATIONS_KEY] : []);
}

async function dismissNotification(id) {
  if (!id) {
    return;
  }
  const dismissed = await loadDismissedNotifications();
  dismissed.add(id);
  await chrome.storage.local.set({
    [DISMISSED_NOTIFICATIONS_KEY]: [...dismissed].slice(-MAX_DISMISSED_NOTIFICATIONS)
  });
}

function extractMarkdownPath(text) {
  const raw = typeof text === 'string' ? text : '';
  const match = raw.match(/(?:~|\/Users|\/tmp|\/var|\/private|\/)[^\n\r"'`<>]*?\.md\b/);
  return match ? match[0].trim() : '';
}

function compactText(text, limit) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function replaceChildren(container) {
  while (container.firstChild) {
    container.firstChild.remove();
  }
}

function render(value) {
  output.textContent = JSON.stringify(value, null, 2);
}
