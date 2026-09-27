/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start. Communicates with inject.js (MAIN world) via
 * CustomEvents on document.documentElement.
 *
 * Settings handshake:
 *   1. Bridge starts the settings read and registers VSC_REQUEST_SETTINGS
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_idle
 *   3. Bridge responds with VSC_SETTINGS_READY once its storage snapshot is ready
 */

import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';

// Speed limits for page→bridge write validation.
// Duplicated from constants.js (ISOLATED world can't import page modules).
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

/**
 * Resolve the URL that site rules should be matched against.
 *
 * A normal document uses its own location. An inherited about: document
 * (about:blank / about:srcdoc, e.g. the iframe the Kaltura V2 player writes
 * its HTML into) has no site URL of its own, but it inherits its creator's
 * origin, so the nearest same-origin ancestor is readable and is the real
 * site. Returns null when no such ancestor exists (fail closed).
 * @param {Window} win
 * @returns {string|null}
 */
export function resolveSiteUrl(win) {
  const ownHref = win.location.href;
  if (win.location.protocol !== 'about:') {
    return ownHref;
  }
  let current = win;
  for (let depth = 0; depth < 32 && current.parent && current.parent !== current; depth++) {
    current = current.parent;
    let href;
    try {
      href = current.location.href;
    } catch {
      // Cross-origin ancestor: an inherited about: frame is never created
      // by one of these, so there is nothing trustworthy left to read.
      return null;
    }
    if (typeof href === 'string' && href && !/^about:/i.test(href)) {
      return href;
    }
  }
  return null;
}

/**
 * @param {string} url
 * @returns {string} hostname without a leading www.
 */
function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return location.hostname.replace(/^www\./, '');
  }
}

let bridgeInitialized = false;

/**
 * Root-element listeners that survive a document.open() rewrite. The
 * rewrite replaces the root element and erases every listener on it, so
 * handlers are kept here and rebound whenever the root changes. Dispatch
 * always targets the current root for the same reason.
 */
const rootHandlers = [];
let boundRoot = null;

function bindRoot() {
  const root = document.documentElement;
  if (!root || root === boundRoot) {
    return;
  }
  boundRoot = root;
  for (const { type, handler } of rootHandlers) {
    root.addEventListener(type, handler);
  }
}

function onRoot(type, handler) {
  rootHandlers.push({ type, handler });
  if (boundRoot === document.documentElement && boundRoot) {
    boundRoot.addEventListener(type, handler);
  } else {
    bindRoot();
  }
}

function offRoot(type, handler) {
  const idx = rootHandlers.findIndex((h) => h.type === type && h.handler === handler);
  if (idx !== -1) {
    rootHandlers.splice(idx, 1);
  }
  boundRoot?.removeEventListener(type, handler);
}

function dispatch(type, detail) {
  document.documentElement?.dispatchEvent(new CustomEvent(type, { detail }));
}

function dispatchAbort() {
  dispatch('VSC_SETTINGS_READY', { abort: true });
}

function init() {
  try {
    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    if (typeof MutationObserver === 'function') {
      new MutationObserver(bindRoot).observe(document, { childList: true });
    }

    let disabledForDocument = false;
    let bridgeActive = false;

    // Start the read without awaiting it. The request listener is installed in
    // this same task, so MAIN cannot fire into the old listener-free window.
    const settingsReady = chrome.storage.sync.get(null).catch((error) => {
      console.error('[VSC] Initial settings load failed:', error);
      return null;
    });

    // Answer every request, not just the first: after a rewrite the page
    // world may be injected again and ask anew.
    onRoot('VSC_REQUEST_SETTINGS', async () => {
      const settings = await settingsReady;
      if (!settings) {
        dispatchAbort();
        return;
      }

      // Resolved per request: a frame that starts as about:blank takes its
      // creator's URL once the parent has written into it.
      const siteUrl = resolveSiteUrl(window);
      if (!siteUrl) {
        dispatchAbort();
        return;
      }
      const siteHostname = hostnameOf(siteUrl);

      // Legacy blacklist is consulted only before migration creates siteRules.
      const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, siteUrl);
      const siteRuleMatch = matchSiteRule(settings.siteRules, siteUrl);
      const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
      if (disabledForDocument || settings.enabled === false || blacklisted || siteDisabled) {
        dispatchAbort();
        return;
      }

      const publicSettings = { ...settings };
      delete publicSettings.blacklist;
      delete publicSettings.enabled;
      bridgeActive = true;
      dispatch('VSC_SETTINGS_READY', {
        settings: publicSettings,
        hostname: siteHostname,
      });
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      const enabledChange = changes.enabled;
      if (enabledChange?.oldValue === false || enabledChange?.newValue === false) {
        // Any disabled state makes this document reload-only from here on.
        disabledForDocument = true;
      }
      if (enabledChange?.newValue === false) {
        bridgeActive = false;
        dispatch('VSC_MESSAGE', { type: 'VSC_TEARDOWN' });
        return;
      }
      if (!bridgeActive) {
        return;
      }

      const relayChanges = { ...changes };
      delete relayChanges.enabled;
      delete relayChanges.blacklist;
      if (Object.keys(relayChanges).length > 0) {
        dispatch('VSC_STORAGE_CHANGED', relayChanges);
      }
    });

    chrome.runtime.onMessage.addListener((request) => {
      if (bridgeActive) {
        dispatch('VSC_MESSAGE', request);
      }
    });

    const handleWriteStorage = (e) => {
      try {
        if (!bridgeActive) {
          return;
        }

        const data = e.detail;
        if (!data || typeof data !== 'object') {
          return;
        }

        // Only lastSpeed can cross from MAIN into extension storage.
        if ('lastSpeed' in data) {
          const speed = data.lastSpeed;
          if (typeof speed === 'number' && Number.isFinite(speed)) {
            chrome.storage.sync.set({
              lastSpeed: Math.min(Math.max(speed, SPEED_MIN), SPEED_MAX),
            });
          }
        }
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          offRoot('VSC_WRITE_STORAGE', handleWriteStorage);
        }
      }
    };
    onRoot('VSC_WRITE_STORAGE', handleWriteStorage);

    // Shortcut pressed in a frame without media: ask the background worker to
    // relay it to every other frame of this tab (cross-origin embeds).
    const handleForwardKey = (e) => {
      try {
        if (!bridgeActive) {
          return;
        }
        const key = e.detail;
        if (!key || typeof key !== 'object' || typeof key.code !== 'string') {
          return;
        }
        chrome.runtime.sendMessage({
          type: 'VSC_FORWARD_KEY',
          key: {
            code: key.code,
            key: typeof key.key === 'string' ? key.key : '',
            keyCode: typeof key.keyCode === 'number' ? key.keyCode : 0,
            ctrlKey: !!key.ctrlKey,
            altKey: !!key.altKey,
            metaKey: !!key.metaKey,
            shiftKey: !!key.shiftKey,
          },
        });
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          offRoot('VSC_FORWARD_KEY', handleForwardKey);
        }
      }
    };
    onRoot('VSC_FORWARD_KEY', handleForwardKey);
  } catch (error) {
    console.error('[VSC] Bridge init failed:', error);
  }
}

init();
