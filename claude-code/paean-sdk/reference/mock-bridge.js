/*
 * mock-bridge.js — an injectable fake `window.paean` for testing a Paean app's
 * cloud-save / leaderboard integration OFFLINE, without a real host or account.
 *
 * It speaks the same method surface the real host bridge exposes to your app
 * (auth / storage / leaderboard / account) and lets you reproduce the tricky
 * cases that only ever show up on a real device:
 *
 *   - partial scope grants (host serves storage but not leaderboard)
 *   - a scope request the host rejects wholesale
 *   - the two "missing save" shapes (rejected "key not found" vs resolved null)
 *   - the two "storage.get" return shapes (entry wrapper vs bare value)
 *
 * Usage with Playwright (inject BEFORE your page scripts run):
 *
 *   await page.addInitScript(mockBridgeSource({ grant: ['storage.kv','account.profile'] }));
 *   await page.goto(APP_URL);
 *
 * `mockBridgeSource(opts)` returns a STRING you pass to addInitScript. Options:
 *   grant:        scopes already granted before the app asks (default: none)
 *   grantExcept:  scopes to withhold even when requested (e.g. simulate iOS
 *                 having no leaderboard) — default: []
 *   throwOnScope: scopes whose presence makes auth.request() throw wholesale
 *   returnBare:   storage.get returns the bare value instead of {value} wrapper
 *   missingAsNull: storage.get for an absent key resolves null instead of
 *                 rejecting "key not found" (both are real host behaviors)
 *   seed:         { [key]: value } initial KV store contents
 *   board:        [{ name, score, userKey, picture }] initial leaderboard rows
 *   me:           { userKey, displayName } the signed-in player
 *   chrome:       simulate the host capsule + safe areas so you can SEE whether
 *                 your HUD collides with them. `true` uses iPhone-with-island
 *                 defaults; or pass {capsule:{top,right,width,height}, safeArea:
 *                 {top,right,bottom,left}}. Default false — a plain browser
 *                 sets none of these, which is exactly why a layout can look
 *                 fine locally and land under the capsule on a real device.
 *
 *                 Both channels of the contract are published, exactly as the
 *                 player publishes them: the `--paean-chrome-*` /`--paean-safe-*`
 *                 custom properties AND `window.paean.chromeRect()` /
 *                 `.safeArea()` + the `paeanchromechange` event.
 *
 *                 `right`/`bottom` are DISTANCES FROM THE VIEWPORT EDGE, and
 *                 `left`/`bottom` are derived from the live viewport (the host
 *                 derives them the same way) — so give the page a phone-shaped
 *                 viewport or the fake capsule floats in a desktop window and
 *                 collides with nothing:
 *                   await page.setViewportSize({ width: 393, height: 852 });
 *                 Re-publish after a simulated rotation with
 *                 `window.__mock.setChrome(spec)`; a plain resize re-derives
 *                 and fires `paeanchromechange` on its own.
 */
function mockBridgeSource(opts) {
  opts = opts || {};
  var cfg = {
    grant: opts.grant || [],
    grantExcept: opts.grantExcept || [],
    throwOnScope: opts.throwOnScope || [],
    returnBare: !!opts.returnBare,
    missingAsNull: !!opts.missingAsNull,
    seed: opts.seed || {},
    board: opts.board || [],
    me: opts.me || { userKey: 'me', displayName: 'Tester' },
    // Anchored to the top-right edge + a device's insets, NOT to absolute
    // coordinates: the factory resolves them against the real viewport.
    chrome: opts.chrome === true
      ? { capsule: { top: 65, right: 16, width: 78, height: 30 },
          safeArea: { top: 59, right: 0, bottom: 34, left: 0 } }
      : (opts.chrome || null)
  };
  // Serialize the factory + config into an init script string.
  return '(' + mockBridgeFactory.toString() + ')(' + JSON.stringify(cfg) + ');';
}

