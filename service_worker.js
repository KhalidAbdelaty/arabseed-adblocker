/*
 * Privacy Shield - service worker
 *
 * Central coordinator: maintains user settings in chrome.storage.local,
 * keeps declarativeNetRequest rules in sync with those settings, listens
 * for rule matches to update local-only statistics, and serves popup /
 * options / content-script messages.
 *
 * No network calls are made from this file. No remote code is loaded.
 */

const STORAGE_KEY = "privacyShieldSettings";
const STATS_KEY = "privacyShieldStats";
const DECEPTION_DIAGNOSTICS_KEY = "privacyShieldDeceptionDiagnostics";
const STATIC_RULESET_NORMAL = "static_rules";
const STATIC_RULESET_STRICT = "strict_rules";

// Dynamic rule ID space; keep ranges disjoint from any static rule IDs.
const ALLOWLIST_ID_START = 100000;
const ALLOWLIST_ID_END = 199999;
const CUSTOM_ID_START = 200000;
const CUSTOM_ID_END = 299999;

// Static rule ID ranges -> categories (must match bundled rules/*.json).
const STATIC_CATEGORIES = [
  { min: 1, max: 999, key: "ads" },
  { min: 1000, max: 1999, key: "trackers" },
  { min: 2000, max: 3999, key: "scripts" },
  { min: 4000, max: 4999, key: "popups" },
  { min: 5000, max: 5999, key: "strict" }
];

const DEFAULT_SETTINGS = {
  enabled: true,
  strictMode: false,
  allowlist: [],
  customRules: []
};

const DEFAULT_STATS = {
  total: 0,
  byCategory: { ads: 0, trackers: 0, scripts: 0, popups: 0, strict: 0, custom: 0 }
};

const DEFAULT_DECEPTION_DIAGNOSTICS = {
  detectorHits: {},
  patchReapplyEvents: 0,
  strictRuleHints: {},
  recentEvents: [],
  lastUpdated: null
};

const STRICT_COLLISION_RULE_IDS = new Set([5010, 5011, 5012]);
const MAX_DECEPTION_RECENT_EVENTS = 40;

const MAX_ALLOWLIST = ALLOWLIST_ID_END - ALLOWLIST_ID_START + 1;
const MAX_CUSTOM_RULES = CUSTOM_ID_END - CUSTOM_ID_START + 1;

// Per-tab in-memory counter; reset when a tab navigates to a new top-level URL.
const perTabBlocked = new Map();

// Throttle persistence of stats to avoid excessive writes.
let pendingStatsFlush = false;
let pendingStats = null;

/* ---------------------------------------------------------------- *
 * Storage helpers                                                  *
 * ---------------------------------------------------------------- */

async function getSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
      strictMode: typeof raw.strictMode === "boolean" ? raw.strictMode : DEFAULT_SETTINGS.strictMode,
      allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.filter(isValidDomain) : [],
      customRules: Array.isArray(raw.customRules)
        ? raw.customRules.filter(isValidCustomRule).slice(0, MAX_CUSTOM_RULES)
        : []
    };
  } catch (err) {
    console.warn("[PrivacyShield] getSettings failed", err);
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(next) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return true;
  } catch (err) {
    console.warn("[PrivacyShield] saveSettings failed", err);
    return false;
  }
}

async function getStats() {
  try {
    const result = await chrome.storage.local.get(STATS_KEY);
    const raw = result[STATS_KEY];
    if (!raw || typeof raw !== "object") return { ...DEFAULT_STATS };
    return {
      total: Number.isFinite(raw.total) ? raw.total : 0,
      byCategory: { ...DEFAULT_STATS.byCategory, ...(raw.byCategory || {}) }
    };
  } catch (err) {
    console.warn("[PrivacyShield] getStats failed", err);
    return { ...DEFAULT_STATS };
  }
}

async function saveStats(stats) {
  try {
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  } catch (err) {
    console.warn("[PrivacyShield] saveStats failed", err);
  }
}

async function getDeceptionDiagnostics() {
  try {
    const result = await chrome.storage.local.get(DECEPTION_DIAGNOSTICS_KEY);
    const raw = result[DECEPTION_DIAGNOSTICS_KEY];
    if (!raw || typeof raw !== "object") return cloneDeceptionDiagnostics();
    return {
      detectorHits:
        raw.detectorHits && typeof raw.detectorHits === "object" ? raw.detectorHits : {},
      patchReapplyEvents: Number.isFinite(raw.patchReapplyEvents)
        ? raw.patchReapplyEvents
        : 0,
      strictRuleHints:
        raw.strictRuleHints && typeof raw.strictRuleHints === "object" ? raw.strictRuleHints : {},
      recentEvents: Array.isArray(raw.recentEvents)
        ? raw.recentEvents.slice(-MAX_DECEPTION_RECENT_EVENTS)
        : [],
      lastUpdated: typeof raw.lastUpdated === "string" ? raw.lastUpdated : null
    };
  } catch (err) {
    console.warn("[PrivacyShield] getDeceptionDiagnostics failed", err);
    return cloneDeceptionDiagnostics();
  }
}

