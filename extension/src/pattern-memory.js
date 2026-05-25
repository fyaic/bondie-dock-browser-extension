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

  async function captureHourlySnapshot() {
    const settings = await getSettings();
    if (!settings.patternMemoryEnabled) {
      return { ok: false, skipped: true, reason: 'Pattern Memory is disabled' };
    }

    const snapshot = await captureBrowserSnapshot('hourly');
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
        patterns: data[PATTERN_STORAGE_KEYS.patterns] || [],
        candidates: data[PATTERN_STORAGE_KEYS.candidates] || [],
        snapshotCount: (data[PATTERN_STORAGE_KEYS.snapshots] || []).length
      }
    };
  }

  async function openPattern(args = {}) {
    const pattern = await findPattern(args.patternId, args.urls);
    if (!pattern || !pattern.tabs.length) {
      return { ok: false, error: 'Pattern not found or empty' };
    }

    const urls = unique(pattern.tabs.map((tab) => tab.url).filter(Boolean));
    if (!urls.length) {
      return { ok: false, error: 'Pattern has no URLs' };
    }

    const opened = await chromeApi.windows.create({
      url: urls,
      focused: true
    });

    return {
      ok: true,
      payload: {
        patternId: pattern.id,
        name: pattern.name,
        urls,
        windowId: opened?.id,
        openedAt: new Date().toISOString()
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
      ...candidate,
      id: crypto.randomUUID(),
      source: 'candidate',
      savedAt: new Date().toISOString()
    };
    const nextPatterns = limitItems([pattern, ...(data[PATTERN_STORAGE_KEYS.patterns] || [])], settings.patternRetentionLimit);
    const nextCandidates = candidates.filter((item) => item.id !== candidateId);

    await chromeApi.storage.local.set({
      [PATTERN_STORAGE_KEYS.patterns]: nextPatterns,
      [PATTERN_STORAGE_KEYS.candidates]: nextCandidates
    });

    return { ok: true, pattern };
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
        tabs
      };
    }

    const data = await chromeApi.storage.local.get([
      PATTERN_STORAGE_KEYS.patterns,
      PATTERN_STORAGE_KEYS.candidates
    ]);
    return [
      ...(data[PATTERN_STORAGE_KEYS.patterns] || []),
      ...(data[PATTERN_STORAGE_KEYS.candidates] || [])
    ].find((pattern) => pattern.id === patternId);
  }
}

function detectCandidates(snapshots, minCooccurrence) {
  const groups = new Map();

  for (const snapshot of snapshots) {
    for (const window of snapshot.windows || []) {
      const tabs = uniqueTabs(window.tabs || []);
      if (tabs.length < 2) {
        continue;
      }

      const key = tabs.map((tab) => tab.origin).sort().join('|');
      const existing = groups.get(key) || {
        count: 0,
        firstSeenAt: snapshot.capturedAt,
        lastSeenAt: snapshot.capturedAt,
        tabs
      };

      groups.set(key, {
        ...existing,
        count: existing.count + 1,
        lastSeenAt: snapshot.capturedAt,
        tabs: mergeTabs(existing.tabs, tabs)
      });
    }
  }

  return [...groups.values()]
    .filter((group) => group.count >= minCooccurrence)
    .map((group) => ({
      id: `candidate-${stableHash(group.tabs.map((tab) => tab.origin).sort().join('|'))}`,
      name: group.tabs.map((tab) => tab.origin).slice(0, 3).join(' + '),
      source: 'cooccurrence',
      confidence: Math.min(1, group.count / 5),
      cooccurrenceCount: group.count,
      firstSeenAt: group.firstSeenAt,
      lastSeenAt: group.lastSeenAt,
      tabs: group.tabs.slice(0, MAX_PATTERN_TABS)
    }))
    .sort((a, b) => b.cooccurrenceCount - a.cooccurrenceCount || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 12);
}

function createPatternFromWindow(windowSnapshot, name, source) {
  const tabs = uniqueTabs(windowSnapshot.tabs);
  const fallbackName = tabs
    .map((tab) => tab.origin)
    .filter(Boolean)
    .slice(0, 3)
    .join(' + ') || 'Saved browser pattern';

  return {
    id: crypto.randomUUID(),
    name: (name || fallbackName).slice(0, MAX_PATTERN_TITLE_LENGTH),
    source,
    savedAt: new Date().toISOString(),
    tabs
  };
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
