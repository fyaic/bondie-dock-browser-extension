const DEFAULT_PATTERN_SETTINGS = {
  patternMemoryEnabled: true,
  patternUploadEnabled: false,
  patternRetentionLimit: 80,
  patternSnapshotRetentionLimit: 120,
  patternCandidateMinCooccurrence: 2
};

const PATTERN_STORAGE_KEYS = {
  settings: Object.keys(DEFAULT_PATTERN_SETTINGS),
  snapshots: 'browserPatternSnapshots',
  patterns: 'browserPatterns',
  candidates: 'browserPatternCandidates'
};

const SNAPSHOT_ALARM_NAME = 'openclaw-pattern-snapshot';
const SNAPSHOT_ALARM_PERIOD_MINUTES = 60;
const MAX_PATTERN_TABS = 20;
const MAX_PATTERN_TITLE_LENGTH = 120;
const MAX_RELATED_TABS = 8;
const MAX_ANCHOR_SESSION_TABS = 10;
const RECENT_TAB_ACTIVITY_MS = 30 * 60 * 1000;
const MIN_TOPIC_TOKEN_OVERLAP = 2;
const GENERIC_ORIGINS = new Set([
  'https://github.com',
  'https://docs.github.com',
  'https://www.google.com',
  'https://www.google.com.hk',
  'https://docs.google.com',
  'https://linear.app',
  'https://docs.qq.com'
]);
const LOW_SIGNAL_PATH_TOKENS = new Set([
  'auth',
  'login',
  'oauth',
  'session',
  'signin',
  'signup'
]);
const TOKEN_STOP_WORDS = new Set([
  'and',
  'app',
  'blob',
  'chrome',
  'com',
  'docs',
  'edit',
  'for',
  'github',
  'google',
  'html',
  'http',
  'https',
  'login',
  'main',
  'net',
  'org',
  'page',
  'profile',
  'search',
  'settings',
  'signin',
  'sign',
  'sourceid',
  'tab',
  'the',
  'tree',
  'www'
]);

export {
  DEFAULT_PATTERN_SETTINGS,
  PATTERN_STORAGE_KEYS,
  SNAPSHOT_ALARM_NAME,
  SNAPSHOT_ALARM_PERIOD_MINUTES,
  createPatternMemory
};

