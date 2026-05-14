# ArabSeed Shield

**ArabSeed Shield** is a modern Chromium Manifest V3 extension by
**Khalid Abdelaty** for blocking ads, popunders, trackers, and targeted
anti-adblock flows on ArabSeed and related streaming/download hosts.

It is built on `chrome.declarativeNetRequest`, local-only storage, and a
targeted MAIN-world guard for ArabSeed-class pages.

The goals are deliberately narrow: block common ad/tracker network requests,
hide common ad containers, give the user clear controls, and never collect
data, never send anything to a server, never load remote code, and use
page-local deception only on explicitly targeted streaming hosts.

## Ownership and rights

Copyright (c) 2026 **Khalid Abdelaty**. All rights reserved.

This project, its code, branding, logo, UI, rules, and documentation are owned
and maintained by Khalid Abdelaty. Unauthorized copying, redistribution,
rebranding, resale, publication, or claiming authorship is not permitted without
explicit written permission from Khalid Abdelaty.

Repository: `https://github.com/KhalidAbdelaty/arabseed-adblocker`

## Visual identity

The extension uses a warm editorial palette inspired by Anthropic-style design:
cream backgrounds, charcoal text, burnt-orange accents, soft gradients, rounded
cards, and a custom shield/play logo in `icons/arabseed-shield.svg`.

## Project structure

```
extension/
  manifest.json              MV3 manifest, permissions, rule resources
  icons/
    arabseed-shield.svg      Custom ArabSeed Shield logo/icon
  target_config.js           Shared targeted-host and deception config
  service_worker.js          Background controller: settings, DNR rules, stats
  content_script.js          Lightweight cosmetic filtering (isolated world)
  page_world_guard.js        MAIN-world targeted anti-detection guard
  popup.html                 Toolbar popup markup
  popup.js                   Popup controller
  options.html               Options page markup
  options.js                 Options page controller
  styles/
    popup.css                Popup styling (light + dark)
    options.css              Options page styling (light + dark)
  rules/
    static_rules.json        Normal-mode DNR rules (ads, trackers, popups)
    strict_rules.json        Strict-mode DNR rules (aggressive 3rd-party)
  README.md                  This file
```

### What each file does

- **manifest.json**: declares MV3, extension icons, service worker, popup,
  options page, content scripts, and the two static DNR rulesets. Requests only
  the permissions the features actually need.
- **target_config.js**: shared data-only config for targeted hosts, trusted
  navigation hosts, bait selectors, detector thresholds, and local kill-switch
  defaults. It is loaded before both content scripts.
- **service_worker.js**: the brain. Initializes defaults on install, syncs DNR
  rulesets and dynamic rules whenever settings change, listens to rule matches
  via `onRuleMatchedDebug` to maintain local-only counters, updates the badge,
  records local-only deception diagnostics, and exposes a small
  `chrome.runtime.onMessage` API for the UI.
- **content_script.js**: isolated-world cosmetics plus targeted DOM hardening.
  It injects CSS, collapses empty placeholders, forwards local guard diagnostics
  to the service worker, and disables itself on allowlisted sites.
- **page_world_guard.js**: MAIN-world guard for targeted streaming hosts. It
  normalizes Brave/client-hint signals, blocks popunders and forced redirects,
  stubs common detector globals, wraps timers/dynamic code with detector
  signatures, and adds document / MutationObserver deception patches.
- **popup.html / popup.js / styles/popup.css**: the toolbar UI: master toggle,
  per-site toggle, strict-mode toggle, this-tab/all-time counters, warm
  gradient branding, and a link to the control center.
- **options.html / options.js / styles/options.css**: full settings page:
  ruleset status, allowlist CRUD, custom block rules CRUD (domain or URL
  filter), import/export JSON, reset, local statistics, deception diagnostics,
  and ownership/about details.
- **rules/static_rules.json**: normal-mode DNR rules. Organized in stable ID
  ranges so the service worker can map matches to categories for stats:
  - `1-999` display ads
  - `1000-1999` trackers / analytics
  - `2000-3999` ad scripts and ad iframe patterns
  - `4000-4999` popup / popunder ad networks
