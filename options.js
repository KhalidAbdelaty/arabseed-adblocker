/*
 * Privacy Shield - options page script
 *
 * Provides global allowlist + custom blocklist CRUD, import/export of all
 * settings as JSON, reset, and a status view of current rulesets / counters.
 */

const $ = (id) => document.getElementById(id);

const els = {
  status: $("status-list"),
  allowForm: $("allowlist-form"),
  allowInput: $("allowlist-input"),
  allowError: $("allowlist-error"),
  allowList: $("allowlist-list"),

  customForm: $("customrule-form"),
  customType: $("customrule-type"),
  customInput: $("customrule-input"),
  customError: $("customrule-error"),
  customList: $("customrule-list"),

  exportBtn: $("btn-export"),
  importInput: $("import-input"),
  resetBtn: $("btn-reset"),
  backupStatus: $("backup-status"),

  statsList: $("stats-list"),
  resetStatsBtn: $("btn-reset-stats"),
  diagnosticsList: $("diagnostics-list")
};

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function isValidDomain(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 253) return false;
  return DOMAIN_REGEX.test(trimmed);
}

function isValidUrlFilter(value) {
  return typeof value === "string" && value.trim().length > 0 && !/\s/.test(value.trim());
}

function send(type, payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "No response" });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
}

function escapeText(value) {
  // Always render dynamic content via textContent, never innerHTML.
  return String(value);
}

function renderStatus(state) {
  const settings = state.settings;
  const enabled = state.enabledRulesets || [];
  const dyn = state.dynamicCount || { total: 0, allowlist: 0, custom: 0 };

  const items = [
    ["Master switch", settings.enabled ? "Enabled" : "Disabled"],
    ["Strict mode", settings.strictMode ? "On" : "Off"],
    [
      "Static rulesets active",
      enabled.length === 0 ? "None" : enabled.join(", ")
    ],
    ["Allowlist entries (active)", String(dyn.allowlist)],
    ["Custom rules (active)", String(dyn.custom)],
    ["Extension version", "v" + state.version]
  ];

  els.status.replaceChildren(...items.map(([label, value]) => makeStatusRow(label, value)));
}

function makeStatusRow(label, value) {
  const li = document.createElement("li");
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "value";
  v.textContent = value;
  li.append(l, v);
  return li;
}

function renderStats(stats) {
  const rows = [
    ["Total blocked requests", stats.total || 0],
    ["Display ads", stats.byCategory.ads || 0],
    ["Trackers / analytics", stats.byCategory.trackers || 0],
    ["Ad scripts / patterns", stats.byCategory.scripts || 0],
    ["Popup / popunder ads", stats.byCategory.popups || 0],
    ["Strict-mode blocks", stats.byCategory.strict || 0],
    ["Custom rule blocks", stats.byCategory.custom || 0]
  ];
  els.statsList.replaceChildren(
    ...rows.map(([label, value]) => makeStatusRow(label, String(value)))
  );
}

function sumObjectValues(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((total, item) => total + (Number(item) || 0), 0);
}

function renderDiagnostics(diagnostics = {}) {
  const rows = [
    ["Detector signature hits", sumObjectValues(diagnostics.detectorHits)],
    ["Patch re-apply events", diagnostics.patchReapplyEvents || 0],
    ["Strict-rule collision hints", sumObjectValues(diagnostics.strictRuleHints)],
    ["Last updated", diagnostics.lastUpdated || "Never"]
  ];
  els.diagnosticsList.replaceChildren(
    ...rows.map(([label, value]) => makeStatusRow(label, String(value)))
  );
}

function renderAllowlist(items) {
  els.allowList.replaceChildren();
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No allowlisted sites yet.";
    els.allowList.append(li);
    return;
  }
  for (const domain of items) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = domain;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "entry-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const r = await send("removeAllowlistEntry", { host: domain });
      if (!r.ok) {
        remove.disabled = false;
        showError(els.allowError, r.error || "Failed to remove");
      } else {
        await refresh();
      }
    });
    li.append(text, remove);
    els.allowList.append(li);
  }
}