function createPatternMemory(chromeApi) {
  return {
    ensureDefaults,
    ensureSnapshotAlarm,
    captureHourlySnapshot,
    saveCurrentWindowPattern,
    listPatterns,
    openPattern,
    saveCandidate,
    findRelatedForActiveTab,
    recordFeedback,
    clearLocalData
  };

  async function ensureDefaults() {
    const stored = await chromeApi.storage.local.get(PATTERN_STORAGE_KEYS.settings);
    await chromeApi.storage.local.set({ ...DEFAULT_PATTERN_SETTINGS, ...stored });
  }

  async function ensureSnapshotAlarm() {
    const existing = await chromeApi.alarms.get(SNAPSHOT_ALARM_NAME);
    if (existing) {
      return;
    }
    await chromeApi.alarms.create(SNAPSHOT_ALARM_NAME, {
      delayInMinutes: SNAPSHOT_ALARM_PERIOD_MINUTES,
      periodInMinutes: SNAPSHOT_ALARM_PERIOD_MINUTES
    });
  }

  async function captureHourlySnapshot(source = 'scheduled') {
    const settings = await getSettings();
    if (!settings.patternMemoryEnabled) {
      return { ok: false, skipped: true, reason: 'Pattern Memory is disabled' };
    }

    const snapshot = await captureBrowserSnapshot(source);
    if (!snapshot.windows.length) {
      return { ok: false, skipped: true, reason: 'No web tabs found' };
    }

    const snapshots = await appendLimited(PATTERN_STORAGE_KEYS.snapshots, snapshot, settings.patternSnapshotRetentionLimit);
    const candidates = detectCandidates(snapshots, settings.patternCandidateMinCooccurrence);
    await chromeApi.storage.local.set({ [PATTERN_STORAGE_KEYS.candidates]: candidates });

    return {
      ok: true,
      snapshot,
      candidates,
      summary: summarizeSnapshot(snapshot)
    };
  }

  async function saveCurrentWindowPattern(name) {
    const settings = await getSettings();
    if (!settings.patternMemoryEnabled) {
      return { ok: false, error: 'Pattern Memory is disabled' };
    }

    const windowSnapshot = await captureCurrentWindow();
    if (!windowSnapshot.tabs.length) {
      return { ok: false, error: 'No active web tabs to save' };
    }

    const pattern = createPatternFromWindow(windowSnapshot, name, 'manual');
    await appendLimited(PATTERN_STORAGE_KEYS.patterns, pattern, settings.patternRetentionLimit);

    return { ok: true, pattern };
  }

  async function listPatterns() {
    const data = await chromeApi.storage.local.get([
      PATTERN_STORAGE_KEYS.patterns,
      PATTERN_STORAGE_KEYS.candidates,
      PATTERN_STORAGE_KEYS.snapshots
    ]);

    return {
      ok: true,
      payload: {
        patterns: (data[PATTERN_STORAGE_KEYS.patterns] || []).map(normalizePatternRecord),
        candidates: (data[PATTERN_STORAGE_KEYS.candidates] || []).map(normalizePatternRecord),
        snapshotCount: (data[PATTERN_STORAGE_KEYS.snapshots] || []).length
      }
    };
  }

  async function openPattern(args = {}) {
    const pattern = await findPattern(args.patternId, args.urls);
    if (!pattern || !pattern.tabs.length) {
      return { ok: false, error: 'Pattern not found or empty' };
    }

    const urls = unique(getPatternTabs(pattern).map((tab) => tab.url).filter(Boolean));
    if (!urls.length) {
      return { ok: false, error: 'Pattern has no URLs' };
    }

    const opened = await chromeApi.windows.create({
      url: urls,
      focused: true
    });

    const openedAt = new Date().toISOString();
    await markPatternOpened(pattern.id, openedAt);

    return {
      ok: true,
      payload: {
        patternId: pattern.id,
        name: pattern.name,
        urls,
        windowId: opened?.id,
        openedAt
      }
    };
  }

  async function saveCandidate(candidateId) {
    const data = await chromeApi.storage.local.get([
      PATTERN_STORAGE_KEYS.candidates,
      PATTERN_STORAGE_KEYS.patterns
    ]);
    const candidates = data[PATTERN_STORAGE_KEYS.candidates] || [];
    const candidate = candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return { ok: false, error: 'Candidate not found' };
    }

    const settings = await getSettings();
    const pattern = {
      ...normalizePatternRecord(candidate),
      id: crypto.randomUUID(),
      source: 'candidate',
      savedAt: new Date().toISOString(),
      useCount: 0,
      lastOpenedAt: ''
    };
    const nextPatterns = limitItems([pattern, ...(data[PATTERN_STORAGE_KEYS.patterns] || [])], settings.patternRetentionLimit);
    const nextCandidates = candidates.filter((item) => item.id !== candidateId);

    await chromeApi.storage.local.set({
      [PATTERN_STORAGE_KEYS.patterns]: nextPatterns,
      [PATTERN_STORAGE_KEYS.candidates]: nextCandidates
    });

    return { ok: true, pattern };
  }

  async function findRelatedForActiveTab() {
    const settings = await getSettings();
    if (!settings.patternMemoryEnabled) {
      return { ok: false, skipped: true, reason: 'Pattern Memory is disabled' };
    }

    const activeTab = await getActiveWebTab();
    if (!activeTab) {
      return { ok: false, skipped: true, reason: 'No active web tab' };
    }

    const data = await chromeApi.storage.local.get([
      PATTERN_STORAGE_KEYS.patterns,
      PATTERN_STORAGE_KEYS.candidates
    ]);
    const patterns = (data[PATTERN_STORAGE_KEYS.patterns] || []).map(normalizePatternRecord);
    const candidates = (data[PATTERN_STORAGE_KEYS.candidates] || []).map(normalizePatternRecord);
    const match = chooseRelatedPattern(activeTab, patterns, candidates);

    return {
      ok: true,
      payload: {
        activeTab: sanitizeTab(activeTab, new Date().toISOString()),
        match
      }
    };
  }

  async function clearLocalData() {
    await chromeApi.storage.local.set({
      [PATTERN_STORAGE_KEYS.snapshots]: [],
      [PATTERN_STORAGE_KEYS.patterns]: [],
      [PATTERN_STORAGE_KEYS.candidates]: []
    });
    return { ok: true };
  }

  async function getSettings() {
    const stored = await chromeApi.storage.local.get(PATTERN_STORAGE_KEYS.settings);
    return normalizeSettings({ ...DEFAULT_PATTERN_SETTINGS, ...stored });
  }

  async function captureBrowserSnapshot(source) {
    const windows = await chromeApi.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const capturedAt = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      source,
      capturedAt,
      windows: windows
        .map((window) => sanitizeWindow(window, capturedAt))
        .filter((window) => window.tabs.length)
    };
  }

  async function captureCurrentWindow() {
    const capturedAt = new Date().toISOString();
    const activeTabs = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
    const activeWebTab = activeTabs.find(isWebTab);
    if (activeWebTab?.windowId) {
      const window = await chromeApi.windows.get(activeWebTab.windowId, { populate: true });
      return sanitizeWindow(window, capturedAt);
    }

    const windows = await chromeApi.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const fallback = windows.find((window) => (window.tabs || []).some(isWebTab)) || { id: null, tabs: [] };
    return sanitizeWindow(fallback, capturedAt);
  }

  function sanitizeWindow(window, capturedAt) {
    return {
      windowId: window.id,
      focused: Boolean(window.focused),
      tabs: (window.tabs || [])
        .filter(isWebTab)
        .slice(0, MAX_PATTERN_TABS)
        .map((tab) => sanitizeTab(tab, capturedAt))
    };
  }

  function sanitizeTab(tab, capturedAt) {
    const url = tab.url || '';
    return {
      url,
      origin: new URL(url).origin,
      title: (tab.title || '').slice(0, MAX_PATTERN_TITLE_LENGTH),
      windowId: tab.windowId,
      tabId: tab.id,
      active: Boolean(tab.active),
      pinned: Boolean(tab.pinned),
      lastAccessed: Number(tab.lastAccessed || 0),
      timestamp: capturedAt
    };
  }

  function isWebTab(tab) {
    return typeof tab.url === 'string' &&
      (tab.url.startsWith('http://') || tab.url.startsWith('https://'));
  }

  async function appendLimited(key, item, limit) {
    const data = await chromeApi.storage.local.get([key]);
    const next = limitItems([item, ...(data[key] || [])], limit);
    await chromeApi.storage.local.set({ [key]: next });
    return next;
  }

  async function findPattern(patternId, urls) {
    if (Array.isArray(urls) && urls.length) {
      const tabs = urls.filter(isWebUrl).map((url) => ({
        url,
        origin: new URL(url).origin,
        title: '',
        windowId: null,
        tabId: null,
        active: false,
        pinned: false,
        timestamp: new Date().toISOString()
      }));
      return {
        id: patternId || crypto.randomUUID(),
        name: 'OpenClaw suggestion',
        source: 'ad-hoc',
        tabs,
        urls: tabs.map((tab) => tab.url),
        origins: unique(tabs.map((tab) => tab.origin))
      };
    }

    const data = await chromeApi.storage.local.get([
      PATTERN_STORAGE_KEYS.patterns,
      PATTERN_STORAGE_KEYS.candidates
    ]);
    const found = [
      ...(data[PATTERN_STORAGE_KEYS.patterns] || []),
      ...(data[PATTERN_STORAGE_KEYS.candidates] || [])
    ].find((pattern) => pattern.id === patternId);
    return found ? normalizePatternRecord(found) : found;
  }

  async function markPatternOpened(patternId, openedAt) {
    if (!patternId) {
      return;
    }

    await updatePatternRecords(patternId, (pattern) => ({
      ...normalizePatternRecord(pattern),
      useCount: Number(pattern.useCount || 0) + 1,
      lastOpenedAt: openedAt
    }));
  }

  async function recordFeedback(patternId, action) {
    if (!patternId || (action !== 'accepted' && action !== 'dismissed')) {
      return { ok: false, error: 'Unknown pattern feedback' };
    }

    const feedbackAt = new Date().toISOString();
    const changed = await updatePatternRecords(patternId, (pattern) => {
      const normalized = normalizePatternRecord(pattern);
      if (action === 'accepted') {
        return {
          ...normalized,
          acceptedCount: Number(normalized.acceptedCount || 0) + 1,
          lastAcceptedAt: feedbackAt
        };
      }

      return {
        ...normalized,
        dismissCount: Number(normalized.dismissCount || 0) + 1,
        lastDismissedAt: feedbackAt
      };
    });

    return { ok: changed };
  }

  async function updatePatternRecords(patternId, updater) {
    const data = await chromeApi.storage.local.get([
      PATTERN_STORAGE_KEYS.patterns,
      PATTERN_STORAGE_KEYS.candidates
    ]);
    const nextData = {};
    let changed = false;

    for (const key of [PATTERN_STORAGE_KEYS.patterns, PATTERN_STORAGE_KEYS.candidates]) {
      const records = data[key] || [];
      let keyChanged = false;
      const nextRecords = records.map((pattern) => {
        if (pattern.id !== patternId) {
          return pattern;
        }
        keyChanged = true;
        changed = true;
        return updater(pattern);
      });
      if (keyChanged) {
        nextData[key] = nextRecords;
      }
    }

    if (changed) {
      await chromeApi.storage.local.set(nextData);
    }
    return changed;
  }

  async function getActiveWebTab() {
    const focused = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
    const direct = focused.find(isWebTab);
    if (direct) {
      return direct;
    }

    const candidates = await chromeApi.tabs.query({});
    return candidates
      .filter(isWebTab)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

}