async function saveDeceptionDiagnostics(diagnostics) {
  try {
    await chrome.storage.local.set({ [DECEPTION_DIAGNOSTICS_KEY]: diagnostics });
  } catch (err) {
    console.warn("[PrivacyShield] saveDeceptionDiagnostics failed", err);
  }
}

function cloneDeceptionDiagnostics() {
  return {
    detectorHits: {},
    patchReapplyEvents: 0,
    strictRuleHints: {},
    recentEvents: [],
    lastUpdated: null
  };
}

function bumpRecord(object, key) {
  if (!key) return;
  object[key] = (object[key] || 0) + 1;
}

/* ---------------------------------------------------------------- *
 * Validation                                                       *
 * ---------------------------------------------------------------- */

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function isValidDomain(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 253) return false;
  return DOMAIN_REGEX.test(trimmed);
}

function isValidUrlFilter(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 500) return false;
  // Disallow whitespace and characters DNR would reject outright.
  if (/\s/.test(trimmed)) return false;
  return true;
}

function isValidCustomRule(rule) {
  if (!rule || typeof rule !== "object") return false;
  if (rule.type === "domain") return isValidDomain(rule.value);
  if (rule.type === "urlFilter") return isValidUrlFilter(rule.value);
  return false;
}

function normalizeDomain(value) {
  return String(value).trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/* ---------------------------------------------------------------- *
 * Rule generation                                                  *
 * ---------------------------------------------------------------- */

function buildAllowlistRules(allowlist) {
  // allowAllRequests with priority 1000 wins over block rules (priority 1-2).
  return allowlist.slice(0, MAX_ALLOWLIST).map((domain, index) => ({
    id: ALLOWLIST_ID_START + index,
    priority: 1000,
    action: { type: "allowAllRequests" },
    condition: {
      requestDomains: [normalizeDomain(domain)],
      resourceTypes: ["main_frame", "sub_frame"]
    }
  }));
}

function buildCustomRules(customRules) {
  return customRules.slice(0, MAX_CUSTOM_RULES).map((rule, index) => {
    const id = CUSTOM_ID_START + index;
    if (rule.type === "domain") {
      return {
        id,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: [normalizeDomain(rule.value)],
          resourceTypes: [
            "script",
            "image",
            "xmlhttprequest",
            "sub_frame",
            "ping",
            "object",
            "media",
            "font",
            "stylesheet",
            "websocket"
          ]
        }
      };
    }
    return {
      id,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: rule.value.trim(),
        resourceTypes: [
          "script",
          "image",
          "xmlhttprequest",
          "sub_frame",
          "ping",
          "object",
          "media",
          "font",
          "stylesheet",
          "websocket"
        ]
      }
    };
  });
}

/* ---------------------------------------------------------------- *
 * Apply settings to DNR                                            *
 * ---------------------------------------------------------------- */

async function applyEnabledRulesets(settings) {
  try {
    const enableNormal = settings.enabled;
    const enableStrict = settings.enabled && settings.strictMode;

    const enabledIds = await chrome.declarativeNetRequest.getEnabledRulesets();
    const wantEnable = [];
    const wantDisable = [];

    if (enableNormal && !enabledIds.includes(STATIC_RULESET_NORMAL)) {
      wantEnable.push(STATIC_RULESET_NORMAL);
    }
    if (!enableNormal && enabledIds.includes(STATIC_RULESET_NORMAL)) {
      wantDisable.push(STATIC_RULESET_NORMAL);
    }
    if (enableStrict && !enabledIds.includes(STATIC_RULESET_STRICT)) {
      wantEnable.push(STATIC_RULESET_STRICT);
    }
    if (!enableStrict && enabledIds.includes(STATIC_RULESET_STRICT)) {
      wantDisable.push(STATIC_RULESET_STRICT);
    }

    if (wantEnable.length === 0 && wantDisable.length === 0) return true;

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: wantEnable,
      disableRulesetIds: wantDisable
    });
    return true;
  } catch (err) {
    console.warn("[PrivacyShield] applyEnabledRulesets failed", err);
    return false;
  }
}

