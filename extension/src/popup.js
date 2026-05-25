const output = document.getElementById('output');
const status = document.getElementById('status');
const patternList = document.getElementById('patternList');
const candidateList = document.getElementById('candidateList');
const suggestionList = document.getElementById('suggestionList');

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
bindContextCapture();
document.addEventListener('click', handleWorkflowClick);

refreshStatus();
refreshWorkflow();

function bind(id, message) {
  document.getElementById(id).addEventListener('click', async () => {
    await sendAndRender(message);
  });
}

function bindPageSummary() {
  document.getElementById('summary').addEventListener('click', async () => {
    try {
      render({ ok: true, payload: { status: 'extracting-page-summary' } });
      const firstAttempt = await chrome.runtime.sendMessage({ type: 'pageSummary' });
      if (firstAttempt?.ok) {
        render(firstAttempt);
        await refreshStatus();
        await refreshWorkflow();
        return;
      }
      if (firstAttempt?.payload?.url || firstAttempt?.error === 'Context Capture is disabled') {
        render(firstAttempt);
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
      render({ ok: true, payload: { status: 'requesting-page-permission', origin } });
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        render({ ok: false, error: `Permission denied for ${origin}` });
        return;
      }

      render({ ok: true, payload: { status: 'extracting-page-summary', origin } });
      const response = await chrome.runtime.sendMessage({ type: 'pageSummary' });
      render(response);
      await refreshStatus();
      await refreshWorkflow();
    } catch (error) {
      render({ ok: false, error: error.message });
    }
  });
}

function bindContextCapture() {
  document.getElementById('captureContext').addEventListener('click', async () => {
    try {
      render({ ok: true, payload: { status: 'capturing-context' } });
      const firstAttempt = await chrome.runtime.sendMessage({ type: 'contextCapture' });
      if (firstAttempt?.ok) {
        render(firstAttempt);
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
      render({ ok: true, payload: { status: 'requesting-page-permission', origin } });
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        render(firstAttempt);
        return;
      }

      render({ ok: true, payload: { status: 'capturing-context', origin } });
      const response = await chrome.runtime.sendMessage({ type: 'contextCapture' });
      render(response);
      await refreshStatus();
      await refreshWorkflow();
    } catch (error) {
      render({ ok: false, error: error.message });
    }
  });
}

async function sendAndRender(message) {
  const response = await chrome.runtime.sendMessage(message);
  render(response);
  await refreshStatus();
  await refreshWorkflow();
  return response;
}

async function refreshStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'status' });
  const current = response?.status || {};
  const connected = Boolean(current.connected);
  const online = Boolean(current.online);
  const connecting = Boolean(response?.status?.connecting);
  const paired = current.pairing === 'paired' || Boolean(current.registered);

  if (online && paired) {
    status.textContent = '在线';
  } else if (connecting) {
    status.textContent = '连接中';
  } else if (paired) {
    status.textContent = '已配对，重连中';
  } else if (current.pairing === 'pending') {
    status.textContent = '等待配对';
  } else {
    status.textContent = connected ? '已连接' : '未连接';
  }
  status.dataset.state = online && paired ? 'online' : paired ? 'paired' : connecting ? 'connecting' : 'offline';
}

async function refreshWorkflow() {
  const [patternsResponse, suggestionsResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'patterns' }),
    chrome.runtime.sendMessage({ type: 'suggestions' })
  ]);

  renderPatterns(patternsResponse?.payload || {});
  renderSuggestions(suggestionsResponse?.payload?.suggestions || []);
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
  }
}

function renderPatterns(payload) {
  renderPatternGroup(patternList, payload.patterns || [], {
    emptyText: '暂无已保存 Pattern',
    buttonAction: 'open-pattern',
    buttonText: '打开'
  });
  renderPatternGroup(candidateList, payload.candidates || [], {
    emptyText: `暂无候选，快照数 ${payload.snapshotCount || 0}`,
    buttonAction: 'save-candidate',
    buttonText: '保存'
  });
}

function renderPatternGroup(container, patterns, options) {
  replaceChildren(container);
  if (!patterns.length) {
    container.appendChild(emptyState(options.emptyText));
    return;
  }

  for (const pattern of patterns) {
    const row = document.createElement('article');
    row.className = 'workflow-item';
    row.appendChild(itemText(pattern.name, describePattern(pattern)));
    row.appendChild(actionButton(options.buttonText, options.buttonAction, pattern.id));
    container.appendChild(row);
  }
}

function renderSuggestions(suggestions) {
  replaceChildren(suggestionList);
  if (!suggestions.length) {
    suggestionList.appendChild(emptyState('暂无建议'));
    return;
  }

  for (const suggestion of suggestions) {
    const row = document.createElement('article');
    row.className = 'workflow-item';
    row.appendChild(itemText(suggestion.title, suggestion.message || `${suggestion.urls.length} 个链接`));
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    actions.appendChild(actionButton('接受', 'accept-suggestion', suggestion.id));
    actions.appendChild(actionButton('忽略', 'dismiss-suggestion', suggestion.id));
    row.appendChild(actions);
    suggestionList.appendChild(row);
  }
}

function describePattern(pattern) {
  const origins = [...new Set((pattern.tabs || []).map((tab) => tab.origin).filter(Boolean))];
  const suffix = pattern.cooccurrenceCount ? `，共现 ${pattern.cooccurrenceCount} 次` : '';
  return `${(pattern.tabs || []).length} 个链接：${origins.slice(0, 3).join('、')}${suffix}`;
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

function replaceChildren(container) {
  while (container.firstChild) {
    container.firstChild.remove();
  }
}

function render(value) {
  output.textContent = JSON.stringify(value, null, 2);
}
