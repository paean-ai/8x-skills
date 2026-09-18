/*
 * platform-local.js — local stand-in for the Paean host, for works that call the
 * host unconditionally.
 *
 * Only needed when the work does NOT guard its host access. Check first:
 *
 *   guarded   →  `typeof PaeanSDK !== 'undefined' ? ... : null`
 *                `typeof createPaeanPlatform === 'function'`      → no stub needed,
 *                just drop the SDK <script> tags.
 *   unguarded →  `createPaeanPlatform({...})` at module top level, or a bare read of
 *                `PaeanSDK.something`                              → you need this file.
 *
 * Both unguarded forms throw a ReferenceError on the boot path, and because the boot
 * path is one long top-level sequence the rest of the module never runs: the page
 * renders normally and every button is dead, with no error visible to the player.
 *
 * Import this FIRST from the entry module, before anything that touches the host.
 *
 * Deliberately NOT exported: watchAd / iap / room-join style capabilities. Works
 * commonly feature-detect them (`typeof platform.watchAd === 'function'`) to decide
 * whether to render an ad slot, an IAP button or a "join lobby" entry. Handing back an
 * empty function tells the UI the capability exists, so the control renders and does
 * nothing — one real work even lit a fake LIVE badge without checking the return value.
 * Leaving them undefined is the correct degradation.
 */
const NS = 'minitool';

function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

export function createLocalPlatform(opts) {
  const o = opts || {};
  const key = (o.storageNamespace || NS) + '.' + (o.saveKey || 'save');
  let dirty = false, timer = 0;
  const state = { mode: 'local', authed: false, name: '', userKey: null, lbGranted: false };

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    try { lsSet(key, JSON.stringify(o.getLocalSave ? o.getLocalSave() : {})); } catch (e) {}
  };

  return {
    init() {
      const raw = lsGet(key);
      if (raw && o.applySave) { try { o.applySave(JSON.parse(raw)); } catch (e) {} }
      if (o.onState) o.onState(state);
      try {
        document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
        window.addEventListener('pagehide', flush);
      } catch (e) {}
    },
    markDirty() { dirty = true; clearTimeout(timer); timer = setTimeout(flush, 600); },
    save() { dirty = true; flush(); },
    /* Not connected: the work should show its own "saved on this device" copy. */
    connect() { return Promise.resolve(false); },
    connectLeaderboard() { return Promise.resolve(false); },
    /* null tells the caller to fall back to its local-best panel. */
    getLeaderboard(limit, cb) { if (typeof cb === 'function') cb(null); return Promise.resolve(null); },
    submitScore() { return Promise.resolve(false); },
    /* No paywall offline — let the player straight in. */
    requireAccess() { return Promise.resolve({ unlocked: true, reason: 'free-local', status: {} }); },
    openShell() {},
    state,
  };
}

/* Some works read `PaeanSDK.*` without a guard even though `hosted` is false everywhere.
   Give the namespace a complete shape so those bare reads do not throw; every real call
   site stays unreachable because isAvailable() is false. */
export function installLocalHost() {
  if (typeof window === 'undefined') return;
  if (typeof window.createPaeanPlatform !== 'function') window.createPaeanPlatform = createLocalPlatform;
  if (typeof window.PaeanSDK === 'undefined') {
    window.PaeanSDK = {
      isAvailable: () => false,
      detect: () => ({ reason: 'not-in-paean' }),
      ready: () => Promise.reject(new Error('offline')),
      auth: { has: () => false, ensure: () => Promise.resolve(false) },
      host: {},
      leaderboard: { submitScore: () => Promise.reject(new Error('offline')), get: () => Promise.reject(new Error('offline')) },
      shared: { get: () => Promise.reject(new Error('offline')), put: () => Promise.reject(new Error('offline')) },
      room: { state: null },
      share: () => Promise.reject(new Error('offline')),
      ai: null,
    };
  }
}

installLocalHost();