function detectCandidates(snapshots, minCooccurrence) {
  const groups = new Map();

  const orderedSnapshots = [...snapshots].sort((left, right) =>
    String(left.capturedAt || '').localeCompare(String(right.capturedAt || ''))
  );

  for (const snapshot of orderedSnapshots) {
    for (const window of snapshot.windows || []) {
      const tabs = uniqueTabs(window.tabs || []);
      const signalTabs = tabs.filter((tab) => !isLowSignalTab(tab));
      if (signalTabs.length < 2) {
        continue;
      }

      const sessionTabs = activeScopedTabs(signalTabs, snapshot.capturedAt);
      if (sessionTabs.length < 2) {
        continue;
      }

      const key = sessionTabs.map((tab) => tab.origin).sort().join('|');
      const existing = groups.get(key) || {
        count: 0,
        firstSeenAt: snapshot.capturedAt,
        lastSeenAt: snapshot.capturedAt,
        tabs: sessionTabs
      };

      groups.set(key, {
        ...existing,
        count: existing.count + 1,
        lastSeenAt: snapshot.capturedAt,
        tabs: mergeTabs(existing.tabs, sessionTabs)
      });
    }
  }

  return [...groups.values()]
    .filter((group) => group.count >= minCooccurrence)
    .map((group) => ({
      id: `candidate-${stableHash(group.tabs.map((tab) => tab.origin).sort().join('|'))}`,
      name: patternNameFromTabs(group.tabs),
      source: 'cooccurrence',
      confidence: Math.min(1, group.count / 5),
      cooccurrenceCount: group.count,
      firstSeenAt: group.firstSeenAt,
      lastSeenAt: group.lastSeenAt,
      tabs: group.tabs.slice(0, MAX_PATTERN_TABS),
      urls: group.tabs.map((tab) => tab.url).filter(Boolean),
      origins: unique(group.tabs.map((tab) => tab.origin)),
      useCount: 0,
      acceptedCount: 0,
      dismissCount: 0,
      lastOpenedAt: ''
    }))
    .sort((a, b) => b.cooccurrenceCount - a.cooccurrenceCount || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 12);
}

