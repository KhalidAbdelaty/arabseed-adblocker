/*
 * Privacy Shield - page-world guard
 *
 * Runs in the page's MAIN world (declared in manifest.json with
 * "world": "MAIN"). Scope is intentionally limited by manifest matches and
 * target_config.js. No network traffic or remote code is used.
 */

(function () {
  var cfg = window.__privacyShieldTargetConfig || {};

  function currentHost() {
    try {
      return String(location.hostname || "").toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function hostMatchesAnySuffix(host, list) {
    if (typeof cfg.hostMatchesAnySuffix === "function") {
      return cfg.hostMatchesAnySuffix(host, list || []);
    }
    var normalized = String(host || "").toLowerCase();
    if (!normalized) return false;
    for (var i = 0; i < (list || []).length; i++) {
      var item = String(list[i] || "").toLowerCase();
      if (normalized === item || normalized.endsWith("." + item)) return true;
    }
    return false;
  }

  function isTargetHost(host) {
    if (typeof cfg.isTargetHost === "function") return cfg.isTargetHost(host);
    return /(^|\.)asd\.(ink|homes)$/i.test(String(host || ""));
  }

  function isTrustedNavigationHost(host) {
    if (typeof cfg.isTrustedNavigationHost === "function") {
      return cfg.isTrustedNavigationHost(host);
    }
    return hostMatchesAnySuffix(host, cfg.trustedNavigationHosts || []);
  }

  if (!isTargetHost(currentHost())) return;

  var marker = window.__privacyShieldGuardInstalled;
  if (marker && marker.owner === "privacy-shield" && marker.version >= 4) return;
  try {
    Object.defineProperty(window, "__privacyShieldGuardInstalled", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: { owner: "privacy-shield", version: 4 }
    });
  } catch (_) {
    try { window.__privacyShieldGuardInstalled = { owner: "privacy-shield", version: 4 }; } catch (__) {}
  }

  var detectorSettings = cfg.detectorSettings || {};
  var killSwitches = cfg.killSwitches || {};
  var baitSelectors = cfg.baitSelectors || ["#adex", "#advert1"];
  var warningSelectors = cfg.warningSelectors || [
    ".anti-adblock-message",
    "#brave-block-notice",
    "[id*='adblock']",
    "[class*='adblock']"
  ];
  var warningTextPhrases = cfg.warningTextPhrases || [
    "قم بإستخدام متصفح اخر",
    "قم باستخدام متصفح اخر",
    "قم بإستخدام متصفح آخر",
    "قم باستخدام متصفح آخر",
    "لتتمكن من المشاهدة والتحميل",
    "لتتمكن من التحميل"
  ];
  var dangerousProtocols = cfg.dangerousProtocols || ["javascript:", "data:"];
  var adRedirectHosts = cfg.adRedirectHosts || [
    "interlinecustomroofingllc.com",
    "static.nresystems.com"
  ];
  var popupAllowedExternalHosts = cfg.popupAllowedExternalHosts || [];

  function featureEnabled(name) {
    return killSwitches[name] !== false;
  }

  function isPopupAllowedExternalHost(host) {
    return hostMatchesAnySuffix(host, popupAllowedExternalHosts);
  }

  var diagnostics = {
    detectorHits: {},
    patchReapplyEvents: 0,
    strictRuleHints: {},
    blockedNavigations: 0
  };

  function emitDiagnostic(type, key) {
    try {
      document.dispatchEvent(new CustomEvent("__privacyShieldGuardDiagnostic", {
        detail: {
          type: type,
          key: key,
          host: currentHost(),
          at: Date.now()
        }
      }));
    } catch (_) {}
  }

  function bump(map, key) {
    try {
      map[key] = (map[key] || 0) + 1;
    } catch (_) {}
  }

  function recordDetectorHit(key) {
    bump(diagnostics.detectorHits, key);
    emitDiagnostic("detectorHit", key);
  }

  function recordStrictRuleHint(key) {
    bump(diagnostics.strictRuleHints, key);
    emitDiagnostic("strictRuleHint", key);
  }

  function isKnownAdRedirectHost(host) {
    return hostMatchesAnySuffix(host, adRedirectHosts);
  }

  try {
    Object.defineProperty(window, "__privacyShieldGuardDiagnostics", {
      configurable: true,
      enumerable: false,
      get: function () {
        return {
          detectorHits: Object.assign({}, diagnostics.detectorHits),
          patchReapplyEvents: diagnostics.patchReapplyEvents,
          strictRuleHints: Object.assign({}, diagnostics.strictRuleHints),
          blockedNavigations: diagnostics.blockedNavigations
        };
      }
    });
  } catch (_) {}

  var nativeFunctionToString = Function.prototype.toString;
  var spoofedSources = typeof WeakMap === "function" ? new WeakMap() : null;

  function nativeSource(fn, fallbackName) {
    try {
      return nativeFunctionToString.call(fn);
    } catch (_) {
      return "function " + (fallbackName || "") + "() { [native code] }";
    }
  }

  function defineFunctionShape(wrapper, nativeFn, name) {
    try {
      Object.defineProperty(wrapper, "name", {
        configurable: true,
        value: name || nativeFn.name || ""
      });
    } catch (_) {}
    try {
      Object.defineProperty(wrapper, "length", {
        configurable: true,
        value: typeof nativeFn.length === "number" ? nativeFn.length : 0
      });
    } catch (_) {}
    if (spoofedSources) {
      try { spoofedSources.set(wrapper, nativeSource(nativeFn, name)); } catch (_) {}
    }
    return wrapper;
  }

  function patchFunctionToString() {
    try {
      if (Function.prototype.toString.__privacyShieldWrapped) return;
      var wrapped = function () {
        if (spoofedSources && spoofedSources.has(this)) return spoofedSources.get(this);
        return nativeFunctionToString.call(this);
      };
      defineFunctionShape(wrapped, nativeFunctionToString, "toString");
      try {
        Object.defineProperty(wrapped, "__privacyShieldWrapped", { value: true });
      } catch (_) {}
      Object.defineProperty(Function.prototype, "toString", {
        configurable: true,
        writable: true,
        value: wrapped
      });
    } catch (_) {}
  }

  patchFunctionToString();

  function defineValue(target, key, value) {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value: value
      });
      return true;
    } catch (_) {
      try {
        target[key] = value;
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  function defineAccessor(target, key, get, set) {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: false,
        get: get,
        set: set || function () {}
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function stripBraveToken(value) {
    return String(value || "")
      .replace(/\sBrave\/[\d.]+/gi, "")
      .replace(/\bBrave\b/gi, "Chrome");
  }

  function sanitizeBrands(brands) {
    if (!Array.isArray(brands)) return brands;
    return brands
      .filter(function (entry) {
        return !entry || !/brave/i.test(String(entry.brand || ""));
      })
      .map(function (entry) {
        if (!entry || typeof entry !== "object") return entry;
        return {
          brand: String(entry.brand || "").replace(/Brave/gi, "Google Chrome"),
          version: String(entry.version || "")
        };
      });
  }

  function patchBraveSignals() {
    if (!featureEnabled("braveDeception")) return;
    try {
      var nav = window.navigator;
      if (!nav) return;
      try { delete nav.brave; } catch (_) {}
      defineAccessor(nav, "brave", function () { return undefined; });

      var proto = Object.getPrototypeOf(nav);
      var uaDesc = proto && Object.getOwnPropertyDescriptor(proto, "userAgent");
      if (uaDesc && typeof uaDesc.get === "function") {
        var nativeUaGetter = uaDesc.get;
        Object.defineProperty(proto, "userAgent", {
          configurable: true,
          enumerable: uaDesc.enumerable,
          get: function () {
            return stripBraveToken(nativeUaGetter.call(this));
          }
        });
      }

      var nativeUaData = nav.userAgentData;
      if (nativeUaData && typeof nativeUaData === "object") {
        var spoofedUaData = {};
        try {
          Object.keys(nativeUaData).forEach(function (key) {
            spoofedUaData[key] = nativeUaData[key];
          });
        } catch (_) {}
        spoofedUaData.brands = sanitizeBrands(nativeUaData.brands);
        spoofedUaData.mobile = Boolean(nativeUaData.mobile);
        spoofedUaData.platform = nativeUaData.platform;
        spoofedUaData.getHighEntropyValues = function (hints) {
          var result;
          try {
            result = nativeUaData.getHighEntropyValues.call(nativeUaData, hints);
          } catch (_) {
            result = Promise.resolve({});
          }
          return Promise.resolve(result).then(function (values) {
            var next = Object.assign({}, values || {});
            if (next.brands) next.brands = sanitizeBrands(next.brands);
            if (next.fullVersionList) next.fullVersionList = sanitizeBrands(next.fullVersionList);
            if (next.uaFullVersion) next.uaFullVersion = stripBraveToken(next.uaFullVersion);
            return next;
          });
        };
        defineAccessor(nav, "userAgentData", function () { return spoofedUaData; });
      }
    } catch (_) {}

    try {
      defineAccessor(window, "Brave", function () { return undefined; });
    } catch (_) {
      try { window.Brave = undefined; } catch (__) {}
    }
  }

  function normalizeSource(value) {
    var source;
    try {
      source = typeof value === "function" ? nativeFunctionToString.call(value) : String(value || "");
    } catch (_) {
      source = String(value || "");
    }
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n\r]*/g, "")
      .replace(/\\x2f|\\u002f/gi, "/")
      .replace(/["`]/g, "'")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  var detectorSignatures = [
    {
      id: "forced-watch-redirect",
      weight: 10,
      all: ["location", "/watch/"],
      any: ["replace(", "assign(", "href=", "pathname"]
    },
    {
      id: "forced-download-redirect",
      weight: 10,
      all: ["location", "/download/"],
      any: ["replace(", "assign(", "href=", "pathname"]
    },
    {
      id: "anti-adblock-bait-probe",
      weight: 8,
      all: ["adblock"],
      any: ["offsetheight", "clientheight", "getcomputedstyle", "display", "visibility"]
    },
    {
      id: "detector-global-probe",
      weight: 7,
      all: ["canrunads"],
      any: ["adblock", "fuckadblock", "blockadblock", "detected"]
    },
    {
      id: "popup-orchestrator",
      weight: 7,
      all: ["window.open"],
      any: ["settimeout", "onclick", "mousedown", "popunder", "target='_blank'"]
    },
    {
      id: "obfuscated-redirector",
      weight: 7,
      all: ["location"],
      any: ["atob(", "fromcharcode", "decodeuricomponent", "eval("]
    },
    {
      id: "hostile-overlay-injector",
      weight: 9,
      all: ["2147483647"],
      any: ["interlinecustomroofingllc", "static.nresystems", "container-", "pointer-events:auto"]
    },
    {
      id: "ad-redirect-host",
      weight: 10,
      all: ["interlinecustomroofingllc"],
      any: ["window.open", "href=", "target='_blank'", "location"]
    }
  ];

  function classifySource(sourceLike) {
    if (!featureEnabled("detectorEngine")) return null;
    var normalized = normalizeSource(sourceLike);
    if (!normalized) return null;
    var threshold = detectorSettings.signatureThreshold || 7;
    var best = null;
    for (var i = 0; i < detectorSignatures.length; i++) {
      var sig = detectorSignatures[i];
      var allMatched = true;
      for (var a = 0; a < sig.all.length; a++) {
        if (normalized.indexOf(sig.all[a]) === -1) {
          allMatched = false;
          break;
        }
      }
      if (!allMatched) continue;
      var anyMatched = !sig.any || sig.any.length === 0;
      for (var b = 0; !anyMatched && b < sig.any.length; b++) {
        if (normalized.indexOf(sig.any[b]) !== -1) anyMatched = true;
      }
      if (!anyMatched) continue;
      if (!best || sig.weight > best.weight) best = sig;
    }
    if (best && best.weight >= threshold) {
      recordDetectorHit(best.id);
      return best;
    }
    return null;
  }

  function isLikelyObfuscatedPath(parsedUrl) {
    if (!parsedUrl) return false;
    var value = String(parsedUrl.pathname || "") + String(parsedUrl.search || "");
    var minLength = detectorSettings.obfuscatedPathLength || 180;
    var tokenLength = detectorSettings.obfuscatedTokenLength || 50;
    if (value.length < minLength) return false;
    return new RegExp("[A-Za-z0-9_-]{" + tokenLength + ",}").test(value);
  }

  function shouldBlockUrl(url, context) {
    if (!featureEnabled("navigationGuard")) return false;
    if (url == null || url === "") return false;
    var parsed;
    try {
      parsed = new URL(String(url), location.href);
    } catch (_) {
      recordDetectorHit("malformed-navigation-" + (context || "unknown"));
      diagnostics.blockedNavigations += 1;
      return true;
    }
    var protocol = String(parsed.protocol || "").toLowerCase();
    if (dangerousProtocols.indexOf(protocol) !== -1) {
      diagnostics.blockedNavigations += 1;
      return true;
    }
    if (protocol !== "http:" && protocol !== "https:") return false;
    var host = String(parsed.hostname || "").toLowerCase();
    if (!host) return false;
    if (isKnownAdRedirectHost(host)) {
      recordDetectorHit("ad-redirect-host");
      diagnostics.blockedNavigations += 1;
      return true;
    }
    if (isTargetHost(host)) return false;
    if (isTrustedNavigationHost(host)) return false;
    if (isLikelyObfuscatedPath(parsed)) {
      recordStrictRuleHint("obfuscated-navigation");
      diagnostics.blockedNavigations += 1;
      return true;
    }
    // No positive ad/redirect signal: allow navigation so unknown ArabSeed
    // mirrors and legitimate external links are not stranded.
    return false;
  }

  // Popup policy is stricter than same-tab navigation: new windows/tabs are the
  // popunder vector, so default-DENY and only allow trusted destinations. This
  // runs inside ArabSeed pages and their streaming iframes (all target hosts),
  // killing window.open popunders even to brand-new ad domains.
  function shouldBlockPopup(url) {
    if (!featureEnabled("popupGuard")) return false;
    var raw = url == null ? "" : String(url).trim();
    // The classic popunder opens a blank window then assigns .location later.
    if (raw === "" || raw.toLowerCase() === "about:blank") return true;
    var parsed;
    try {
      parsed = new URL(raw, location.href);
    } catch (_) {
      return true;
    }
    var protocol = String(parsed.protocol || "").toLowerCase();
    if (dangerousProtocols.indexOf(protocol) !== -1) return true;
    if (protocol !== "http:" && protocol !== "https:") return true;
    var host = String(parsed.hostname || "").toLowerCase();
    if (!host) return true;
    if (isKnownAdRedirectHost(host)) return true;
    if (isTargetHost(host)) return false;
    if (isTrustedNavigationHost(host)) return false;
    if (isPopupAllowedExternalHost(host)) return false;
    return true;
  }

  function noop() {}

  // Returned in place of a real window when a popup is blocked, so popunder
  // scripts that chain `.location = adUrl` / `.focus()` neither throw nor open.
  function makeStubWindow() {
    var stubLocation = {
      href: "about:blank",
      assign: noop,
      replace: noop,
      reload: noop,
      toString: function () { return "about:blank"; }
    };
    var stub = {
      closed: true,
      name: "",
      opener: null,
      location: stubLocation,
      document: { write: noop, writeln: noop, open: noop, close: noop },
      focus: noop,
      blur: noop,
      close: noop,
      moveTo: noop,
      resizeTo: noop,
      postMessage: noop,
      open: function () { return makeStubWindow(); }
    };
    return stub;
  }

  function targetOpensNewWindow(target) {
    var value = String(target || "").toLowerCase();
    return value === "_blank" || value === "_new";
  }

  var nativeSetTimeout = window.setTimeout;
  var nativeSetInterval = window.setInterval;
  var nativeRequestAnimationFrame = window.requestAnimationFrame;
  var nativeQueueMicrotask = window.queueMicrotask;
  var nativeEval = window.eval;
  var nativeFunction = window.Function;
  var integrityChecks = [];

  function registerIntegrity(label, current, install) {
    integrityChecks.push({ label: label, current: current, install: install });
  }

  function patchScheduler(name, nativeFn, blockedReturn) {
    if (typeof nativeFn !== "function") return;
    var wrapper = function (callback) {
      if (classifySource(callback)) return blockedReturn;
      return nativeFn.apply(this, arguments);
    };
    defineFunctionShape(wrapper, nativeFn, name);
    defineValue(window, name, wrapper);
    registerIntegrity(name, function () { return window[name]; }, function () {
      defineValue(window, name, wrapper);
    });
  }

  function patchSchedulers() {
    patchScheduler("setTimeout", nativeSetTimeout, 0);
    patchScheduler("setInterval", nativeSetInterval, 0);
    patchScheduler("requestAnimationFrame", nativeRequestAnimationFrame, 0);
    patchScheduler("queueMicrotask", nativeQueueMicrotask, undefined);
  }

  function patchDynamicCode() {
    if (!featureEnabled("dynamicCodeGuard")) return;
    if (typeof nativeEval === "function") {
      var evalWrapper = function (code) {
        if (classifySource(code)) return undefined;
        return nativeEval.call(this, code);
      };
      defineFunctionShape(evalWrapper, nativeEval, "eval");
      defineValue(window, "eval", evalWrapper);
      registerIntegrity("eval", function () { return window.eval; }, function () {
        defineValue(window, "eval", evalWrapper);
      });
    }

    if (typeof nativeFunction === "function") {
      var functionWrapper = function () {
        var source = "";
        try { source = Array.prototype.join.call(arguments, "\n"); } catch (_) {}
        if (classifySource(source)) {
          return function () {};
        }
        return nativeFunction.apply(this, arguments);
      };
      defineFunctionShape(functionWrapper, nativeFunction, "Function");
      defineValue(window, "Function", functionWrapper);
      registerIntegrity("Function", function () { return window.Function; }, function () {
        defineValue(window, "Function", functionWrapper);
      });
    }
  }

  function createDetectorObject() {
    var detector = {
      check: function () { return detector; },
      clearEvent: function () { return detector; },
      emitEvent: function () { return detector; },
      off: function () { return detector; },
      on: function (name, handler) {
        if (typeof handler === "function" && /not/i.test(String(name || ""))) {
          try { handler(); } catch (_) {}
        }
        return detector;
      },
      onDetected: function () { return detector; },
      onNotDetected: function (handler) {
        if (typeof handler === "function") {
          try { handler(); } catch (_) {}
        }
        return detector;
      },
      setOption: function () { return detector; }
    };
    return detector;
  }

  function patchDetectorGlobals() {
    var detector = createDetectorObject();
    function DetectorConstructor() { return detector; }
    DetectorConstructor.prototype = detector;
    if (spoofedSources) {
      try {
        spoofedSources.set(DetectorConstructor, "function FuckAdBlock() { [native code] }");
      } catch (_) {}
    }

    [
      "fuckAdBlock",
      "fuckadblock",
      "blockAdBlock",
      "BlockAdBlock",
      "FuckAdBlock",
      "adblockDetector",
      "AdBlockDetector",
      "AdBlockDetect"
    ].forEach(function (name) {
      defineAccessor(window, name, function () {
        return name.charAt(0) === name.charAt(0).toUpperCase() ? DetectorConstructor : detector;
      });
    });

    defineAccessor(window, "adBlockDetected", function () { return false; });
    defineAccessor(window, "canRunAds", function () { return true; });
  }

  function ensureBaitElement(selector) {
    var id = selector && selector.charAt(0) === "#" ? selector.slice(1) : "adex";
    var node = null;
    try { node = document.getElementById(id); } catch (_) {}
    if (node) return node;
    try {
      node = document.createElement("div");
      node.id = id;
      node.className = "adsbox adblock-bait";
      node.setAttribute("data-privacy-shield-bait", "1");
      node.style.cssText =
        "display:block!important;visibility:visible!important;width:1px!important;" +
        "height:1px!important;opacity:1!important;position:absolute!important;" +
        "left:-10000px!important;top:-10000px!important;pointer-events:none!important;";
      (document.documentElement || document).appendChild(node);
      return node;
    } catch (_) {
      return null;
    }
  }

  function selectorLooksLikeBait(selector) {
    var value = String(selector || "").toLowerCase();
    if (!value) return false;
    for (var i = 0; i < baitSelectors.length; i++) {
      var bait = String(baitSelectors[i] || "").toLowerCase();
      if (bait && value.indexOf(bait) !== -1) return true;
    }
    return /adex|adbox|adsbox|adblock-bait/.test(value);
  }

  function selectorLooksLikeWarning(selector) {
    var value = String(selector || "").toLowerCase();
    if (!value) return false;
    for (var i = 0; i < warningSelectors.length; i++) {
      var item = String(warningSelectors[i] || "").toLowerCase().replace(/[\[\]"'=*]/g, "");
      if (item && value.indexOf(item) !== -1) return true;
    }
    return /anti-?ad|adblock|brave-block/.test(value);
  }

  function textLooksLikeWarning(text) {
    var value = String(text || "");
    if (!value) return false;
    for (var i = 0; i < warningTextPhrases.length; i++) {
      if (value.indexOf(warningTextPhrases[i]) !== -1) return true;
    }
    return false;
  }

  function patchDocumentQueries() {
    if (!featureEnabled("documentDeception")) return;
    var docProto = window.Document && window.Document.prototype;
    var elemProto = window.Element && window.Element.prototype;
    if (!docProto) return;

    function patchQueryTarget(proto, key) {
      var nativeFn = proto && proto[key];
      if (typeof nativeFn !== "function") return;
      var wrapper = function (selector) {
        if (selectorLooksLikeBait(selector)) {
          var bait = ensureBaitElement(String(selector || "#adex").split(",")[0].trim());
          if (bait && key !== "querySelectorAll") return bait;
        }
        var result = nativeFn.apply(this, arguments);
        if (!result && selectorLooksLikeBait(selector)) return ensureBaitElement("#adex");
        if (selectorLooksLikeWarning(selector) && key !== "querySelectorAll") return null;
        return result;
      };
      defineFunctionShape(wrapper, nativeFn, key);
      defineValue(proto, key, wrapper);
    }

    var nativeGetElementById = docProto.getElementById;
    if (typeof nativeGetElementById === "function") {
      var getElementByIdWrapper = function (id) {
        if (/^(adex|adbox|adsbox)$/i.test(String(id || ""))) {
          return ensureBaitElement("#" + id);
        }
        return nativeGetElementById.apply(this, arguments);
      };
      defineFunctionShape(getElementByIdWrapper, nativeGetElementById, "getElementById");
      defineValue(docProto, "getElementById", getElementByIdWrapper);
    }

    patchQueryTarget(docProto, "querySelector");
    patchQueryTarget(docProto, "querySelectorAll");
    patchQueryTarget(elemProto, "querySelector");
    patchQueryTarget(elemProto, "querySelectorAll");

    try {
      var proxy = new Proxy(document, {
        get: function (target, prop, receiver) {
          if (prop === "querySelector" || prop === "querySelectorAll" || prop === "getElementById") {
            return target[prop].bind(target);
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      defineAccessor(window, "document", function () { return proxy; });
    } catch (_) {}
  }

  function hideWarningNode(node) {
    try {
      node.style.setProperty("display", "none", "important");
      node.style.setProperty("visibility", "hidden", "important");
      node.style.setProperty("height", "0", "important");
      node.style.setProperty("min-height", "0", "important");
      node.style.setProperty("padding", "0", "important");
      node.style.setProperty("margin", "0", "important");
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("data-privacy-shield-hidden-warning", "1");
    } catch (_) {}
  }

  function hideBrowserWarnings(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = [];
    try {
      nodes = scope.querySelectorAll("body *");
    } catch (_) {
      nodes = [];
    }
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      try {
        var text = node.textContent || "";
        if (text.length <= 220 && textLooksLikeWarning(text)) hideWarningNode(node);
      } catch (_) {}
    }
  }

  function mutationTouchesBaitOrWarning(record) {
    try {
      if (record.target && record.target.matches) {
        if (selectorLooksLikeBait("#" + record.target.id) || selectorLooksLikeWarning(record.target.id)) {
          return true;
        }
        for (var i = 0; i < baitSelectors.length; i++) {
          if (record.target.matches(baitSelectors[i])) return true;
        }
        for (var w = 0; w < warningSelectors.length; w++) {
          if (record.target.matches(warningSelectors[w])) return true;
        }
      }
      var nodes = [];
      if (record.addedNodes) nodes = nodes.concat(Array.prototype.slice.call(record.addedNodes));
      if (record.removedNodes) nodes = nodes.concat(Array.prototype.slice.call(record.removedNodes));
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        if (!node || node.nodeType !== 1) continue;
        if (node.matches && (selectorLooksLikeBait("#" + node.id) || selectorLooksLikeWarning(node.id))) {
          return true;
        }
        if (textLooksLikeWarning(node.textContent || "")) return true;
      }
    } catch (_) {}
    return false;
  }

  function patchMutationObserver() {
    if (!featureEnabled("mutationObserverDeception")) return;
    var NativeMutationObserver = window.MutationObserver;
    if (typeof NativeMutationObserver !== "function") return;
    var WrappedMutationObserver = function (callback) {
      var safeCallback = callback;
      if (typeof callback === "function") {
        safeCallback = function (records, observer) {
          var filtered = records;
          try {
            filtered = Array.prototype.filter.call(records || [], function (record) {
              return !mutationTouchesBaitOrWarning(record);
            });
          } catch (_) {
            filtered = records;
          }
          if (!filtered || filtered.length === 0) return undefined;
          return callback.call(this, filtered, observer);
        };
      }
      return new NativeMutationObserver(safeCallback);
    };
    WrappedMutationObserver.prototype = NativeMutationObserver.prototype;
    defineFunctionShape(WrappedMutationObserver, NativeMutationObserver, "MutationObserver");
    defineValue(window, "MutationObserver", WrappedMutationObserver);
    registerIntegrity("MutationObserver", function () { return window.MutationObserver; }, function () {
      defineValue(window, "MutationObserver", WrappedMutationObserver);
    });
  }

  function patchNavigation() {
    var nativeOpen = window.open;
    if (typeof nativeOpen === "function") {
      var openWrapper = function (url) {
        if (shouldBlockPopup(url)) {
          recordDetectorHit("popup-blocked");
          diagnostics.blockedNavigations += 1;
          return makeStubWindow();
        }
        return nativeOpen.apply(this, arguments);
      };
      defineFunctionShape(openWrapper, nativeOpen, "open");
      defineValue(window, "open", openWrapper);
      registerIntegrity("open", function () { return window.open; }, function () {
        defineValue(window, "open", openWrapper);
      });
    }

    try {
      var locProto = window.Location && window.Location.prototype;
      if (locProto) {
        var nativeAssign = locProto.assign;
        var nativeReplace = locProto.replace;
        if (typeof nativeAssign === "function") {
          var assignWrapper = function (url) {
            if (shouldBlockUrl(url, "location.assign")) return undefined;
            return nativeAssign.apply(this, arguments);
          };
          defineFunctionShape(assignWrapper, nativeAssign, "assign");
          defineValue(locProto, "assign", assignWrapper);
        }
        if (typeof nativeReplace === "function") {
          var replaceWrapper = function (url) {
            if (shouldBlockUrl(url, "location.replace")) return undefined;
            return nativeReplace.apply(this, arguments);
          };
          defineFunctionShape(replaceWrapper, nativeReplace, "replace");
          defineValue(locProto, "replace", replaceWrapper);
        }
        var hrefDesc = Object.getOwnPropertyDescriptor(locProto, "href");
        if (hrefDesc && typeof hrefDesc.set === "function" && typeof hrefDesc.get === "function") {
          Object.defineProperty(locProto, "href", {
            configurable: true,
            enumerable: hrefDesc.enumerable,
            get: function () { return hrefDesc.get.call(this); },
            set: function (url) {
              if (shouldBlockUrl(url, "location.href")) return;
              hrefDesc.set.call(this, url);
            }
          });
        }
      }
    } catch (_) {}

    try {
      var nativeAnchorClick = HTMLAnchorElement.prototype.click;
      var anchorClickWrapper = function () {
        try {
          var href = this.getAttribute && this.getAttribute("href");
          if (href) {
            var anchorTarget = this.getAttribute && this.getAttribute("target");
            if (targetOpensNewWindow(anchorTarget) && shouldBlockPopup(href)) return undefined;
            if (shouldBlockUrl(href, "anchor.click")) return undefined;
          }
        } catch (_) {}
        return nativeAnchorClick.apply(this, arguments);
      };
      defineFunctionShape(anchorClickWrapper, nativeAnchorClick, "click");
      defineValue(HTMLAnchorElement.prototype, "click", anchorClickWrapper);
    } catch (_) {}

    try {
      var nativeFormSubmit = HTMLFormElement.prototype.submit;
      var formSubmitWrapper = function () {
        try {
          var action = this.getAttribute && this.getAttribute("action");
          if (action) {
            var formTarget = this.getAttribute && this.getAttribute("target");
            if (targetOpensNewWindow(formTarget) && shouldBlockPopup(action)) return undefined;
            if (shouldBlockUrl(action, "form.submit")) return undefined;
          }
        } catch (_) {}
        return nativeFormSubmit.apply(this, arguments);
      };
      defineFunctionShape(formSubmitWrapper, nativeFormSubmit, "submit");
      defineValue(HTMLFormElement.prototype, "submit", formSubmitWrapper);
    } catch (_) {}

    try {
      document.addEventListener(
        "submit",
        function (event) {
          var form = event.target;
          if (!form || form.tagName !== "FORM") return;
          var action = form.getAttribute && form.getAttribute("action");
          if (action && shouldBlockUrl(action, "submit-event")) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true
      );
    } catch (_) {}
  }

  function injectGuardStyle() {
    try {
      var styleEl = document.createElement("style");
      styleEl.textContent =
        "#advert1, .cjv, [id^='advert'], [class*='click-overlay'], " +
        "[class*='anti-adblock'], [id*='anti-adblock'], " +
        "[class*='brave'], [id*='brave'], [class*='browser'], [id*='browser'], " +
        "[data-privacy-shield-hidden-warning='1'], [data-privacy-shield-hidden-overlay='1'], " +
        "iframe[id^='container-'], iframe[class^='container-'], div[id][style*='--rdata'] {" +
        "display: none !important;" +
        "visibility: hidden !important;" +
        "width: 0 !important;" +
        "height: 0 !important;" +
        "pointer-events: none !important;" +
        "}" +
        "#adex, [data-privacy-shield-bait='1'] {" +
        "display: block !important;" +
        "visibility: visible !important;" +
        "width: 1px !important;" +
        "height: 1px !important;" +
        "opacity: 1 !important;" +
        "pointer-events: none !important;" +
        "}";
      (document.documentElement || document.head).appendChild(styleEl);
    } catch (_) {}
  }

  function startIntegrityWatchdog() {
    if (!featureEnabled("integrityWatchdog") || typeof nativeSetInterval !== "function") return;
    try {
      nativeSetInterval(function () {
        for (var i = 0; i < integrityChecks.length; i++) {
          var check = integrityChecks[i];
          try {
            if (check.current() && check.current().__privacyShieldReapplySkip) continue;
            var before = check.current();
            check.install();
            if (before !== check.current()) {
              diagnostics.patchReapplyEvents += 1;
              recordDetectorHit("patch-overwrite-" + check.label);
              emitDiagnostic("patchReapply", check.label);
            }
          } catch (_) {}
        }
      }, 1000);
    } catch (_) {}
  }

  patchBraveSignals();
  patchSchedulers();
  patchDynamicCode();
  patchDetectorGlobals();
  patchDocumentQueries();
  patchMutationObserver();
  patchNavigation();
  ensureBaitElement("#adex");
  injectGuardStyle();
  hideBrowserWarnings(document);
  startIntegrityWatchdog();
})();
