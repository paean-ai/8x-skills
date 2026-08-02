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
    me: opts.me || { userKey: 'me', displayName: 'Tester' }
  };
  // Serialize the factory + config into an init script string.
  return '(' + mockBridgeFactory.toString() + ')(' + JSON.stringify(cfg) + ');';
}

// Runs INSIDE the page. Kept as a standalone function so it serializes cleanly.
function mockBridgeFactory(cfg) {
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
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mockBridgeSource: mockBridgeSource };