function activeScopedTabs(tabs, capturedAt) {
  const anchor = tabs.find((tab) => tab.active) ||
    [...tabs].sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  if (!anchor) {
    return [];
  }

  const capturedMs = Date.parse(capturedAt || '');
  const anchorTokens = tokenizeTab(anchor);
  return tabs
    .filter((tab) => {
      if (tab.url === anchor.url || tab.active) {
        return true;
      }
      if (isRecentlyAccessed(tab, capturedMs)) {
        return true;
      }
      if (tab.pinned) {
        return false;
      }
      return sharedTokenCount(anchorTokens, tokenizeTab(tab)) >= MIN_TOPIC_TOKEN_OVERLAP;
    })
    .sort((left, right) => activeScopeRank(right, anchor, anchorTokens, capturedMs) -
      activeScopeRank(left, anchor, anchorTokens, capturedMs))
    .slice(0, MAX_ANCHOR_SESSION_TABS);
}

function activeScopeRank(tab, anchor, anchorTokens, capturedMs) {
  return (tab.url === anchor.url ? 5 : 0) +
    (tab.active ? 4 : 0) +
    (isRecentlyAccessed(tab, capturedMs) ? 2 : 0) +
    Math.min(3, sharedTokenCount(anchorTokens, tokenizeTab(tab))) -
    (tab.pinned ? 1 : 0);
}

