/*
 * Privacy Shield - content script
 *
 * Lightweight cosmetic filtering only. Does not modify any page scripts and
 * does not attempt to hide its own existence. Runs in an isolated world; no
 * global variables are added to the page.
 */

(() => {
  if (window.__privacyShieldCosmeticActive) return;
  window.__privacyShieldCosmeticActive = true;

  const STYLE_ELEMENT_ID = "privacy-shield-cosmetic-style";
  const TARGET_CONFIG = window.__privacyShieldTargetConfig || {};
  const DEFAULT_WARNING_SELECTORS = [
    ".anti-adblock-message",
    "#brave-block-notice",
    '[id*="adblock"]',
    '[class*="adblock"]'
  ];
  const DEFAULT_DOWNLOAD_SELECTORS = [
    ".blocks__section .downloads__tabs",
    ".blocks__section .tabs__holder",
    ".blocks__section .tab__inner",
    ".blocks__section .downloads__links__list"
  ];
  const DEFAULT_WATCH_SELECTORS = [
    ".watch__area",
    ".watch__area .watch__servers__list",
    ".watch__area .servers__list",
    ".watch__area .player__iframe"
  ];
  const ASD_WARNING_SELECTORS = (
    TARGET_CONFIG.warningSelectors || DEFAULT_WARNING_SELECTORS
  ).join(",");
  const ASD_DOWNLOAD_SELECTORS = (
    TARGET_CONFIG.downloadSelectors || DEFAULT_DOWNLOAD_SELECTORS
  ).join(",");
  const ASD_WATCH_SELECTORS = (
    TARGET_CONFIG.watchSelectors || DEFAULT_WATCH_SELECTORS
  ).join(",");
  const ASD_BAIT_SELECTORS = (TARGET_CONFIG.baitSelectors || ["#adex"]).join(",");
  const ASD_OVERLAY_AD_SELECTORS = (
    TARGET_CONFIG.overlayAdSelectors || [
      "iframe[id^='container-']",
      "iframe[class^='container-']",
      "iframe[style*='z-index: 2147483647']",
      "div[id][style*='--rdata']",
      "div[style*='z-index: 2147483647']",
      "div[style*='pointer-events: auto'][style*='position: fixed']"
    ]
  ).join(",");
  const ASD_AD_REDIRECT_HOSTS = TARGET_CONFIG.adRedirectHosts || [
    "interlinecustomroofingllc.com",
    "static.nresystems.com"
  ];
  const ASD_POPUP_ALLOWED_EXTERNAL_HOSTS = TARGET_CONFIG.popupAllowedExternalHosts || [];
  const ASD_POPUNDER_HOSTS = TARGET_CONFIG.popunderHosts || [];
  const ASD_KILL_SWITCHES = TARGET_CONFIG.killSwitches || {};
  const ASD_WARNING_TEXT_PHRASES = TARGET_CONFIG.warningTextPhrases || [
    "قم بإستخدام متصفح اخر",
    "قم باستخدام متصفح اخر",
    "قم بإستخدام متصفح آخر",
    "قم باستخدام متصفح آخر",
    "لتتمكن من المشاهدة والتحميل",
    "لتتمكن من التحميل"
  ];
  const DETECTOR_SETTINGS = {
    obfuscatedPathLength: 180,
    obfuscatedTokenLength: 50,
    ...(TARGET_CONFIG.detectorSettings || {})
  };

  function forwardGuardDiagnostic(event) {
    const detail = event && event.detail;
    if (!detail || typeof detail !== "object") return;
    try {
      chrome.runtime.sendMessage({
        type: "recordDeceptionDiagnostic",
        payload: {
          type: String(detail.type || ""),
          key: String(detail.key || ""),
          host: String(detail.host || hostFromLocation()),
          at: Number.isFinite(detail.at) ? detail.at : Date.now()
        }
      }).catch(() => {});
    } catch (_) {
      // Diagnostics are best-effort and local-only.
    }
  }

  try {
    document.addEventListener("__privacyShieldGuardDiagnostic", forwardGuardDiagnostic, true);
  } catch (_) {
    // ignore
  }
  // The page-world stealth / popup guard runs as a separate MAIN-world
  // content script (see manifest.json). It loads from the extension origin
  // and therefore bypasses page CSP that would otherwise reject inline
  // script injection from this isolated-world script.

  // Maintainable groups of selectors. Keep these conservative; aggressive
  // selectors should be moved into a dedicated "strict" group only.
  const SELECTOR_GROUPS = {
    commonAdSlots: [
      'div[id^="div-gpt-ad"]',
      'div[id^="google_ads_"]',
      'div[id^="google_ads_iframe_"]',
      'iframe[id^="google_ads_iframe_"]',
      'iframe[src*="googlesyndication.com"]',
      'iframe[src*="doubleclick.net"]',
      'iframe[src*="amazon-adsystem.com"]',
      'iframe[src*="adnxs.com"]',
      'iframe[name^="google_ads_iframe_"]',
      'ins.adsbygoogle',
      'div[class^="adsbygoogle"]',
      'div[id^="ad-"]',
      'div[id^="ads-"]',
      'div[class^="ad-"]',
      'div[class*=" ad-"]',
      'div[class~="ad"]',
      'div[class~="ads"]',
      'div[class~="advert"]',
      'div[class~="advertisement"]',
      'div[class*="ad-banner"]',
      'div[class*="ad-container"]',
      'div[class*="ad-wrapper"]',
      'div[class*="ad_unit"]',
      'div[class*="adunit"]',
      'aside[class*="ad-"]',
      'aside[class*="advert"]',
      'section[class*="ad-"]'
    ],
    sponsoredBlocks: [
      'div[data-ad]',
      'div[data-ad-client]',
      'div[data-ad-slot]',
      'div[data-google-query-id]',
      'div[data-testid="placementTracking"]',
      'div[aria-label="Advertisement"]',
      'div[aria-label="advertisement"]',
      'div[aria-label*="Sponsored"]',
      'div[data-testid="placeholder-ad"]',
      'div[data-component-type="s-ads"]'
    ],
    stickyBanners: [
      'div[class*="sticky-ad"]',
      'div[class*="sticky_ad"]',
      'div[class*="anchor-ad"]',
      'div[class*="ad-anchor"]',
      'div[class*="footer-ad"]',
      'div[id*="sticky-ad"]',
      'div[id*="anchor-ad"]'
    ],
    floatingContainers: [
      'div[class*="floating-ad"]',
      'div[class*="overlay-ad"]',
      'div[class*="ad-overlay"]',
      'div[class*="popup-ad"]',
      'div[class*="ad-popup"]'
    ]
  };

  function buildHideCss() {
    const all = [
      ...SELECTOR_GROUPS.commonAdSlots,
      ...SELECTOR_GROUPS.sponsoredBlocks,
      ...SELECTOR_GROUPS.stickyBanners,
      ...SELECTOR_GROUPS.floatingContainers
    ];
    const block = `${all.join(",\n")} {
      display: none !important;
      visibility: hidden !important;
      width: 0 !important;
      height: 0 !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      pointer-events: none !important;
    }`;
    return block;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    try {
      const style = document.createElement("style");
      style.id = STYLE_ELEMENT_ID;
      style.type = "text/css";
      style.textContent = buildHideCss();
      // Prefer documentElement so the style is present even before <head>.
      (document.head || document.documentElement).appendChild(style);
    } catch (err) {
      console.warn("[PrivacyShield] cosmetic injection failed", err);
    }
  }

  function removeStyle() {
    const node = document.getElementById(STYLE_ELEMENT_ID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  // Collapse empty placeholders left behind after the network blocker removes
  // their contents. Only acts on elements still containing nothing meaningful.
  const PLACEHOLDER_SELECTORS = [
    'iframe[src=""]',
    'iframe:not([src])',
    'div[class*="ad-placeholder"]',
    'div[class*="ad_placeholder"]'
  ].join(",");

  function collapseEmptyPlaceholders(root) {
    let nodes;
    try {
      nodes = (root || document).querySelectorAll(PLACEHOLDER_SELECTORS);
    } catch (_) {
      return;
    }
    for (const node of nodes) {
      if (node.children.length > 0) continue;
      const text = node.textContent ? node.textContent.trim() : "";
      if (text.length > 0) continue;
      try {
        node.style.setProperty("display", "none", "important");
      } catch (_) {
        // ignore
      }
    }
  }

  let observer = null;
  let throttled = false;

  function startObserver() {
    if (observer) return;
    try {
      observer = new MutationObserver(() => {
        if (throttled) return;
        throttled = true;
        // Use rAF to coalesce work and yield to the page.
        requestAnimationFrame(() => {
          throttled = false;
          collapseEmptyPlaceholders(document.body);
        });
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (err) {
      console.warn("[PrivacyShield] observer failed", err);
    }
  }

  function stopObserver() {
    if (!observer) return;
    try {
      observer.disconnect();
    } catch (_) {
      // ignore
    }
    observer = null;
  }

  let asdObserver = null;
  let asdObserverThrottled = false;
  let asdClickGuardAttached = false;

  function isAsdHost(host) {
    if (typeof TARGET_CONFIG.isTargetHost === "function") {
      return TARGET_CONFIG.isTargetHost(host);
    }
    return /(^|\.)asd\.(ink|homes)$/i.test(String(host || ""));
  }

  function hostMatchesAnySuffix(host, list) {
    if (typeof TARGET_CONFIG.hostMatchesAnySuffix === "function") {
      return TARGET_CONFIG.hostMatchesAnySuffix(host, list);
    }
    const normalized = String(host || "").toLowerCase();
    if (!normalized) return false;
    return list.some((entry) => {
      const item = String(entry || "").toLowerCase();
      return normalized === item || normalized.endsWith("." + item);
    });
  }

  function isAsdPopupAllowedHost(host) {
    if (typeof TARGET_CONFIG.isTrustedNavigationHost === "function") {
      return TARGET_CONFIG.isTrustedNavigationHost(host);
    }
    return hostMatchesAnySuffix(host, TARGET_CONFIG.trustedNavigationHosts || []);
  }

  function isDownloadDeliveryHost(host) {
    return hostMatchesAnySuffix(host, TARGET_CONFIG.downloadDeliveryHosts || []);
  }

  function isKnownAdRedirectHost(host) {
    return hostMatchesAnySuffix(host, ASD_AD_REDIRECT_HOSTS);
  }

  function isKnownAdHost(host) {
    return isKnownAdRedirectHost(host) || hostMatchesAnySuffix(host, ASD_POPUNDER_HOSTS);
  }

  function isPopupGuardEnabled() {
    return ASD_KILL_SWITCHES.popupGuard !== false;
  }

  function targetOpensNewWindow(target) {
    const value = String(target || "").toLowerCase();
    return value === "_blank" || value === "_new";
  }

  function isTrustedPopupDestination(host) {
    if (!host) return false;
    if (isAsdHost(host)) return true;
    if (isAsdPopupAllowedHost(host)) return true;
    return hostMatchesAnySuffix(host, ASD_POPUP_ALLOWED_EXTERNAL_HOSTS);
  }

  function isLikelyObfuscatedPath(parsedUrl) {
    if (!parsedUrl) return false;
    const value = `${parsedUrl.pathname || ""}${parsedUrl.search || ""}`;
    if (value.length < DETECTOR_SETTINGS.obfuscatedPathLength) return false;
    const tokenPattern = new RegExp(
      `[A-Za-z0-9_-]{${DETECTOR_SETTINGS.obfuscatedTokenLength},}`
    );
    return tokenPattern.test(value);
  }

  function keepAsdBaitVisible() {
    let baitNodes = [];
    try {
      baitNodes = document.querySelectorAll(ASD_BAIT_SELECTORS);
    } catch (_) {
      baitNodes = [];
    }
    for (const bait of baitNodes) {
      try {
        bait.style.setProperty("display", "block", "important");
        bait.style.setProperty("visibility", "visible", "important");
        bait.style.setProperty("width", "1px", "important");
        bait.style.setProperty("height", "1px", "important");
        bait.style.setProperty("opacity", "1", "important");
      } catch (_) {
        // ignore
      }
    }
  }

  function hideAsdWarningNode(node) {
    try {
      node.style.setProperty("display", "none", "important");
      node.style.setProperty("visibility", "hidden", "important");
      node.style.setProperty("height", "0", "important");
      node.style.setProperty("min-height", "0", "important");
      node.style.setProperty("padding", "0", "important");
      node.style.setProperty("margin", "0", "important");
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("data-privacy-shield-hidden-warning", "1");
    } catch (_) {
      // ignore
    }
  }

  function hideAsdOverlayAdNode(node) {
    if (!node || !node.style) return;
    try {
      node.style.setProperty("display", "none", "important");
      node.style.setProperty("visibility", "hidden", "important");
      node.style.setProperty("pointer-events", "none", "important");
      node.style.setProperty("width", "0", "important");
      node.style.setProperty("height", "0", "important");
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("data-privacy-shield-hidden-overlay", "1");
    } catch (_) {
      // ignore
    }
  }

  function hideAsdOverlayAdNodes(root) {
    if (!isAsdHost(hostFromLocation())) return;
    const scope = root && root.querySelectorAll ? root : document;
    let nodes = [];
    try {
      nodes = scope.querySelectorAll(ASD_OVERLAY_AD_SELECTORS);
    } catch (_) {
      nodes = [];
    }
    for (const node of nodes) {
      hideAsdOverlayAdNode(node);
      if (node.parentElement && node.tagName === "A") {
        hideAsdOverlayAdNode(node.parentElement);
      }
    }
  }

  function hideAsdBrowserWarningText(root) {
    const scope = root && root.querySelectorAll ? root : document;
    let nodes = [];
    try {
      nodes = scope.querySelectorAll("body *");
    } catch (_) {
      nodes = [];
    }
    for (const node of nodes) {
      let text = "";
      try {
        text = node.textContent || "";
      } catch (_) {
        text = "";
      }
      if (!text) continue;
      if (text.length > 220) continue;
      if (!ASD_WARNING_TEXT_PHRASES.some((phrase) => text.includes(phrase))) continue;
      hideAsdWarningNode(node);
    }
  }

  function normalizeAsdDownloadLinks(root) {
    const scope = root && root.querySelectorAll ? root : document;
    let nodes = [];
    try {
      nodes = scope.querySelectorAll("a[href], form[action]");
    } catch (_) {
      nodes = [];
    }
    for (const node of nodes) {
      const rawUrl = node.getAttribute("href") || node.getAttribute("action");
      if (!rawUrl) continue;
      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl, location.href);
      } catch (_) {
        continue;
      }
      if (!isDownloadDeliveryHost(parsedUrl.hostname)) continue;
      try {
        node.setAttribute("referrerpolicy", "unsafe-url");
        const rel = (node.getAttribute("rel") || "")
          .split(/\s+/)
          .filter((token) => token && token.toLowerCase() !== "noreferrer")
          .join(" ");
        if (rel) node.setAttribute("rel", rel);
        else node.removeAttribute("rel");
      } catch (_) {
        // ignore
      }
    }
  }

  function patchAsdDownloadUi(root) {
    if (!isAsdHost(hostFromLocation())) return;
    const scope = root && root.querySelectorAll ? root : document;

    let warningNodes = [];
    try {
      warningNodes = scope.querySelectorAll(ASD_WARNING_SELECTORS);
    } catch (_) {
      warningNodes = [];
    }
    for (const node of warningNodes) {
      hideAsdWarningNode(node);
    }
    hideAsdBrowserWarningText(scope);

    let downloadNodes = [];
    try {
      downloadNodes = scope.querySelectorAll(ASD_DOWNLOAD_SELECTORS);
    } catch (_) {
      downloadNodes = [];
    }
    for (const node of downloadNodes) {
      try {
        node.style.removeProperty("display");
        node.style.removeProperty("visibility");
        node.style.removeProperty("opacity");
        node.style.setProperty("display", "block", "important");
      } catch (_) {
        // ignore
      }
    }

    let lists = [];
    try {
      lists = scope.querySelectorAll(".blocks__section .downloads__tabs ul");
    } catch (_) {
      lists = [];
    }
    for (const list of lists) {
      try {
        list.style.setProperty("display", "flex", "important");
      } catch (_) {
        // ignore
      }
    }

    let watchNodes = [];
    try {
      watchNodes = scope.querySelectorAll(ASD_WATCH_SELECTORS);
    } catch (_) {
      watchNodes = [];
    }
    for (const node of watchNodes) {
      try {
        node.style.removeProperty("display");
        node.style.removeProperty("visibility");
        node.style.removeProperty("opacity");
        node.style.setProperty("display", "block", "important");
        node.style.setProperty("visibility", "visible", "important");
      } catch (_) {
        // ignore
      }
    }

    let watchFlexNodes = [];
    try {
      watchFlexNodes = scope.querySelectorAll(
        ".watch__area .watch__servers__list, .watch__area .servers__list ul"
      );
    } catch (_) {
      watchFlexNodes = [];
    }
    for (const node of watchFlexNodes) {
      try {
        node.style.setProperty("display", "flex", "important");
      } catch (_) {
        // ignore
      }
    }

    let watchFrames = [];
    try {
      watchFrames = scope.querySelectorAll(".watch__area iframe");
    } catch (_) {
      watchFrames = [];
    }
    for (const frame of watchFrames) {
      try {
        frame.style.setProperty("display", "block", "important");
        frame.style.setProperty("visibility", "visible", "important");
      } catch (_) {
        // ignore
      }
    }

    hardenAsdIframes(scope);
    keepAsdBaitVisible();
    hideAsdOverlayAdNodes(scope);
    normalizeAsdDownloadLinks(scope);
  }

  function isExternalAdLikeUrl(parsedUrl) {
    // Signal-based: only treat a destination as an ad/popunder when there is a
    // positive signal. Default to allowing navigation so legitimate outbound
    // links (mirrors, social, info pages) keep working even as ArabSeed rotates
    // domains.
    if (!parsedUrl) return false;
    const protocol = (parsedUrl.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return false;
    const host = (parsedUrl.hostname || "").toLowerCase();
    if (!host) return false;
    if (isAsdHost(host)) return false;
    if (isAsdPopupAllowedHost(host)) return false;
    if (isKnownAdRedirectHost(host)) return true;
    if (isLikelyObfuscatedPath(parsedUrl)) return true;
    return false;
  }

  function handleAsdGuardedClick(event) {
    if (!isAsdHost(hostFromLocation())) return;
    let anchor = null;
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (const node of path) {
        if (node && node.tagName === "A") {
          anchor = node;
          break;
        }
      }
    }
    if (!anchor && event.target && typeof event.target.closest === "function") {
      anchor = event.target.closest("a[href]");
    }
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(href, location.href);
    } catch (_) {
      return;
    }

    // Strict popup blocking: a target="_blank"/"_new" anchor that points to a
    // non-trusted host is a popunder vector, so block it regardless of whether
    // the destination already looks ad-like. Trusted + social hosts pass.
    const protocol = (parsedUrl.protocol || "").toLowerCase();
    if (
      isPopupGuardEnabled() &&
      targetOpensNewWindow(anchor.getAttribute("target")) &&
      (protocol === "http:" || protocol === "https:") &&
      !isTrustedPopupDestination((parsedUrl.hostname || "").toLowerCase())
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (!isExternalAdLikeUrl(parsedUrl)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleAsdGuardedSubmit(event) {
    if (!isAsdHost(hostFromLocation())) return;
    const form = event.target;
    if (!form || form.tagName !== "FORM") return;
    const action = form.getAttribute("action");
    if (!action) return;
    let parsedUrl;
    try {
      parsedUrl = new URL(action, location.href);
    } catch (_) {
      return;
    }
    if (!isExternalAdLikeUrl(parsedUrl)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function startAsdClickGuard() {
    if (asdClickGuardAttached) return;
    asdClickGuardAttached = true;
    try {
      document.addEventListener("click", handleAsdGuardedClick, true);
      document.addEventListener("auxclick", handleAsdGuardedClick, true);
      document.addEventListener("mousedown", handleAsdGuardedClick, true);
      document.addEventListener("pointerdown", handleAsdGuardedClick, true);
      document.addEventListener("touchstart", handleAsdGuardedClick, true);
      document.addEventListener("submit", handleAsdGuardedSubmit, true);
    } catch (_) {
      // ignore
    }
  }

  function stopAsdClickGuard() {
    if (!asdClickGuardAttached) return;
    asdClickGuardAttached = false;
    try {
      document.removeEventListener("click", handleAsdGuardedClick, true);
      document.removeEventListener("auxclick", handleAsdGuardedClick, true);
      document.removeEventListener("mousedown", handleAsdGuardedClick, true);
      document.removeEventListener("pointerdown", handleAsdGuardedClick, true);
      document.removeEventListener("touchstart", handleAsdGuardedClick, true);
      document.removeEventListener("submit", handleAsdGuardedSubmit, true);
    } catch (_) {
      // ignore
    }
  }

  // Iframe defense:
  // - For same-origin (asd.ink) frames and known streaming hosts: apply a
  //   restrictive sandbox that blocks popups + top navigation while keeping
  //   scripts / forms / fullscreen working.
  // - For any other cross-origin iframe (not in the allowlist), neutralize
  //   src to "about:blank" so it cannot load an ad payload.
  const ASD_IFRAME_SANDBOX_VALUE =
    "allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock";
  const ASD_IFRAME_SANDBOX_FLAG = "data-privacy-shield-sandboxed";
  const ASD_IFRAME_NEUTRALIZED_FLAG = "data-privacy-shield-neutralized";

  function classifyIframeSrc(rawSrc) {
    if (!rawSrc) return "empty";
    const trimmed = String(rawSrc).trim();
    if (!trimmed || trimmed === "about:blank") return "empty";
    if (trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
      return "blocked";
    }
    let parsed;
    try {
      parsed = new URL(trimmed, location.href);
    } catch (_) {
      return "blocked";
    }
    const protocol = (parsed.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return "blocked";
    const host = (parsed.hostname || "").toLowerCase();
    if (!host) return "blocked";
    if (isKnownAdRedirectHost(host)) return "blocked";
    if (isAsdHost(host)) return "trusted";
    if (isAsdPopupAllowedHost(host)) return "trusted";
    if (isLikelyObfuscatedPath(parsed)) return "blocked";
    return "blocked";
  }

  function hardenAsdIframes(root) {
    if (!isAsdHost(hostFromLocation())) return;
    const scope = root && root.querySelectorAll ? root : document;
    let frames;
    try {
      frames = scope.querySelectorAll("iframe");
    } catch (_) {
      return;
    }
    for (const frame of frames) {
      let src = "";
      try {
        src = frame.getAttribute("src") || frame.src || "";
      } catch (_) {
        src = "";
      }
      const verdict = classifyIframeSrc(src);

      if (verdict === "blocked") {
        if (frame.getAttribute(ASD_IFRAME_NEUTRALIZED_FLAG) === "1") continue;
        try {
          frame.setAttribute(ASD_IFRAME_NEUTRALIZED_FLAG, "1");
          frame.setAttribute("src", "about:blank");
          frame.setAttribute("sandbox", "");
          frame.style.setProperty("display", "none", "important");
        } catch (_) {
          // ignore
        }
        continue;
      }

      if (frame.getAttribute(ASD_IFRAME_SANDBOX_FLAG) === "1") continue;
      try {
        if (!frame.hasAttribute("sandbox")) {
          frame.setAttribute("sandbox", ASD_IFRAME_SANDBOX_VALUE);
        } else {
          const existing = (frame.getAttribute("sandbox") || "").toLowerCase();
          if (existing.includes("allow-popups") || existing.includes("allow-top-navigation")) {
            const cleaned = existing
              .split(/\s+/)
              .filter((token) => token && token !== "allow-popups" && !token.startsWith("allow-top-navigation"))
              .join(" ");
            frame.setAttribute("sandbox", cleaned || ASD_IFRAME_SANDBOX_VALUE);
          }
        }
        frame.setAttribute(ASD_IFRAME_SANDBOX_FLAG, "1");
      } catch (_) {
        // ignore
      }
    }
  }

  function startAsdObserver() {
    if (asdObserver) return;
    try {
      asdObserver = new MutationObserver((mutations) => {
        // Iframe hardening runs synchronously per mutation so a malicious
        // src never has a chance to load. patchAsdDownloadUi is throttled.
        for (const mutation of mutations) {
          if (mutation.type === "childList" && mutation.addedNodes) {
            for (const node of mutation.addedNodes) {
              if (!node || node.nodeType !== 1) continue;
              if (node.tagName === "IFRAME") {
                hardenAsdIframes(node.parentNode || document);
              } else if (node.querySelectorAll) {
                if (node.querySelector("iframe")) {
                  hardenAsdIframes(node);
                }
              }
            }
          } else if (
            mutation.type === "attributes" &&
            mutation.target &&
            mutation.target.tagName === "IFRAME" &&
            (mutation.attributeName === "src" || mutation.attributeName === "sandbox")
          ) {
            hardenAsdIframes(mutation.target.parentNode || document);
          }
        }
        if (asdObserverThrottled) return;
        asdObserverThrottled = true;
        requestAnimationFrame(() => {
          asdObserverThrottled = false;
          patchAsdDownloadUi(document);
        });
      });
      asdObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "src", "sandbox"]
      });
    } catch (err) {
      console.warn("[PrivacyShield] asd observer failed", err);
    }
  }

  function stopAsdObserver() {
    if (!asdObserver) return;
    try {
      asdObserver.disconnect();
    } catch (_) {
      // ignore
    }
    asdObserver = null;
  }

  function hostFromLocation() {
    try {
      return location.hostname.toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function isHostAllowlisted(host, allowlist) {
    if (!host || !Array.isArray(allowlist)) return false;
    if (allowlist.includes(host)) return true;
    // Match parent registrable-style domain entries (e.g. allow example.com -> www.example.com)
    for (const entry of allowlist) {
      if (typeof entry !== "string") continue;
      const e = entry.toLowerCase();
      if (host === e) return true;
      if (host.endsWith("." + e)) return true;
    }
    return false;
  }

  // Global (all-sites) guard: cancel clicks whose destination is a known ad /
  // popunder network. Safe everywhere because it only acts on known ad hosts.
  let globalAdClickGuardAttached = false;

  function findAnchorFromEvent(event) {
    let anchor = null;
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (const node of path) {
        if (node && node.tagName === "A") {
          anchor = node;
          break;
        }
      }
    }
    if (!anchor && event.target && typeof event.target.closest === "function") {
      anchor = event.target.closest("a[href]");
    }
    return anchor;
  }

  function handleGlobalAdHostClick(event) {
    if (!isPopupGuardEnabled()) return;
    const anchor = findAnchorFromEvent(event);
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    let parsedUrl;
    try {
      parsedUrl = new URL(href, location.href);
    } catch (_) {
      return;
    }
    const protocol = (parsedUrl.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return;
    const host = (parsedUrl.hostname || "").toLowerCase();
    if (!host || !isKnownAdHost(host)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function startGlobalAdClickGuard() {
    if (globalAdClickGuardAttached) return;
    globalAdClickGuardAttached = true;
    try {
      document.addEventListener("click", handleGlobalAdHostClick, true);
      document.addEventListener("auxclick", handleGlobalAdHostClick, true);
      document.addEventListener("mousedown", handleGlobalAdHostClick, true);
      document.addEventListener("pointerdown", handleGlobalAdHostClick, true);
    } catch (_) {
      // ignore
    }
  }

  function stopGlobalAdClickGuard() {
    if (!globalAdClickGuardAttached) return;
    globalAdClickGuardAttached = false;
    try {
      document.removeEventListener("click", handleGlobalAdHostClick, true);
      document.removeEventListener("auxclick", handleGlobalAdHostClick, true);
      document.removeEventListener("mousedown", handleGlobalAdHostClick, true);
      document.removeEventListener("pointerdown", handleGlobalAdHostClick, true);
    } catch (_) {
      // ignore
    }
  }

  async function readSettings() {
    try {
      const result = await chrome.storage.local.get("privacyShieldSettings");
      return result.privacyShieldSettings || null;
    } catch (_) {
      return null;
    }
  }

  async function applyState() {
    const settings = await readSettings();
    if (!settings || settings.enabled === false) {
      removeStyle();
      stopObserver();
      stopAsdObserver();
      stopAsdClickGuard();
      stopGlobalAdClickGuard();
      return;
    }
    if (isHostAllowlisted(hostFromLocation(), settings.allowlist || [])) {
      removeStyle();
      stopObserver();
      stopAsdObserver();
      stopAsdClickGuard();
      stopGlobalAdClickGuard();
      return;
    }
    injectStyle();
    if (document.body) {
      collapseEmptyPlaceholders(document.body);
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => collapseEmptyPlaceholders(document.body),
        { once: true }
      );
    }
    startObserver();
    // Block clicks to known ad/popunder networks on every site.
    startGlobalAdClickGuard();

    if (isAsdHost(hostFromLocation())) {
      patchAsdDownloadUi(document);
      startAsdObserver();
      startAsdClickGuard();
    } else {
      stopAsdObserver();
      stopAsdClickGuard();
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes.privacyShieldSettings) return;
      applyState();
    });
  } catch (_) {
    // storage events unavailable; proceed without live updates
  }

  applyState();
})();
