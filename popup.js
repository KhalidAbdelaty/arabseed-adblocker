/*
 * Privacy Shield - popup script
 *
 * Lightweight UI talking to the service worker over chrome.runtime messages.
 */

const $ = (id) => document.getElementById(id);

const els = {
  host: $("site-host"),
  statSite: $("stat-site"),
  statTotal: $("stat-total"),
  enabled: $("toggle-enabled"),
  site: $("toggle-site"),
  strict: $("toggle-strict"),
  status: $("status-message"),
  options: $("open-options"),
  version: $("ext-version"),
  siteHelp: $("site-toggle-help")
};

let currentTab = null;
let currentHost = null;

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

function flashStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.style.color = isError ? "var(--danger)" : "var(--fg-muted)";
  if (text) {
    setTimeout(() => {
      if (els.status.textContent === text) els.status.textContent = "";
    }, 2500);
  }
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function isHostAllowlisted(host, allowlist) {
  // Mirrors the service worker / content-script suffix matching: a host is
  // allowlisted when it equals an entry or is a subdomain of one. This keeps
  // the popup toggle in sync with how the allowlist is actually applied.
  if (!host || !Array.isArray(allowlist)) return false;
  for (const entry of allowlist) {
    if (typeof entry !== "string") continue;
    const e = entry.toLowerCase();
    if (host === e || host.endsWith("." + e)) return true;
  }
  return false;
}

async function loadActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (_) {
    return null;
  }
}

async function refresh() {
  currentTab = await loadActiveTab();
  currentHost = currentTab ? hostFromUrl(currentTab.url || "") : null;

  els.host.textContent = currentHost || "(non-web page)";
  els.host.title = currentHost || "";

  const state = await send("getState", { tabId: currentTab ? currentTab.id : null });
  if (!state || !state.ok) {
    flashStatus("Could not reach background service.", true);
    return;
  }

  els.version.textContent = "v" + state.version;
  els.statTotal.textContent = formatCount(state.stats.total);
  els.statSite.textContent = formatCount(state.tabCount);

  els.enabled.checked = Boolean(state.settings.enabled);
  els.strict.checked = Boolean(state.settings.strictMode);

  const canTargetSite = Boolean(currentHost);
  const allowlist = state.settings.allowlist || [];
  const isAllowed = canTargetSite && isHostAllowlisted(currentHost, allowlist);
  els.site.checked = canTargetSite ? !isAllowed : false;
  els.site.disabled = !canTargetSite || !state.settings.enabled;
  els.strict.disabled = !state.settings.enabled;

  if (!canTargetSite) {
    els.siteHelp.textContent = "Open a regular web page to allowlist it.";
  } else if (!state.settings.enabled) {
    els.siteHelp.textContent = "Enable the extension first.";
  } else if (isAllowed) {
    els.siteHelp.textContent = "This site is allowlisted (no blocking).";
  } else {
    els.siteHelp.textContent = "Disable to add this site to the allowlist.";
  }
}

function formatCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

els.enabled.addEventListener("change", async () => {
  els.enabled.disabled = true;
  const result = await send("setEnabled", { enabled: els.enabled.checked });
  els.enabled.disabled = false;
  if (!result.ok) flashStatus(result.error || "Failed to update", true);
  else flashStatus("Reload open tabs to apply changes.");
  await refresh();
});

els.strict.addEventListener("change", async () => {
  els.strict.disabled = true;
  const result = await send("setStrictMode", { strictMode: els.strict.checked });
  els.strict.disabled = false;
  if (!result.ok) flashStatus(result.error || "Failed to update", true);
  else flashStatus("Reload open tabs to apply changes.");
  await refresh();
});

els.site.addEventListener("change", async () => {
  if (!currentHost) {
    flashStatus("No site to update.", true);
    await refresh();
    return;
  }
  els.site.disabled = true;
  // Checked = blocking enabled for site = NOT allowlisted
  const result = await send("setSiteAllowed", {
    host: currentHost,
    allowed: !els.site.checked
  });
  els.site.disabled = false;
  if (!result.ok) flashStatus(result.error || "Failed to update", true);
  else flashStatus("Reload the page to apply changes.");
  await refresh();
});

els.options.addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL("options.html"));
});

document.addEventListener("DOMContentLoaded", () => {
  refresh().catch((err) => {
    console.warn("[PrivacyShield] popup refresh failed", err);
    flashStatus("Failed to load state.", true);
  });
});