- **rules/strict_rules.json**: aggressive third-party ad/tracker rules in the
  range `5000-5999`, enabled only when the user turns on strict mode.

The service worker reserves these dynamic rule ID ranges:

- `100000-199999` per-domain allowlist (`allowAllRequests`, priority 1000)
- `200000-299999` user-added custom block rules (priority 1)

Allowlist rules outrank block rules so a user can always recover a broken
site instantly from the popup.

## Permissions and why each is needed

The manifest requests the smallest set that supports the features:

- `declarativeNetRequest` &mdash; required to register and update blocking rules.
- `declarativeNetRequestFeedback` &mdash; required for `onRuleMatchedDebug` so the
  popup can show a per-tab blocked counter and the options page can show a
  per-category breakdown. This API is intentionally limited by Chromium to
  unpacked / developer installs; if the browser does not deliver these events,
  the extension still works, the counters just stay at zero (the code degrades
  gracefully via try/catch).
- `storage` &mdash; required to persist settings and statistics to
  `chrome.storage.local`. Nothing is sent off-device.
- `tabs` &mdash; required to read the active tab's URL so the popup can show the
  current host and toggle the allowlist for the right site.
- `activeTab` &mdash; gives a temporary, user-gesture grant for the active tab.

`host_permissions` is intentionally empty. Network-level blocking does not
require host permissions when using `declarativeNetRequest`.

## Architecture overview

```
+------------+   messages   +-----------------+   DNR API   +------------+
|  popup.js  | <----------> | service_worker  | ----------> | rulesets / |
+------------+              |     .js         |             | dynamic    |
+------------+   messages   |                 |             | rules      |
| options.js | <----------> |                 |             +------------+
+------------+              |                 |
                            |                 |   storage   +------------+
+------------+   storage    |                 | <---------> | local-only |
| content_   | <----------> +-----------------+             | settings, |
| script.js  |                                              | stats, dx |
+------------+                                              +------------+
      ^
      | shared target config
      v
+-------------------+        MAIN world        +---------------------+
| target_config.js  | -----------------------> | page_world_guard.js |
+-------------------+                          +---------------------+
```

- The **service worker** owns the rule engine and the canonical settings.
- The **popup** and **options page** never touch DNR directly; they message
  the service worker, which validates input and applies changes atomically.
- The **content script** reads settings from `chrome.storage.local` directly
  for a fast first paint, and watches `chrome.storage.onChanged` for live
  toggle updates without a page reload.
- The **page-world guard** runs only on configured target hosts and applies
  local anti-detection patches for Brave/client hints, detector globals,
  timers, dynamic code, `document`, `MutationObserver`, popunders, and forced
  redirects.
- All **statistics and deception diagnostics** stay in `chrome.storage.local`.
  There is no analytics endpoint; there is no `fetch` call to anything outside
  the user's machine.

## Loading the extension as unpacked

### Microsoft Edge

1. Open `edge://extensions/`.
2. Enable **Developer mode** (toggle in the lower left).
3. Click **Load unpacked**.
4. Select the `extension/` folder (the one containing `manifest.json`).
5. Pin **ArabSeed Shield** from the toolbar puzzle-piece menu for easy access.

### Brave

1. Open `brave://extensions/`.
2. Enable **Developer mode** (toggle in the upper right).
3. Click **Load unpacked**.
4. Select the `extension/` folder.
5. Pin **ArabSeed Shield** from the toolbar puzzle-piece menu.

> Brave's built-in Shields will still be active. That is fine: this extension
> is additive. If you want to evaluate ArabSeed Shield in isolation, lower
> Brave Shields to "Standard" or disable trackers/ads blocking on a test site.

## Test plan

### 1. Smoke test (always run after install)

1. Open `edge://extensions/` (or `brave://extensions/`) and confirm the
   extension shows **No errors**.
2. Click the toolbar icon. The popup should show the current host, two
   counters at zero, and three toggles all enabled (Strict Mode off).