function renderCustomRules(items) {
  els.customList.replaceChildren();
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No custom block rules yet.";
    els.customList.append(li);
    return;
  }
  for (const rule of items) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = rule.value;
    const meta = document.createElement("span");
    meta.className = "entry-meta";
    meta.textContent = rule.type === "domain" ? "domain" : "urlFilter";
    const left = document.createElement("span");
    left.append(text, document.createTextNode(" "), meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "entry-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const r = await send("removeCustomRule", { type: rule.type, value: rule.value });
      if (!r.ok) {
        remove.disabled = false;
        showError(els.customError, r.error || "Failed to remove");
      } else {
        await refresh();
      }
    });
    li.append(left, remove);
    els.customList.append(li);
  }
}

function showError(node, text) {
  node.textContent = text || "";
  if (text) {
    setTimeout(() => {
      if (node.textContent === text) node.textContent = "";
    }, 4000);
  }
}

function setBackupStatus(text) {
  els.backupStatus.textContent = text || "";
  if (text) {
    setTimeout(() => {
      if (els.backupStatus.textContent === text) els.backupStatus.textContent = "";
    }, 4000);
  }
}

async function refresh() {
  const state = await send("getState", {});
  if (!state.ok) {
    els.status.replaceChildren(makeStatusRow("Error", state.error || "Unavailable"));
    return;
  }
  renderStatus(state);
  renderStats(state.stats);
  renderDiagnostics(state.deceptionDiagnostics);
  renderAllowlist(state.settings.allowlist || []);
  renderCustomRules(state.settings.customRules || []);
}

els.allowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = els.allowInput.value.trim().toLowerCase();
  if (!isValidDomain(value)) {
    showError(els.allowError, "Enter a valid domain like example.com");
    return;
  }
  const r = await send("addAllowlistEntry", { host: value });
  if (!r.ok) {
    showError(els.allowError, r.error || "Failed to add");
    return;
  }
  els.allowInput.value = "";
  showError(els.allowError, "");
  await refresh();
});

els.customForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const type = els.customType.value === "urlFilter" ? "urlFilter" : "domain";
  const value = els.customInput.value.trim();
  if (type === "domain" && !isValidDomain(value)) {
    showError(els.customError, "Enter a valid domain like tracker.example.com");
    return;
  }
  if (type === "urlFilter" && !isValidUrlFilter(value)) {
    showError(els.customError, "Enter a non-empty URL filter pattern with no spaces");
    return;
  }
  const r = await send("addCustomRule", { type, value });
  if (!r.ok) {
    showError(els.customError, r.error || "Failed to add");
    return;
  }
  els.customInput.value = "";
  showError(els.customError, "");
  await refresh();
});

els.exportBtn.addEventListener("click", async () => {
  const r = await send("exportSettings");
  if (!r.ok) {
    setBackupStatus("Export failed: " + (r.error || "unknown"));
    return;
  }
  const json = JSON.stringify(r.payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `privacy-shield-backup-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setBackupStatus("Exported settings file.");
});

els.importInput.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  els.importInput.value = "";
  if (!file) return;
  if (file.size > 1_000_000) {
    setBackupStatus("File too large.");
    return;
  }
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const r = await send("importSettings", { payload });
    if (!r.ok) {
      setBackupStatus("Import failed: " + (r.error || "unknown"));
      return;
    }
    setBackupStatus("Settings imported.");
    await refresh();
  } catch (err) {
    setBackupStatus("Import failed: not valid JSON.");
  }
});

els.resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset all settings to defaults? This clears your allowlist and custom rules."))
    return;
  const r = await send("resetSettings");
  if (!r.ok) {
    setBackupStatus("Reset failed: " + (r.error || "unknown"));
    return;
  }
  setBackupStatus("Settings reset.");
  await refresh();
});

els.resetStatsBtn.addEventListener("click", async () => {
  if (!confirm("Reset local statistics?")) return;
  const r = await send("resetStats");
  if (r.ok) await refresh();
});

document.addEventListener("DOMContentLoaded", () => {
  refresh().catch((err) => console.warn("[PrivacyShield] options refresh failed", err));
});