function isRecentlyAccessed(tab, capturedMs) {
  const lastAccessed = Number(tab.lastAccessed || 0);
  if (!lastAccessed || !Number.isFinite(capturedMs)) {
    return false;
  }
  const ageMs = capturedMs - lastAccessed;
  return ageMs >= 0 && ageMs <= RECENT_TAB_ACTIVITY_MS;
}

function createPatternFromWindow(windowSnapshot, name, source) {
  const tabs = uniqueTabs(windowSnapshot.tabs);
  const fallbackName = patternNameFromTabs(tabs) || 'Saved browser pattern';

  return {
    id: crypto.randomUUID(),
    name: (name || fallbackName).slice(0, MAX_PATTERN_TITLE_LENGTH),
    source,
    savedAt: new Date().toISOString(),
    tabs,
    urls: tabs.map((tab) => tab.url).filter(Boolean),
    origins: unique(tabs.map((tab) => tab.origin)),
    useCount: 0,
    lastOpenedAt: ''
  };
}

function matchReason(args) {
  if (args.exactUrlMatch) {
    return '当前页曾出现在这个工作流里';
  }
  if (args.topicMatch) {
    return `标题或 URL 共享 ${args.bestTokenOverlap} 个关键词`;
  }
  if (args.originOnlyMatch) {
    return '当前页命中已保存工作流的同一站点';
  }
  if (args.acceptedCount > 0) {
    return `你之前接受过 ${args.acceptedCount} 次类似推荐`;
  }
  if (args.useCount > 0) {
    return `这个工作流已被打开 ${args.useCount} 次`;
  }
  if (args.cooccurrenceCount > 0) {
    return `相关页面共同出现 ${args.cooccurrenceCount} 次`;
  }
  return 'Pattern Memory 识别到页面关联';
}

function chooseRelatedPattern(activeTab, savedPatterns, candidatePatterns) {
  const active = normalizeTabRecord(activeTab);
  const candidates = [
    ...savedPatterns.map((pattern) => ({ pattern, group: 'saved' })),
    ...candidatePatterns.map((pattern) => ({ pattern, group: 'candidate' }))
  ];

  const scored = candidates
    .map(({ pattern, group }) => scorePatternMatch(pattern, group, active))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.relatedTabs.length - a.relatedTabs.length);

  return scored[0] || null;
}