3. Open the **Options** page and confirm the **Status** card lists
   `static_rules` as an active static ruleset and your version number.

### 2. Network blocking

1. Visit a public ad/tracker test page such as
   [`https://d3ward.github.io/toolz/adblock.html`](https://d3ward.github.io/toolz/adblock.html).
2. Re-open the popup; the **This site** counter should be greater than zero.
3. Open the test page's reporting section and confirm a high block rate.

### 3. Strict mode

1. Toggle **Strict mode** on in the popup. The Options page **Status** card
   should now also list `strict_rules` as active.
2. Reload a content-heavy site (news / e-commerce) and confirm extra
   third-party requests are blocked. If a site you rely on breaks, use the
   **Block on this site** toggle to allowlist it.

### 4. Per-site allowlist

1. On any site, turn off **Block on this site** in the popup.
2. Reload the page; cosmetic filtering should disappear and the site should
   load all third-party content normally.
3. Open Options &rarr; Global allowlist; the host should be listed. Remove it
   to re-enable blocking, then reload the page to confirm.

### 5. Custom block rules

1. Open Options &rarr; Custom blocklist.
2. Add a rule with type **Domain** and value `example.com`. Visit
   `https://example.com` and confirm it fails to load (`ERR_BLOCKED_BY_CLIENT`).
3. Remove the rule and confirm the page loads again.
4. Try a URL filter rule like `||doubleclick.net^` (advanced users).

### 6. Import / export / reset

1. Click **Export settings (JSON)** &mdash; a `privacy-shield-backup-*.json`
   file should download.
2. Click **Reset to defaults**, confirm the prompt; allowlist and custom rules
   become empty, strict mode turns off.
3. Click **Import settings (JSON)** and choose the file you just exported;
   your previous settings are restored.

### 7. ArabSeed targeted flow

1. Visit an ArabSeed target page such as `https://m.asd.ink/`.
2. Confirm anti-browser / anti-adblock banners are suppressed.
3. Confirm watch/download sections remain visible.
4. Open a generated download page and press **Download** from the page itself.
   Directly pasting CDN links into a new tab can return `403 Forbidden` because
   some delivery hosts require the ArabSeed page as the referrer.

### 8. Verify no user data leaves the device

1. Open the service worker DevTools: from `edge://extensions/` (or
   `brave://extensions/`), click **Service worker** under ArabSeed Shield's
   card.
2. Switch to the **Network** tab in DevTools.
3. Browse normally for a minute and toggle settings.
4. The network panel for the service worker should show **no outgoing
   requests at all**. If you ever see one, that is a bug; please report it.
5. Check the **Sources** tab and confirm there is no remote `fetch`,
   `XMLHttpRequest`, `WebSocket`, or `import()` of an off-extension URL.

## Debugging declarativeNetRequest rules

- **List active static rulesets** &mdash; in the service worker DevTools console:
  ```js
  await chrome.declarativeNetRequest.getEnabledRulesets();
  ```
- **Inspect dynamic rules** (allowlist + custom):
  ```js
  await chrome.declarativeNetRequest.getDynamicRules();
  ```
- **See rule matches in real time** &mdash; in the service worker DevTools console:
  ```js
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(console.log);
  ```
- **Check for declared-rule errors** &mdash; from `chrome://extensions` /
  `edge://extensions`, expand the extension card and click **Errors** if
  present. Static rules with malformed conditions will surface here.
- **Reload after rule changes** &mdash; static rule files are read at extension
  load time. After editing `rules/*.json`, click the reload icon on the
  extension's card.

## Privacy and rights promises

- No telemetry. No analytics. No crash reporting endpoint.
- No remote code: every script the extension runs ships in this folder.
- No `<all_urls>` host permission. Blocking uses DNR, which does not require
  host access.
- No external network requests of any kind from the service worker, popup,
  options page, or content script.
- All user data (settings, allowlist, custom rules, statistics) lives only in
  `chrome.storage.local` on this device and can be wiped with **Reset to
  defaults** plus **Reset statistics**.
- All authorship, branding, and distribution rights belong to Khalid Abdelaty.