// Runs INSIDE the page. Kept as a standalone function so it serializes cleanly.
function mockBridgeFactory(cfg) {
  // ── Host chrome ──────────────────────────────────────────────────────────
  // Publish the contract the real player injects, on BOTH of its channels, so
  // a HUD that ignores it collides HERE instead of only on device.
  //
  // `right`/`bottom` are distances from the viewport edge and `left`/`bottom`
  // are derived from the live viewport — the same derivation the host does.
  // Hardcoding them would only be self-consistent at one window size, which is
  // how a mock ends up blessing a layout the device rejects.
  var CK = ['top', 'right', 'bottom', 'left', 'width', 'height'];
  var SK = ['top', 'right', 'bottom', 'left'];
  var chromeSpec = cfg.chrome || null;
  var chromeState = null;

  function copy(v) { return v ? JSON.parse(JSON.stringify(v)) : null; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  function resolveChrome(spec) {
    if (!spec) return null;
    var c = spec.capsule || {}, a = spec.safeArea || {};
    var W = window.innerWidth || 0, H = window.innerHeight || 0;
    var top = num(c.top), width = num(c.width), height = num(c.height);
    // Anchor from whichever edge was given; derive the opposite one.
    var left = c.left != null ? num(c.left) : Math.max(0, W - num(c.right) - width);
    return {
      chrome: { top: top, right: Math.max(0, W - left - width),
                bottom: Math.max(0, H - top - height), left: left,
                width: width, height: height },
      safeArea: { top: num(a.top), right: num(a.right), bottom: num(a.bottom), left: num(a.left) }
    };
  }

  // `silent` matches the host: the initial apply doesn't fire the event, every
  // later move does.
  function publishChrome(spec, silent) {
    chromeSpec = spec || null;
    chromeState = resolveChrome(chromeSpec);
    var el = document.documentElement, s = el && el.style; // may be absent at document start
    if (s) {
      if (chromeState) {
        CK.forEach(function (k) { s.setProperty('--paean-chrome-' + k, chromeState.chrome[k] + 'px'); });
        s.setProperty('--paean-chrome-inset-top',
                      (chromeState.chrome.top + chromeState.chrome.height) + 'px');
        SK.forEach(function (k) { s.setProperty('--paean-safe-' + k, chromeState.safeArea[k] + 'px'); });
      } else {
        CK.forEach(function (k) { s.removeProperty('--paean-chrome-' + k); });
        s.removeProperty('--paean-chrome-inset-top');
        SK.forEach(function (k) { s.removeProperty('--paean-safe-' + k); });
      }
    }
    if (silent) return;
    try {
      window.dispatchEvent(new CustomEvent('paeanchromechange',
        { detail: { chrome: copy(chromeState && chromeState.chrome),
                    safeArea: copy(chromeState && chromeState.safeArea) } }));
    } catch (e) {}
  }

  var granted = {};
  (cfg.grant || []).forEach(function (s) { granted[s] = true; });
  var store = {};
  Object.keys(cfg.seed || {}).forEach(function (k) { store[k] = cfg.seed[k]; });
  var rows = (cfg.board || []).map(function (r) {
    return { userKey: r.userKey, displayName: r.name || r.displayName || 'Player',
             score: r.score, userPicture: r.picture || null, metadata: r.metadata || null };
  });
  window.__mock = { store: store, rows: rows, requests: [] };

  function rank(score) { var h = 0; rows.forEach(function (r) { if (r.score > score) h++; }); return h + 1; }
  function decorate(r) {
    return { rank: rank(r.score), userKey: r.userKey, userName: r.displayName,
             userPicture: r.userPicture || null, score: r.score, metadata: r.metadata || null,
             isSelf: r.userKey === cfg.me.userKey };
  }

  window.paean = {
    __v: 1,
    // The JS half of the host-chrome contract. Null until `chrome` is
    // configured, exactly as the host reports null before it has a layout.
    chromeRect: function () { return chromeState ? copy(chromeState.chrome) : null; },
    safeArea: function () { return chromeState ? copy(chromeState.safeArea) : null; },
    auth: {
      status: function () { return Promise.resolve({ scopes: Object.keys(granted) }); },
      request: function (scopes) {
        window.__mock.requests.push(scopes || []);
        if ((scopes || []).some(function (s) { return cfg.throwOnScope.indexOf(s) >= 0; })) {
          return Promise.reject(new Error('unknown scope'));
        }
        (scopes || []).forEach(function (s) { if (cfg.grantExcept.indexOf(s) < 0) granted[s] = true; });
        return Promise.resolve({ scopes: Object.keys(granted) });
      },
      hasPermission: function (s) { return !!granted[s]; },
      onChange: function () { return function () {}; }
    },
    storage: {
      get: function (key) {
        if (!(key in window.__mock.store)) {
          return cfg.missingAsNull ? Promise.resolve(null)
                                   : Promise.reject(new Error('key not found'));
        }
        var val = window.__mock.store[key];
        return Promise.resolve(cfg.returnBare ? val
          : { key: key, value: val, sizeBytes: JSON.stringify(val).length,
              updatedAt: new Date(0).toISOString() });
      },
      put: function (key, value) {
        window.__mock.store[key] = value;
        return Promise.resolve({ key: key, value: value });
      },
      'delete': function (key) { delete window.__mock.store[key]; return Promise.resolve({ deleted: true }); },
      list: function () {
        return Promise.resolve({ items: Object.keys(window.__mock.store).map(function (k) {
          return { key: k, value: window.__mock.store[k] }; }) });
      }
    },
    leaderboard: {
      submitScore: function (board, score, o) {
        o = o || {};
        var row = rows.filter(function (r) { return r.userKey === cfg.me.userKey; })[0];
        var updated = false;
        if (!row) { rows.push({ userKey: cfg.me.userKey, displayName: cfg.me.displayName,
          score: score, userPicture: null, metadata: o.metadata || null }); updated = true; }
        else if (o.force || score > row.score) { row.score = score; row.metadata = o.metadata || null; updated = true; }
        var mine = rows.filter(function (r) { return r.userKey === cfg.me.userKey; })[0];
        return Promise.resolve({ rank: rank(mine.score), score: mine.score, updated: updated });
      },
      get: function (board, o) {
        o = o || {};
        var sorted = rows.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, o.limit || 20);
        var mine = rows.filter(function (r) { return r.userKey === cfg.me.userKey; })[0];
        return Promise.resolve({ board: board, total: rows.length,
          entries: sorted.map(decorate), me: mine ? decorate(mine) : null });
      },
      getMyRank: function () {
        var mine = rows.filter(function (r) { return r.userKey === cfg.me.userKey; })[0];
        return Promise.resolve(mine ? decorate(mine) : null);
      },
      deleteMyEntry: function () {
        rows = rows.filter(function (r) { return r.userKey !== cfg.me.userKey; });
        window.__mock.rows = rows; return Promise.resolve({ deleted: true });
      }
    },
    account: {
      profile: function () { return Promise.resolve({ displayName: cfg.me.displayName, userKey: cfg.me.userKey }); }
    }
  };

  // Publish AFTER the bridge exists: if anything here throws, the tests fail on
  // the chrome assertion instead of on a mysteriously undefined `window.paean`.
  window.__mock.setChrome = function (spec) { publishChrome(spec === undefined ? chromeSpec : spec); };
  publishChrome(chromeSpec, true);
  // <html> may not exist yet at document start, and the derived edges move with
  // the viewport — re-publish on both, as the host does on rotation.
  document.addEventListener('DOMContentLoaded', function () { publishChrome(chromeSpec, true); });
  window.addEventListener('resize', function () { publishChrome(chromeSpec); });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mockBridgeSource: mockBridgeSource };