function scorePatternMatch(pattern, group, activeTab) {
  const activeUrl = activeTab.url || '';
  const activeOrigin = activeTab.origin || new URL(activeUrl).origin;
  if (isLowSignalTab(activeTab)) {
    return null;
  }

  const tabs = getPatternTabs(pattern);
  const exactUrlMatch = tabs.some((tab) => tab.url === activeUrl);
  const originMatch = tabs.some((tab) => tab.origin === activeOrigin);
  const activeTokens = tokenizeTab(activeTab);
  const bestTokenOverlap = Math.max(0, ...tabs.map((tab) => sharedTokenCount(activeTokens, tokenizeTab(tab))));
  const topicMatch = bestTokenOverlap >= MIN_TOPIC_TOKEN_OVERLAP;
  const originOnlyMatch = originMatch && !isGenericOrigin(activeOrigin) && !isCandidatePattern(group);

  if (!exactUrlMatch && !topicMatch && !originOnlyMatch) {
    return null;
  }

  const relatedTabs = rankRelatedTabs(tabs, activeTokens, activeOrigin)
    .filter((tab) => tab.url && tab.url !== activeUrl && !isLowSignalTab(tab))
    .slice(0, MAX_RELATED_TABS);
  if (!relatedTabs.length) {
    return null;
  }

  const acceptedCount = Number(pattern.acceptedCount || 0);
  const dismissCount = Number(pattern.dismissCount || 0);
  if (dismissCount >= 3 && acceptedCount === 0 && Number(pattern.useCount || 0) === 0) {
    return null;
  }

  const baseConfidence = Math.max(
    Number(pattern.confidence || 0),
    exactUrlMatch ? 0.9 : topicMatch ? 0.72 : 0.55,
    Math.min(1, Number(pattern.cooccurrenceCount || 0) / 5)
  );
  const feedbackBoost = Math.min(0.12, acceptedCount * 0.04);
  const dismissalPenalty = Math.min(0.45, dismissCount * 0.15);
  const confidence = clampUnit(baseConfidence + feedbackBoost - dismissalPenalty);
  const score = (group === 'saved' ? 3 : 1) +
    (exactUrlMatch ? 2 : topicMatch ? 1.4 : 0.6) +
    confidence +
    Math.min(1.5, bestTokenOverlap / 2) +
    Math.min(2, Number(pattern.useCount || 0) / 3) +
    Math.min(1, relatedTabs.length / 4) +
    Math.min(1.2, acceptedCount / 2) -
    Math.min(2.5, dismissCount);

  return {
    id: `pattern-memory:${pattern.id}`,
    patternId: pattern.id,
    name: pattern.name,
    source: group === 'saved' ? pattern.source || 'manual' : 'cooccurrence',
    kind: group === 'saved' ? 'saved-pattern' : 'candidate-pattern',
    confidence,
    matchedBy: exactUrlMatch ? 'url' : topicMatch ? 'topic' : 'origin',
    activeUrl,
    activeOrigin,
    relatedTabs,
    urls: relatedTabs.map((tab) => tab.url),
    origins: unique(relatedTabs.map((tab) => tab.origin)),
    reason: matchReason({
      exactUrlMatch,
      topicMatch,
      originOnlyMatch,
      bestTokenOverlap,
      cooccurrenceCount: Number(pattern.cooccurrenceCount || 0),
      useCount: Number(pattern.useCount || 0),
      acceptedCount
    }),
    evidence: {
      tokenOverlap: bestTokenOverlap,
      cooccurrenceCount: Number(pattern.cooccurrenceCount || 0),
      useCount: Number(pattern.useCount || 0),
      acceptedCount,
      dismissCount
    },
    score
  };
}

function normalizePatternRecord(pattern) {
  const rawTabs = getPatternTabs(pattern);
  const signalTabs = rawTabs.filter((tab) => !isLowSignalTab(tab));
  const tabs = signalTabs.length >= 2 ? signalTabs : rawTabs;
  const normalizedName = shouldRegeneratePatternName(pattern.name)
    ? patternNameFromTabs(tabs) || pattern.name
    : pattern.name;
  return {
    ...pattern,
    name: normalizedName,
    tabs,
    urls: unique([
      ...(Array.isArray(pattern.urls) ? pattern.urls : []),
      ...tabs.map((tab) => tab.url)
    ].filter(isWebUrl)).filter((url) => tabs.some((tab) => tab.url === url)),
    origins: unique([
      ...(Array.isArray(pattern.origins) ? pattern.origins : []),
      ...tabs.map((tab) => tab.origin)
    ].filter(Boolean)).filter((origin) => tabs.some((tab) => tab.origin === origin)),
    useCount: Number(pattern.useCount || 0),
    acceptedCount: Number(pattern.acceptedCount || 0),
    dismissCount: Number(pattern.dismissCount || 0),
    lastAcceptedAt: pattern.lastAcceptedAt || '',
    lastDismissedAt: pattern.lastDismissedAt || '',
    lastOpenedAt: pattern.lastOpenedAt || ''
  };
}

function getPatternTabs(pattern) {
  if (Array.isArray(pattern?.tabs)) {
    return uniqueTabs(pattern.tabs.filter((tab) => tab?.url && isWebUrl(tab.url)).map(normalizeTabRecord));
  }
  if (Array.isArray(pattern?.urls)) {
    return uniqueTabs(pattern.urls.filter(isWebUrl).map((url) => normalizeTabRecord({ url })));
  }
  return [];
}

function normalizeTabRecord(tab) {
  const url = tab.url || '';
  return {
    url,
    origin: tab.origin || new URL(url).origin,
    title: (tab.title || '').slice(0, MAX_PATTERN_TITLE_LENGTH),
    windowId: tab.windowId || null,
    tabId: tab.tabId || tab.id || null,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    lastAccessed: Number(tab.lastAccessed || 0),
    timestamp: tab.timestamp || ''
  };
}