async function syncDynamicRules(settings) {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.map((rule) => rule.id);

    let addRules = [];
    if (settings.enabled) {
      addRules = [
        ...buildAllowlistRules(settings.allowlist),
        ...buildCustomRules(settings.customRules)
      ];
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules
    });
    return { ok: true, count: addRules.length };
  } catch (err) {
    console.warn("[PrivacyShield] syncDynamicRules failed", err);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function applyAllSettings(settings) {
  const a = await applyEnabledRulesets(settings);
  const b = await syncDynamicRules(settings);
  return a && b.ok;
}

/* ---------------------------------------------------------------- *
 * Stats handling                                                   *
 * ---------------------------------------------------------------- */

function categoryForRuleId(ruleId, rulesetId) {
  if (rulesetId === STATIC_RULESET_NORMAL || rulesetId === STATIC_RULESET_STRICT) {
    for (const range of STATIC_CATEGORIES) {
      if (ruleId >= range.min && ruleId <= range.max) return range.key;
    }
  }
  if (ruleId >= CUSTOM_ID_START && ruleId <= CUSTOM_ID_END) return "custom";
  return null;
}

async function flushStats() {
  if (!pendingStats) {
    pendingStatsFlush = false;
    return;
  }
  const snapshot = pendingStats;
  pendingStats = null;
  pendingStatsFlush = false;
  await saveStats(snapshot);
}

async function recordMatchedRule(info) {
  try {
    const { request, rule } = info;
    if (!rule) return;
    const category = categoryForRuleId(rule.ruleId, rule.rulesetId);
    if (!category) return; // allowlist hits ignored

    const tabId = request && typeof request.tabId === "number" ? request.tabId : -1;
    if (tabId >= 0) {
      const next = (perTabBlocked.get(tabId) || 0) + 1;
      perTabBlocked.set(tabId, next);
      updateBadge(tabId, next);
    }

    if (!pendingStats) pendingStats = await getStats();
    pendingStats.total += 1;
    pendingStats.byCategory[category] = (pendingStats.byCategory[category] || 0) + 1;

    if (!pendingStatsFlush) {
      pendingStatsFlush = true;
      setTimeout(flushStats, 1500);
    }

    if (
      rule.rulesetId === STATIC_RULESET_STRICT &&
      STRICT_COLLISION_RULE_IDS.has(rule.ruleId)
    ) {
      await recordDeceptionDiagnosticEntry({
        type: "strictRuleHint",
        key: `strict-rule-${rule.ruleId}`,
        host: request && (request.initiator || request.documentUrl || request.url || ""),
        at: Date.now()
      });
    }
  } catch (err) {
    console.warn("[PrivacyShield] recordMatchedRule failed", err);
  }
}

async function recordDeceptionDiagnosticEntry(entry) {
  try {
    if (!entry || typeof entry !== "object") return;
    const type = String(entry.type || "");
    const key = String(entry.key || "").slice(0, 120);
    if (!type || !key) return;

    const diagnostics = await getDeceptionDiagnostics();
    if (type === "detectorHit") {
      bumpRecord(diagnostics.detectorHits, key);
    } else if (type === "patchReapply") {
      diagnostics.patchReapplyEvents += 1;
      bumpRecord(diagnostics.detectorHits, `patch-overwrite-${key}`);
    } else if (type === "strictRuleHint") {
      bumpRecord(diagnostics.strictRuleHints, key);
    } else {
      bumpRecord(diagnostics.detectorHits, `unknown-${type}`);
    }

    diagnostics.lastUpdated = new Date().toISOString();
    diagnostics.recentEvents = [
      ...(diagnostics.recentEvents || []),
      {
        type,
        key,
        host: String(entry.host || "").slice(0, 253),
        at: Number.isFinite(entry.at) ? entry.at : Date.now()
      }
    ].slice(-MAX_DECEPTION_RECENT_EVENTS);
    await saveDeceptionDiagnostics(diagnostics);
  } catch (err) {
    console.warn("[PrivacyShield] recordDeceptionDiagnostic failed", err);
  }
}

function updateBadge(tabId, count) {
  try {
    const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
    const textCall = chrome.action.setBadgeText({ tabId, text });
    if (textCall && typeof textCall.then === "function") {
      textCall.catch(() => {});
    }
    const colorCall = chrome.action.setBadgeBackgroundColor({ tabId, color: "#2f6feb" });
    if (colorCall && typeof colorCall.then === "function") {
      colorCall.catch(() => {});
    }
  } catch (_) {
    // Tab may have been closed; ignore.
  }
}

function clearTabStats(tabId) {
  perTabBlocked.delete(tabId);
  try {
    const call = chrome.action.setBadgeText({ tabId, text: "" });
    if (call && typeof call.then === "function") {
      call.catch(() => {});
    }
  } catch (_) {
    // ignore
  }
}

/* ---------------------------------------------------------------- *
 * Lifecycle                                                        *
 * ---------------------------------------------------------------- */

async function ensureInitialized() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    STATS_KEY,
    DECEPTION_DIAGNOSTICS_KEY
  ]);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...DEFAULT_SETTINGS } });
  }
  if (!stored[STATS_KEY]) {
    await chrome.storage.local.set({ [STATS_KEY]: { ...DEFAULT_STATS } });
  }
  if (!stored[DECEPTION_DIAGNOSTICS_KEY]) {
    await chrome.storage.local.set({
      [DECEPTION_DIAGNOSTICS_KEY]: cloneDeceptionDiagnostics()
    });
  }
  const settings = await getSettings();
  await applyAllSettings(settings);
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureInitialized().catch((err) =>
    console.warn("[PrivacyShield] init failed", err)
  );
  if (details.reason === "install" || details.reason === "update") {
    chrome.action.setBadgeText({ text: "" }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitialized().catch((err) =>
    console.warn("[PrivacyShield] startup init failed", err)
  );
});

