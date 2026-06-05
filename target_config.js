/*
 * Privacy Shield - shared target configuration
 *
 * Loaded before both isolated-world and MAIN-world scripts. Keep this file
 * data-only so it is safe to execute in either world.
 */
(function () {
  var targetHosts = [
    "asd.ink",
    "asd.homes",
    "arabseed.com",
    "arabseed.net",
    "arabseed.sbs",
    "arabseed.ink",
    "arabseed.one",
    "arabseed.co",
    "arabseed.tv",
    "reviewrate.net",
    "reviewtech.me",
    "arabseed.me",
    "arabseed.show",
    "arabseed.xyz",
    "arabseed.onl",
    "arabseed.wiki",
    "arabseed.lol",
    "seeeed.xyz",
    "fredl.ru",
    "filespayouts.com",
    "usersdrive.com",
    "up-4ever.net",
    "up4ever.com",
    "up4ever.net",
    "filemoon.sx",
    "savefiles.com",
    "up4fun.top",
    "ups2up.fun",
    "ups2up.top",
    "vidmoly.me",
    "vidmoly.net",
    "vidmoly.biz",
    "vidara.to",
    "voe.sx",
    "byse.sx",
    "bysezejataos.com",
    "bysevepoin.com",
    "stmix.io",
    "f75s.com",
    "luluvdo.com",
    "luluvid.com",
    "frdl.io"
  ];
  var downloadDeliveryHosts = [
    "cdn.boutique"
  ];
  var adRedirectHosts = [
    "interlinecustomroofingllc.com",
    "static.nresystems.com"
  ];

  var config = {
    version: 3,
    targetHosts: targetHosts.slice(),
    trustedNavigationHosts: targetHosts.concat(downloadDeliveryHosts),
    downloadDeliveryHosts: downloadDeliveryHosts.slice(),
    adRedirectHosts: adRedirectHosts.slice(),
    baitSelectors: [
      "#adex",
      "#advert1",
      "[id='adbox']",
      "[id='adsbox']",
      "[class~='adsbox']",
      "[class~='adblock-bait']"
    ],
    warningSelectors: [
      ".anti-adblock-message",
      "#brave-block-notice",
      "[id*='adblock']",
      "[class*='adblock']",
      "[id*='anti-ad']",
      "[class*='anti-ad']",
      "[id*='brave']",
      "[class*='brave']",
      "[id*='browser']",
      "[class*='browser']",
      ".alert-danger",
      ".notice-danger"
    ],
    overlayAdSelectors: [
      "iframe[id^='container-']",
      "iframe[class^='container-']",
      "iframe[style*='z-index: 2147483647']",
      "iframe[style*='z-index:2147483647']",
      "div[id][style*='--rdata']",
      "div[style*='z-index: 2147483647']",
      "div[style*='z-index:2147483647']",
      "div[style*='pointer-events: auto'][style*='position: fixed']",
      "a[href*='interlinecustomroofingllc.com']",
      "a[href*='static.nresystems.com']"
    ],
    warningTextPhrases: [
      "قم بإستخدام متصفح اخر",
      "قم باستخدام متصفح اخر",
      "قم بإستخدام متصفح آخر",
      "قم باستخدام متصفح آخر",
      "لتتمكن من المشاهدة والتحميل",
      "لتتمكن من التحميل"
    ],
    downloadSelectors: [
      ".blocks__section .downloads__tabs",
      ".blocks__section .tabs__holder",
      ".blocks__section .tab__inner",
      ".blocks__section .downloads__links__list"
    ],
    watchSelectors: [
      ".watch__area",
      ".watch__area .watch__servers__list",
      ".watch__area .servers__list",
      ".watch__area .player__iframe"
    ],
    dangerousProtocols: ["javascript:", "data:"],
    detectorSettings: {
      blockLowConfidenceDynamicCode: false,
      signatureThreshold: 7,
      obfuscatedPathLength: 180,
      obfuscatedTokenLength: 50
    },
    killSwitches: {
      detectorEngine: true,
      dynamicCodeGuard: true,
      documentDeception: true,
      mutationObserverDeception: true,
      navigationGuard: true,
      braveDeception: true,
      integrityWatchdog: true
    }
  };

  function normalizeHost(host) {
    return String(host || "").toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function hostMatchesAnySuffix(host, list) {
    var normalized = normalizeHost(host);
    if (!normalized) return false;
    for (var i = 0; i < list.length; i++) {
      var item = normalizeHost(list[i]);
      if (normalized === item || normalized.endsWith("." + item)) return true;
    }
    return false;
  }

  config.normalizeHost = normalizeHost;
  config.hostMatchesAnySuffix = hostMatchesAnySuffix;
  config.isTargetHost = function (host) {
    return hostMatchesAnySuffix(host, config.targetHosts);
  };
  config.isTrustedNavigationHost = function (host) {
    return hostMatchesAnySuffix(host, config.trustedNavigationHosts);
  };

  try {
    Object.freeze(config.targetHosts);
    Object.freeze(config.trustedNavigationHosts);
    Object.freeze(config.baitSelectors);
    Object.freeze(config.warningSelectors);
    Object.freeze(config.downloadSelectors);
    Object.freeze(config.watchSelectors);
    Object.freeze(config.dangerousProtocols);
    Object.freeze(config.adRedirectHosts);
    Object.freeze(config.overlayAdSelectors);
    Object.freeze(config.detectorSettings);
    Object.freeze(config.killSwitches);
    Object.freeze(config);
  } catch (_) {
    // Older engines may reject freezing host objects; the config is still usable.
  }

  globalThis.__privacyShieldTargetConfig = config;
})();