function rankRelatedTabs(tabs, activeTokens, activeOrigin) {
  return [...tabs].sort((left, right) =>
    relatedTabScore(right, activeTokens, activeOrigin) - relatedTabScore(left, activeTokens, activeOrigin)
  );
}

function relatedTabScore(tab, activeTokens, activeOrigin) {
  return (tab.origin === activeOrigin ? 2 : 0) +
    Math.min(3, sharedTokenCount(activeTokens, tokenizeTab(tab))) +
    (tab.active ? 0.2 : 0);
}

function tokenizeTab(tab) {
  const raw = `${safeDecode(tab.url || '')} ${tab.title || ''}`.toLowerCase();
  const tokens = raw.match(/[\p{L}\p{N}]+/gu) || [];
  return new Set(tokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token)));
}

function sharedTokenCount(left, right) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isCandidatePattern(group) {
  return group === 'candidate';
}

function isGenericOrigin(origin) {
  return GENERIC_ORIGINS.has(origin);
}

function isLowSignalTab(tab) {
  try {
    const url = new URL(tab.url || '');
    if (url.hostname === 'example.com') {
      return true;
    }
    if (/^www\.google\./.test(url.hostname) && url.pathname === '/search') {
      return true;
    }
    const pathTokens = url.pathname.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (pathTokens.some((token) => LOW_SIGNAL_PATH_TOKENS.has(token))) {
      return true;
    }
  } catch {
    return false;
  }

  return /\bsign\s*in\b|\blog\s*in\b|\bpage\s+not\s+found\b/i.test(tab.title || '');
}

function patternNameFromTabs(tabs) {
  const titleParts = unique(tabs
    .map((tab) => cleanPatternTitle(tab.title))
    .filter(Boolean));
  if (titleParts.length) {
    return titleParts.slice(0, 3).join(' + ').slice(0, MAX_PATTERN_TITLE_LENGTH);
  }
  return tabs
    .map((tab) => tab.origin)
    .filter(Boolean)
    .slice(0, 3)
    .join(' + ')
    .slice(0, MAX_PATTERN_TITLE_LENGTH);
}

function cleanPatternTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+闲置标签页\s+-\s+已释放.*$/u, '')
    .replace(/\s+-\s+Google\s+搜索$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PATTERN_TITLE_LENGTH);
}

function shouldRegeneratePatternName(name) {
  const value = String(name || '');
  return !value || value.includes('://') || value.split(' + ').every((part) => part.includes('.'));
}

function summarizeSnapshot(snapshot) {
  const tabs = snapshot.windows.flatMap((window) => window.tabs || []);
  return {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    windowCount: snapshot.windows.length,
    tabCount: tabs.length,
    origins: unique(tabs.map((tab) => tab.origin)).slice(0, 20)
  };
}

function normalizeSettings(settings) {
  return {
    ...settings,
    patternMemoryEnabled: Boolean(settings.patternMemoryEnabled),
    patternUploadEnabled: Boolean(settings.patternUploadEnabled),
    patternRetentionLimit: clampNumber(settings.patternRetentionLimit, 10, 300, DEFAULT_PATTERN_SETTINGS.patternRetentionLimit),
    patternSnapshotRetentionLimit: clampNumber(settings.patternSnapshotRetentionLimit, 10, 500, DEFAULT_PATTERN_SETTINGS.patternSnapshotRetentionLimit),
    patternCandidateMinCooccurrence: clampNumber(
      settings.patternCandidateMinCooccurrence,
      2,
      10,
      DEFAULT_PATTERN_SETTINGS.patternCandidateMinCooccurrence
    )
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

function limitItems(items, limit) {
  return items.slice(0, Math.max(1, Number(limit) || 1));
}

function uniqueTabs(tabs) {
  const seen = new Set();
  const result = [];
  for (const tab of tabs) {
    if (!tab.url || seen.has(tab.url)) {
      continue;
    }
    seen.add(tab.url);
    result.push(tab);
  }
  return result;
}

function mergeTabs(left, right) {
  const byUrl = new Map();
  for (const tab of [...left, ...right]) {
    byUrl.set(tab.url, tab);
  }
  return [...byUrl.values()];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isWebUrl(url) {
  return typeof url === 'string' &&
    (url.startsWith('http://') || url.startsWith('https://'));
}

function stableHash(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