// Reapply rules when settings change from anywhere.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  const settings = await getSettings();
  await applyAllSettings(settings);
});

// Reset per-tab counter when a tab starts loading a new top-level URL.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    clearTabStats(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => clearTabStats(tabId));

// Rule match observation requires the declarativeNetRequestFeedback permission
// and is officially "unpacked extensions only". We register defensively.
try {
  if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(recordMatchedRule);
  }
} catch (err) {
  console.warn("[PrivacyShield] onRuleMatchedDebug unavailable", err);
}

/* ---------------------------------------------------------------- *
 * Message API for popup / options / content script                 *
 * ---------------------------------------------------------------- */

const messageHandlers = {
  async getState({ tabId }) {
    const settings = await getSettings();
    const stats = await getStats();
    const deceptionDiagnostics = await getDeceptionDiagnostics();
    const enabledRulesets = await safeGetEnabledRulesets();
    const dynamicCount = await safeGetDynamicCount();
    const tabCount = typeof tabId === "number" ? perTabBlocked.get(tabId) || 0 : 0;
    return {
      ok: true,
      settings,
      stats,
      deceptionDiagnostics,
      tabCount,
      enabledRulesets,
      dynamicCount,
      version: chrome.runtime.getManifest().version
    };
  },

  async setEnabled({ enabled }) {
    const current = await getSettings();
    const next = { ...current, enabled: Boolean(enabled) };
    await saveSettings(next);
    return { ok: true };
  },

  async setStrictMode({ strictMode }) {
    const current = await getSettings();
    const next = { ...current, strictMode: Boolean(strictMode) };
    await saveSettings(next);
    return { ok: true };
  },

  async setSiteAllowed({ host, allowed }) {
    const domain = normalizeDomain(host || "");
    if (!isValidDomain(domain)) return { ok: false, error: "Invalid host" };
    const current = await getSettings();
    const set = new Set(current.allowlist.map(normalizeDomain));
    if (allowed) set.delete(domain);
    else set.add(domain);
    if (set.size > MAX_ALLOWLIST) return { ok: false, error: "Allowlist limit reached" };
    const next = { ...current, allowlist: [...set] };
    await saveSettings(next);
    return { ok: true };
  },

  async addAllowlistEntry({ host }) {
    const domain = normalizeDomain(host || "");
    if (!isValidDomain(domain)) return { ok: false, error: "Invalid domain" };
    const current = await getSettings();
    if (current.allowlist.includes(domain)) return { ok: true, duplicate: true };
    if (current.allowlist.length >= MAX_ALLOWLIST) {
      return { ok: false, error: "Allowlist limit reached" };
    }
    const next = { ...current, allowlist: [...current.allowlist, domain] };
    await saveSettings(next);
    return { ok: true };
  },

  async removeAllowlistEntry({ host }) {
    const domain = normalizeDomain(host || "");
    const current = await getSettings();
    const next = { ...current, allowlist: current.allowlist.filter((d) => d !== domain) };
    await saveSettings(next);
    return { ok: true };
  },

  async addCustomRule({ type, value }) {
    const rule = { type, value: typeof value === "string" ? value.trim() : "" };
    if (rule.type === "domain") rule.value = normalizeDomain(rule.value);
    if (!isValidCustomRule(rule)) return { ok: false, error: "Invalid rule" };
    const current = await getSettings();
    const exists = current.customRules.some(
      (r) => r.type === rule.type && r.value === rule.value
    );
    if (exists) return { ok: true, duplicate: true };
    if (current.customRules.length >= MAX_CUSTOM_RULES) {
      return { ok: false, error: "Custom rule limit reached" };
    }
    const next = { ...current, customRules: [...current.customRules, rule] };
    const saved = await saveSettings(next);
    if (!saved) return { ok: false, error: "Storage failure" };
    // Verify DNR accepted the resulting rules.
    const sync = await syncDynamicRules(next);
    if (!sync.ok) {
      // Roll back if DNR rejected the new rule.
      await saveSettings(current);
      return { ok: false, error: sync.error || "Rule rejected by browser" };
    }
    return { ok: true };
  },

  async removeCustomRule({ type, value }) {
    const current = await getSettings();
    const target = type === "domain" ? normalizeDomain(value) : String(value).trim();
    const next = {
      ...current,
      customRules: current.customRules.filter(
        (r) => !(r.type === type && r.value === target)
      )
    };
    await saveSettings(next);
    return { ok: true };
  },

  async exportSettings() {
    const settings = await getSettings();
    const stats = await getStats();
    return {
      ok: true,
      payload: {
        kind: "PrivacyShieldBackup",
        version: 1,
        exportedAt: new Date().toISOString(),
        settings,
        stats
      }
    };
  },

  async importSettings({ payload }) {
    if (!payload || payload.kind !== "PrivacyShieldBackup") {
      return { ok: false, error: "Unrecognized backup file" };
    }
    const incoming = payload.settings || {};
    const cleaned = {
      enabled:
        typeof incoming.enabled === "boolean" ? incoming.enabled : DEFAULT_SETTINGS.enabled,
      strictMode:
        typeof incoming.strictMode === "boolean"
          ? incoming.strictMode
          : DEFAULT_SETTINGS.strictMode,
      allowlist: Array.isArray(incoming.allowlist)
        ? [...new Set(incoming.allowlist.map(normalizeDomain).filter(isValidDomain))].slice(
            0,
            MAX_ALLOWLIST
          )
        : [],
      customRules: Array.isArray(incoming.customRules)
        ? incoming.customRules
            .map((r) => ({
              type: r && r.type === "urlFilter" ? "urlFilter" : "domain",
              value:
                r && typeof r.value === "string"
                  ? r.type === "urlFilter"
                    ? r.value.trim()
                    : normalizeDomain(r.value)
                  : ""
            }))
            .filter(isValidCustomRule)
            .slice(0, MAX_CUSTOM_RULES)
        : []
    };
    const saved = await saveSettings(cleaned);
    if (!saved) return { ok: false, error: "Storage failure" };
    const applied = await applyAllSettings(cleaned);
    return { ok: applied };
  },

  async resetSettings() {
    await saveSettings({ ...DEFAULT_SETTINGS });
    await applyAllSettings({ ...DEFAULT_SETTINGS });
    return { ok: true };
  },

  async resetStats() {
    await saveStats({ ...DEFAULT_STATS, byCategory: { ...DEFAULT_STATS.byCategory } });
    perTabBlocked.clear();
    return { ok: true };
  },

  async recordDeceptionDiagnostic(payload) {
    await recordDeceptionDiagnosticEntry(payload);
    return { ok: true };
  },

  async resetDeceptionDiagnostics() {
    await saveDeceptionDiagnostics(cloneDeceptionDiagnostics());
    return { ok: true };
  }
};

async function safeGetEnabledRulesets() {
  try {
    return await chrome.declarativeNetRequest.getEnabledRulesets();
  } catch (_) {
    return [];
  }
}

async function safeGetDynamicCount() {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    let allow = 0;
    let custom = 0;
    for (const r of rules) {
      if (r.id >= ALLOWLIST_ID_START && r.id <= ALLOWLIST_ID_END) allow += 1;
      if (r.id >= CUSTOM_ID_START && r.id <= CUSTOM_ID_END) custom += 1;
    }
    return { total: rules.length, allowlist: allow, custom };
  } catch (_) {
    return { total: 0, allowlist: 0, custom: 0 };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "Invalid message" });
    return false;
  }
  const handler = messageHandlers[message.type];
  if (!handler) {
    sendResponse({ ok: false, error: "Unknown message type" });
    return false;
  }
  Promise.resolve(handler(message.payload || {}))
    .then((result) => sendResponse(result))
    .catch((err) => {
      console.warn("[PrivacyShield] handler error", message.type, err);
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    });
  return true; // keep the message channel open for async sendResponse
});
