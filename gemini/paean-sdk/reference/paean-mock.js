/*!
 * paean-mock.js — the Paean SDK MOCK HOST for local development and tests.
 * v1.10.0 · matches paean-sdk.js 1.10.0 · no dependencies · MIT
 *
 * A complete fake `window.paean` bridge (every namespace the real hosts
 * expose: auth, ai, agent, usage, storage, shared, leaderboard, app, account,
 * ads, pay, room + room.state, access, share, host chrome, feed preview) that
 * behaves like the platform — including the awkward parts a real device would
 * surprise you with — so an app can prove its SDK integration and its consent
 * discipline offline, before publishing. It never talks to a network.
 *
 * TWO WAYS TO USE IT
 *
 *   A) While developing, in the browser (no tooling):
 *        <script src="paean-mock.js"></script>   <!-- BEFORE paean-sdk.js -->
 *        <script src="paean-sdk.js"></script>
 *      It stays dormant unless the page URL carries `?mock=1` (or the page set
 *      `window.PAEAN_MOCK = { … }` before this script ran). Knobs are query
 *      params, e.g. `?mock=1&preview=1&tapin=1500&access=paid:100&decline=1`.
 *      Remove the tag before publishing (the publish skill's `.clideignore`
 *      also excludes it by name).
 *
 *   B) In Playwright / Node tests:
 *        const { mockBridgeSource } = require('./paean-mock.js');
 *        await page.addInitScript(mockBridgeSource({ access: { model: 'paid', price: 100 } }));
 *      (`mockBridgeSource` returns a string; the config below is the same.)
 *
 * WHAT YOU CAN INSPECT (window.__paeanMock, also aliased as window.__mock)
 *   calls            every bridge call: [{ method, params, at, gesture }]
 *   requests         every auth.request scope list, in order
 *   accessRequests   every access.require sku
 *   shares           every share() payload
 *   grants           scopes currently granted (object)
 *   store / shared / rows      KV, shared KV (with versions), leaderboard rows
 *   room             { members, state, log }
 *   violations       strict-mode findings: consent asked with no user gesture,
 *                    consent or purchase asked during preview, etc.
 *   enterInteractive()         preview → interactive (installs the bridge, fires paean:interactive)
 *   setChrome(spec)            re-publish the host capsule / safe areas
 *   grant(scopes) / revoke()   change consent from the console
 *   reset()                    clear state
 *
 * CONFIG (object for B, query params for A — same names)
 *   grant: []            scopes already granted before the app asks
 *   grantExcept: []      scopes withheld even when requested (partial grant)
 *   throwOnScope: []     scopes whose presence rejects auth.request wholesale
 *   deny: []             alias of grantExcept (query: deny=a,b)
 *   without: []          namespaces the host "does not have": ads, pay, room,
 *                        room.state, room.list, shared, app, account,
 *                        leaderboard, leaderboard.stats, storage, access, share
 *   preview: false       boot as an immersive-feed preview (no bridge until
 *                        enterInteractive / `tapin` ms)
 *   tapin: 0             ms after load to auto-enter interactive play (0 = never)
 *   access:              { model: 'free'|'paid', price, owned, owns: [], products: [],
 *                          decline, standalone, viewer } — query: access=paid:100
 *                          plus owned=1 / decline=1
 *   strict: false        record violations: consent asked with no trusted user
 *                        gesture in the last 5s, any authorized call or consent
 *                        during preview, spend without idempotencyKey
 *   returnBare: false    storage.get returns the bare value (old-host shape)
 *   missingAsNull: false storage.get on a missing key resolves null instead of
 *                        rejecting "key not found" (both shapes exist)
 *   seed: {}             initial private KV
 *   sharedSeed: {}       initial shared KV
 *   board: []            leaderboard rows [{ name, score, userKey, picture }]
 *   me: { userKey, displayName }
 *   credits: 1000        the player's credit balance (pay.* and access.* debit it)
 *   lag: 0               ms added to every call
 *   flaky: 0             % of calls that fail with a network-ish error
 *   chrome: false|true|{ capsule:{top,right,width,height}, safeArea:{…} }
 *   rooms: { peers: 1, peerDelay: 3500 }  phantom peers that join your rooms
 */
function mockBridgeSource(opts) {
  return '(' + paeanMockFactory.toString() + ')(' + JSON.stringify(normalizeMockConfig(opts || {})) + ');';
}

function normalizeMockConfig(opts) {
  opts = opts || {};
  var list = function (v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string') return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return [];
  };
  var access = opts.access;
  if (typeof access === 'string') {
    // "paid:100" | "paid" | "free"
    var m = /^(paid|free)(?::(\d+))?$/i.exec(access.trim());
    access = m ? { model: m[1].toLowerCase(), price: m[2] ? Number(m[2]) : 100 } : null;
  }
  // Query-string knobs that belong to the access block (`?access=paid:100&owned=1&decline=1&owns=a,b`).
  var flag = function (v) { return v === true || v === '1' || v === 'true'; };
  if (flag(opts.owned) || flag(opts.decline) || opts.owns !== undefined) {
    access = access && typeof access === 'object' ? access : { model: 'free' };
    if (flag(opts.owned)) access.owned = true;
    if (flag(opts.decline)) access.decline = true;
    if (opts.owns !== undefined) access.owns = list(opts.owns);
  }
  return {
    grant: list(opts.grant),
    grantExcept: list(opts.grantExcept).concat(list(opts.deny)),
    throwOnScope: list(opts.throwOnScope),
    without: list(opts.without),
    preview: opts.preview === true || opts.preview === '1',
    tapin: Number(opts.tapin) || 0,
    access: access && typeof access === 'object' ? access : null,
    strict: opts.strict === true || opts.strict === '1',
    returnBare: opts.returnBare === true || opts.returnBare === '1',
    missingAsNull: opts.missingAsNull === true || opts.missingAsNull === '1',
    seed: opts.seed && typeof opts.seed === 'object' ? opts.seed : {},
    sharedSeed: opts.sharedSeed && typeof opts.sharedSeed === 'object' ? opts.sharedSeed : {},
    board: Array.isArray(opts.board) ? opts.board : [],
    me: opts.me || { userKey: 'me', displayName: 'Tester' },
    credits: Number.isFinite(Number(opts.credits)) ? Number(opts.credits) : 1000,
    lag: Number(opts.lag) || 0,
    flaky: Number(opts.flaky) || 0,
    chrome: opts.chrome === true || opts.chrome === '1'
      ? { capsule: { top: 65, right: 16, width: 78, height: 30 }, safeArea: { top: 59, right: 0, bottom: 34, left: 0 } }
      : (opts.chrome && typeof opts.chrome === 'object' ? opts.chrome : null),
    rooms: opts.rooms && typeof opts.rooms === 'object' ? opts.rooms : { peers: 1, peerDelay: 3500 }
  };
}

// Runs INSIDE the page. Self-contained on purpose: it is serialized with
// toString() for addInitScript, so it must not reference anything outside.
function paeanMockFactory(cfg) {
  if (typeof window === 'undefined') return;
  if (window.__paeanMock && window.__paeanMock.installed) return;

  // ── knobs ───────────────────────────────────────────────────────────────
  var without = {};
  (cfg.without || []).forEach(function (n) { without[n] = true; });
  function has(ns) { return !without[ns]; }
  var SCOPES = ['ai.chat', 'ai.image', 'ai.tts', 'ai.asr', 'agent.chat', 'storage.kv', 'storage.leaderboard',
    'storage.stats', 'storage.shared.read', 'storage.shared.write', 'account.profile', 'ads.rewarded', 'net.room', 'pay.spend'];
  var ALIASES = { chat: 'ai.chat', image: 'ai.image', tts: 'ai.tts', asr: 'ai.asr', agent: 'agent.chat', storage: 'storage.kv',
    kv: 'storage.kv', leaderboard: 'storage.leaderboard', stats: 'storage.stats', shared: 'storage.shared.read',
    'shared.write': 'storage.shared.write', profile: 'account.profile', ads: 'ads.rewarded', room: 'net.room', pay: 'pay.spend', iap: 'pay.spend' };
  function canonical(s) { s = String(s || ''); return SCOPES.indexOf(s) >= 0 ? s : (ALIASES[s] || null); }

  // ── state ───────────────────────────────────────────────────────────────
  var M = window.__paeanMock = window.__mock = {
    installed: true, config: cfg, calls: [], requests: [], accessRequests: [], shares: [], violations: [],
    grants: {}, store: {}, shared: {}, rows: [], receipts: {}, credits: cfg.credits,
    room: { code: null, members: [], state: { shared: {}, members: {} }, version: 0, log: [] },
    interactive: !cfg.preview, preview: !!cfg.preview
  };
  (cfg.grant || []).forEach(function (s) { var c = canonical(s); if (c) M.grants[c] = true; });
  Object.keys(cfg.seed || {}).forEach(function (k) { M.store[k] = cfg.seed[k]; });
  Object.keys(cfg.sharedSeed || {}).forEach(function (k) { M.shared[k] = { value: cfg.sharedSeed[k], version: 1, updatedAt: new Date(0).toISOString() }; });
  M.rows = (cfg.board || []).map(function (r) {
    return { userKey: r.userKey, displayName: r.name || r.displayName || 'Player', score: Number(r.score) || 0,
             userPicture: r.picture || null, metadata: r.metadata || null };
  });
  var owned = {};
  var acc = cfg.access || { model: 'free' };
  (acc.owns || []).forEach(function (k) { owned[k] = true; });
  if (acc.owned) owned.app = true;

  // ── helpers ─────────────────────────────────────────────────────────────
  var lastGesture = 0;
  ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'].forEach(function (t) {
    window.addEventListener(t, function (e) { if (!e || e.isTrusted !== false) lastGesture = Date.now(); }, true);
  });
  function recentGesture() { return Date.now() - lastGesture < 5000; }
  function violation(kind, detail) {
    var v = { kind: kind, detail: detail || null, at: Date.now() };
    M.violations.push(v);
    try { console.warn('[paean-mock] ' + kind + (detail ? ' ' + JSON.stringify(detail) : '')); } catch (e) {}
  }
  function err(code, message, detail) {
    var e = new Error(message || code);
    e.code = code;
    if (detail) e.detail = detail;
    return e;
  }
  function delay(v) { return cfg.lag ? new Promise(function (r) { setTimeout(function () { r(v); }, cfg.lag); }) : Promise.resolve(v); }
  function call(method, params, fn) {
    M.calls.push({ method: method, params: params, at: Date.now(), gesture: recentGesture(), preview: !M.interactive });
    if (cfg.strict && !M.interactive && method !== 'auth.status' && method !== 'access.status') {
      violation('call-during-preview', { method: method });
    }
    if (cfg.flaky && Math.random() * 100 < cfg.flaky) return delay(null).then(function () { throw err('network', 'mock: simulated network failure'); });
    return delay(null).then(fn);
  }
  function requireScope(scope, method) {
    if (!M.grants[scope]) throw err('not_authorized', 'Not authorized for ' + scope + '. Call paean.auth.request first.');
    if (isPaidApp() && !owned.app && method.indexOf('auth.') !== 0) {
      throw err('APP_NOT_OWNED', 'This app must be purchased before it can be used', { price: price() });
    }
  }
  function copy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function bytes(v) { try { return JSON.stringify(v).length; } catch (e) { return 0; } }
  function rid() { return Math.random().toString(36).slice(2, 10); }
  function rejectingIterable(e) {
    var o = {}; o[Symbol.asyncIterator] = function () { return { next: function () { return Promise.reject(e); }, 'return': function () { return Promise.resolve({ done: true }); } }; }; return o;
  }
  function asyncIterable(items, tick) {
    var i = 0;
    var it = { next: function () {
      if (i >= items.length) return Promise.resolve({ value: undefined, done: true });
      var v = items[i++];
      return new Promise(function (res) { setTimeout(function () { res({ value: v, done: false }); }, tick || 20); });
    }, 'return': function () { i = items.length; return Promise.resolve({ value: undefined, done: true }); } };
    var obj = {}; obj[Symbol.asyncIterator] = function () { return it; }; return obj;
  }

  // ── access (paid apps) ──────────────────────────────────────────────────
  function isPaidApp() { return acc.model === 'paid'; }
  function price() { return isPaidApp() ? { amount: Number(acc.price) || 100, currency: 'credits' } : null; }
  var accessListeners = [];
  function accessStatus() {
    return {
      hashKey: 'mockapp', title: 'Mock App',
      access: { model: isPaidApp() ? 'paid' : 'free', price: price(),
                standalone: acc.standalone || (isPaidApp() ? 'demo' : 'allow'),
                products: (acc.products || []).map(function (p) { return { sku: p.sku, title: p.title || p.sku, amount: Number(p.amount) || 10, currency: 'credits' }; }) },
      unlocked: !isPaidApp() || !!owned.app,
      viewer: acc.viewer || 'user',
      entitlements: Object.keys(owned).map(function (k) { return { sku: k, source: 'purchase', receipt: 'mock-' + k, grantedAt: new Date(0).toISOString() }; }),
      shellUrl: 'https://mockapp.8x.gg/'
    };
  }
  function emitAccess() { var st = accessStatus(); accessListeners.forEach(function (f) { try { f(st); } catch (e) {} }); }

  // ── host chrome ─────────────────────────────────────────────────────────
  var CK = ['top', 'right', 'bottom', 'left', 'width', 'height'], SK = ['top', 'right', 'bottom', 'left'];
  var chromeSpec = cfg.chrome || null, chromeState = null;
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function resolveChrome(spec) {
    if (!spec) return null;
    var c = spec.capsule || {}, a = spec.safeArea || {};
    var W = window.innerWidth || 0, H = window.innerHeight || 0;
    var top = num(c.top), width = num(c.width), height = num(c.height);
    var left = c.left != null ? num(c.left) : Math.max(0, W - num(c.right) - width);
    return { chrome: { top: top, right: Math.max(0, W - left - width), bottom: Math.max(0, H - top - height), left: left, width: width, height: height },
             safeArea: { top: num(a.top), right: num(a.right), bottom: num(a.bottom), left: num(a.left) } };
  }
  function publishChrome(spec, silent) {
    chromeSpec = spec || null; chromeState = resolveChrome(chromeSpec);
    var s = document.documentElement && document.documentElement.style;
    if (s) {
      if (chromeState) {
        CK.forEach(function (k) { s.setProperty('--paean-chrome-' + k, chromeState.chrome[k] + 'px'); });
        s.setProperty('--paean-chrome-inset-top', (chromeState.chrome.top + chromeState.chrome.height) + 'px');
        SK.forEach(function (k) { s.setProperty('--paean-safe-' + k, chromeState.safeArea[k] + 'px'); });
      } else {
        CK.forEach(function (k) { s.removeProperty('--paean-chrome-' + k); });
        s.removeProperty('--paean-chrome-inset-top');
        SK.forEach(function (k) { s.removeProperty('--paean-safe-' + k); });
      }
    }
    if (silent) return;
    try { window.dispatchEvent(new CustomEvent('paeanchromechange', { detail: { chrome: copy(chromeState && chromeState.chrome), safeArea: copy(chromeState && chromeState.safeArea) } })); } catch (e) {}
  }

  // ── leaderboard helpers ─────────────────────────────────────────────────
  function rankOf(score) { var h = 0; M.rows.forEach(function (r) { if (r.score > score) h++; }); return h + 1; }
  function decorate(r) {
    return { rank: rankOf(r.score), userKey: r.userKey, userName: r.displayName, userPicture: r.userPicture || null,
             score: r.score, metadata: r.metadata || null, isSelf: r.userKey === cfg.me.userKey };
  }
  function mine() { return M.rows.filter(function (r) { return r.userKey === cfg.me.userKey; })[0] || null; }

  // ── room helpers ────────────────────────────────────────────────────────
  var roomListeners = { message: [], member: [], closed: [], resync: [], state: [], error: [] };
  var selfMember = { memberId: 'm-' + rid(), orderIndex: 0, isHost: true, profile: null };
  function roomEmit(kind, data) { M.room.log.push({ event: 'room.' + kind, data: data }); (roomListeners[kind] || []).forEach(function (f) { try { f(data); } catch (e) {} }); }
  var CODE_RE = /^[A-HJ-NP-Z2-9]{1,6}$/;
  function inRoom(code) { if (!M.room.code || (code && code !== M.room.code)) throw err('not_in_room', 'not in room'); }
  var roomSeq = 0;
  function bumpState(patch) {
    M.room.version += 1;
    var delta = { code: M.room.code, version: M.room.version, ts: Date.now(), shared: {}, members: {} };
    if (patch.shared) Object.keys(patch.shared).forEach(function (k) {
      if (patch.shared[k] === null) { delete M.room.state.shared[k]; delta.shared[k] = null; }
      else { M.room.state.shared[k] = { v: patch.shared[k], ver: M.room.version, by: selfMember.memberId }; delta.shared[k] = M.room.state.shared[k]; }
    });
    if (patch.self) {
      var slice = M.room.state.members[selfMember.memberId] || (M.room.state.members[selfMember.memberId] = {});
      Object.keys(patch.self).forEach(function (k) { if (patch.self[k] === null) delete slice[k]; else slice[k] = patch.self[k]; });
      delta.members[selfMember.memberId] = copy(slice);
    }
    setTimeout(function () { roomEmit('state', delta); }, 0);
    return M.room.version;
  }

  // ── the bridge ──────────────────────────────────────────────────────────
  function buildBridge() {
    var bridge = {
      __v: 1, __mock: true, __bridgeReady: true, __transport: 'mock',
      chromeRect: function () { return chromeState ? copy(chromeState.chrome) : null; },
      safeArea: function () { return chromeState ? copy(chromeState.safeArea) : null; },

      auth: {
        status: function () { return call('auth.status', {}, function () { return { authorized: Object.keys(M.grants).length > 0, scopes: Object.keys(M.grants), app: { hashKey: 'mockapp', origin: location.origin } }; }); },
        request: function (scopes) {
          scopes = (scopes || []).slice();
          M.requests.push(scopes);
          if (cfg.strict && !recentGesture()) violation('consent-without-gesture', { scopes: scopes });
          if (!M.interactive) violation('consent-during-preview', { scopes: scopes });
          return call('auth.request', { scopes: scopes }, function () {
            if (scopes.some(function (s) { return (cfg.throwOnScope || []).indexOf(s) >= 0; })) throw err('unknown_scope', 'unknown scope');
            scopes.forEach(function (s) { var c = canonical(s); if (c && (cfg.grantExcept || []).indexOf(s) < 0 && (cfg.grantExcept || []).indexOf(c) < 0) M.grants[c] = true; });
            var out = { granted: scopes.every(function (s) { return !!M.grants[canonical(s)]; }), scopes: Object.keys(M.grants) };
            authListeners.forEach(function (f) { try { f({ scopes: out.scopes }); } catch (e) {} });
            return out;
          });
        },
        hasPermission: function (s) { return !!M.grants[canonical(s)]; },
        onChange: function (cb) { authListeners.push(cb); return function () { var i = authListeners.indexOf(cb); if (i >= 0) authListeners.splice(i, 1); }; }
      },

      ai: {
        chat: function (p) {
          p = p || {};
          var text = 'Mock reply to: ' + String(((p.messages || []).slice(-1)[0] || {}).content || '').slice(0, 60);
          if (p.stream) {
            var chunks = text.split(' ').map(function (w, i, a) { return { choices: [{ delta: { content: w + (i < a.length - 1 ? ' ' : '') } }] }; });
            try { requireScope('ai.chat', 'ai.chat'); } catch (e) { return rejectingIterable(e); }
            M.calls.push({ method: 'ai.chat', params: p, at: Date.now(), gesture: recentGesture(), preview: !M.interactive });
            return asyncIterable(chunks.concat([{ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: chunks.length } }]));
          }
          return call('ai.chat', p, function () { requireScope('ai.chat', 'ai.chat'); spend(1); return { id: 'mock-' + rid(), choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8 } }; });
        },
        vision: function (p) { return bridge.ai.chat(p); },
        image: function (p) { return call('ai.image', p, function () { requireScope('ai.image', 'ai.image'); spend(5); return { created: Date.now(), data: [{ url: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#3b82f6"/><text x="16" y="128" fill="#fff" font-size="18">mock image</text></svg>'), revised_prompt: (p && p.prompt) || '' }] }; }); },
        tts: function (p) { return call('ai.tts', p, function () { requireScope('ai.tts', 'ai.tts'); spend(1); return { audio_b64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=', format: 'wav' }; }); },
        asr: function (p) { return call('ai.asr', p, function () { requireScope('ai.asr', 'ai.asr'); spend(1); return { text: 'mock transcript' }; }); }
      },

      agent: {
        run: function (p) {
          p = p || {};
          M.calls.push({ method: 'agent.run', params: p, at: Date.now(), gesture: recentGesture(), preview: !M.interactive });
          try { requireScope('agent.chat', 'agent.run'); } catch (e) { return rejectingIterable(e); }
          var cid = p.conversationId || ('conv-' + rid());
          return asyncIterable([
            { type: 'tool_call', data: { id: 't1', name: 'webSearch', status: 'running' } },
            { type: 'tool_result', data: { id: 't1', name: 'webSearch', status: 'done' } },
            { type: 'content', data: { text: 'Mock agent answer for: ', partial: true } },
            { type: 'content', data: { text: 'Mock agent answer for: ' + String(p.message || '').slice(0, 40), partial: false } },
            { type: 'done', data: { conversationId: cid } }
          ], 40);
        }
      },

      usage: {
        current: function () { return call('usage.current', {}, function () { return usageNow(); }); },
        onUpdate: function (cb) { usageListeners.push(cb); return function () { var i = usageListeners.indexOf(cb); if (i >= 0) usageListeners.splice(i, 1); }; }
      },

      storage: {
        get: function (key) { return call('storage.get', { key: key }, function () {
          requireScope('storage.kv', 'storage.get');
          if (!(key in M.store)) { if (cfg.missingAsNull) return null; throw err('not_found', 'key not found'); }
          var val = M.store[key];
          return cfg.returnBare ? copy(val) : { key: key, value: copy(val), sizeBytes: bytes(val), updatedAt: new Date().toISOString() };
        }); },
        put: function (key, value) { return call('storage.put', { key: key, value: value }, function () { requireScope('storage.kv', 'storage.put'); M.store[key] = copy(value); return { key: key, value: copy(value), sizeBytes: bytes(value), updatedAt: new Date().toISOString() }; }); },
        'delete': function (key) { return call('storage.delete', { key: key }, function () { requireScope('storage.kv', 'storage.delete'); var had = key in M.store; delete M.store[key]; return { deleted: had }; }); },
        list: function (o) { return call('storage.list', o || {}, function () {
          requireScope('storage.kv', 'storage.list');
          var keys = Object.keys(M.store), offset = Number((o || {}).offset) || 0, limit = Number((o || {}).limit) || 50;
          var page = keys.slice(offset, offset + limit).map(function (k) { return { key: k, value: copy(M.store[k]), sizeBytes: bytes(M.store[k]) }; });
          var total = keys.reduce(function (n, k) { return n + bytes(M.store[k]); }, 0);
          return { items: page, usage: { keyCount: keys.length, totalBytes: total, maxKeys: 100, maxTotalBytes: 5242880 }, limit: limit, offset: offset };
        }); }
      },

      shared: {
        get: function (key) { return call('shared.get', { key: key }, function () { requireScope('storage.shared.read', 'shared.get'); var e = M.shared[key]; return e ? { key: key, value: copy(e.value), version: e.version, updatedAt: e.updatedAt } : null; }); },
        put: function (key, value, o) { o = o || {}; return call('shared.put', { key: key, value: value, options: o }, function () {
          requireScope('storage.shared.write', 'shared.put');
          var cur = M.shared[key];
          if (o.ifAbsent && cur) throw err(409, 'key already exists', { version: cur.version });
          if (!o.overwrite && !o.ifAbsent && cur && o.expectedVersion !== undefined && Number(o.expectedVersion) !== cur.version) throw err(409, 'version conflict', { version: cur.version });
          if (!o.overwrite && !o.ifAbsent && cur && o.expectedVersion === undefined) throw err(409, 'expectedVersion required to replace an existing value', { version: cur.version });
          var next = { value: copy(value), version: cur ? cur.version + 1 : 1, updatedAt: new Date().toISOString() };
          M.shared[key] = next;
          return { key: key, value: copy(next.value), version: next.version, updatedAt: next.updatedAt };
        }); },
        'delete': function (key, o) { o = o || {}; return call('shared.delete', { key: key, options: o }, function () {
          requireScope('storage.shared.write', 'shared.delete');
          var cur = M.shared[key];
          if (cur && !o.overwrite && o.expectedVersion !== undefined && Number(o.expectedVersion) !== cur.version) throw err(409, 'version conflict', { version: cur.version });
          delete M.shared[key]; return { deleted: !!cur };
        }); },
        list: function (o) { return call('shared.list', o || {}, function () {
          requireScope('storage.shared.read', 'shared.list');
          var keys = Object.keys(M.shared), offset = Number((o || {}).offset) || 0, limit = Number((o || {}).limit) || 50;
          var items = keys.slice(offset, offset + limit).map(function (k) { return { key: k, value: copy(M.shared[k].value), version: M.shared[k].version, updatedAt: M.shared[k].updatedAt }; });
          return { items: items, total: keys.length, limit: limit, offset: offset, hasMore: offset + items.length < keys.length };
        }); }
      },

      leaderboard: {
        submitScore: function (board, score, o) { o = o || {}; return call('leaderboard.submitScore', { board: board, score: score, options: o }, function () {
          requireScope('storage.leaderboard', 'leaderboard.submitScore');
          score = Number(score);
          var row = mine(), updated = false;
          if (!row) { M.rows.push({ userKey: cfg.me.userKey, displayName: cfg.me.displayName, score: score, userPicture: null, metadata: o.metadata || null }); updated = true; }
          else if (o.force || score > row.score) { row.score = score; row.metadata = o.metadata || null; updated = true; }
          var m = mine(); return { rank: rankOf(m.score), score: m.score, updated: updated };
        }); },
        get: function (board, o) { o = o || {}; return call('leaderboard.get', { board: board, options: o }, function () {
          requireScope('storage.leaderboard', 'leaderboard.get');
          var sorted = M.rows.slice().sort(function (a, b) { return b.score - a.score; });
          var offset = Number(o.offset) || 0, limit = Number(o.limit) || 20;
          var page = sorted.slice(offset, offset + limit).map(decorate);
          var m = mine();
          return { board: board, total: M.rows.length, entries: page, me: m ? decorate(m) : null, limit: limit, offset: offset, hasMore: offset + page.length < M.rows.length };
        }); },
        getMyRank: function (board) { return call('leaderboard.getMyRank', { board: board }, function () { requireScope('storage.leaderboard', 'leaderboard.getMyRank'); var m = mine(); return m ? decorate(m) : null; }); },
        deleteMyEntry: function (board) { return call('leaderboard.deleteMyEntry', { board: board }, function () { requireScope('storage.leaderboard', 'leaderboard.deleteMyEntry'); var had = !!mine(); M.rows = M.rows.filter(function (r) { return r.userKey !== cfg.me.userKey; }); return { deleted: had }; }); },
        stats: function (board) { return call('leaderboard.stats', { board: board }, function () {
          requireScope('storage.stats', 'leaderboard.stats');
          var s = M.rows.map(function (r) { return r.score; });
          var sum = s.reduce(function (a, b) { return a + b; }, 0);
          return { board: board, count: s.length, sum: sum, average: s.length ? sum / s.length : 0, min: s.length ? Math.min.apply(null, s) : 0, max: s.length ? Math.max.apply(null, s) : 0 };
        }); }
      },

      app: {
        stats: function () { return call('app.stats', {}, function () { requireScope('storage.stats', 'app.stats'); return { users: 128 + M.rows.length, keys: Object.keys(M.store).length, totalBytes: Object.keys(M.store).reduce(function (n, k) { return n + bytes(M.store[k]); }, 0), sharedKeys: Object.keys(M.shared).length, boards: 1, leaderboardEntries: M.rows.length }; }); }
      },

      account: {
        profile: function () { return call('account.profile', {}, function () { requireScope('account.profile', 'account.profile'); return { appHashKey: 'mockapp', userKey: cfg.me.userKey, displayName: cfg.me.displayName, username: (cfg.me.displayName || 'tester').toLowerCase(), avatar: null }; }); }
      },

      ads: {
        preloadRewarded: function () { return call('ads.rewarded.preload', {}, function () { requireScope('ads.rewarded', 'ads.rewarded.preload'); return { available: true }; }); },
        isRewardedAvailable: function () { return call('ads.rewarded.isAvailable', {}, function () { requireScope('ads.rewarded', 'ads.rewarded.isAvailable'); return { available: true }; }); },
        showRewarded: function (p) { return call('ads.rewarded.show', p || {}, function () {
          requireScope('ads.rewarded', 'ads.rewarded.show');
          if (cfg.strict && !recentGesture()) violation('ad-without-gesture', p || {});
          return new Promise(function (res) { setTimeout(function () { res({ rewarded: !(cfg.access && cfg.access.dismissAd), reward: { type: 'mock', amount: 1 }, cancelled: false }); }, cfg.lag ? 0 : 300); });
        }); }
      },

      pay: {
        quote: function (p) { p = p || {}; return call('pay.quote', p, function () {
          requireScope('pay.spend', 'pay.quote');
          return quote(p.kind || 'spend', p.currency || 'credits', Number(p.amount));
        }); },
        spend: function (p) { p = p || {}; return call('pay.spend', p, function () {
          requireScope('pay.spend', 'pay.spend');
          if (cfg.strict && !p.idempotencyKey) violation('spend-without-idempotency-key', { sku: p.sku });
          if (cfg.strict && !recentGesture()) violation('spend-without-gesture', { sku: p.sku });
          var key = p.idempotencyKey || rid();
          if (M.receipts[key]) return Object.assign({}, M.receipts[key], { granted: true, replayed: true });
          var q = quote('spend', p.currency || 'credits', Number(p.amount));
          if (acc.decline) return { granted: false };
          if ((p.currency || 'credits') === 'credits' && M.credits < q.amount) throw err('INSUFFICIENT_CREDITS', 'insufficient credits', { requiredCredits: q.amount, availableCredits: M.credits, shortfallCredits: q.amount - M.credits });
          spend(q.amount);
          var r = { granted: true, receipt: 'rcpt-' + rid(), status: 'completed', appHashKey: 'mockapp', kind: 'spend', currency: q.currency, amount: q.amount, creatorAmount: q.creatorAmount, sku: p.sku || null, note: p.note || null, createdAt: new Date().toISOString(), replayed: false };
          M.receipts[key] = r; M.receipts[r.receipt] = r;
          return r;
        }); },
        tip: function (p) { p = p || {}; return call('pay.tip', p, function () {
          if (cfg.strict && !recentGesture()) violation('tip-without-gesture', p);
          if (acc.decline) return { tipped: false };
          var amount = Number(p.amount) || 10; spend(amount);
          var r = { tipped: true, amount: amount, currency: 'credits', receipt: 'rcpt-' + rid() };
          M.receipts[r.receipt] = r; return r;
        }); },
        receipt: function (r) { return call('pay.receipt', { receipt: r }, function () { requireScope('pay.spend', 'pay.receipt'); var x = M.receipts[r]; if (!x) throw err(404, 'receipt not found'); return copy(x); }); }
      },

      room: {
        join: function (p) { p = p || {}; return call('room.join', p, function () {
          requireScope('net.room', 'room.join');
          var code = String(p.code || '').toUpperCase();
          if (!CODE_RE.test(code)) throw err('bad_code', 'room code must be 1–6 chars of A–Z 2–9 (no 0 O 1 I)');
          if (M.room.code && M.room.code !== code) throw err('too_many_rooms', 'already in another room');
          if (p.pass !== undefined && !/^\d{6}$/.test(String(p.pass))) throw err('bad_pass', 'pass must be 6 digits');
          M.room.code = code; M.room.members = [selfMember]; M.room.version = 0; M.room.state = { shared: {}, members: {} };
          if (p.profile) selfMember.profile = copy(p.profile);
          var peers = Number((cfg.rooms || {}).peers) || 0, peerDelay = Number((cfg.rooms || {}).peerDelay) || 3500;
          for (var i = 0; i < peers; i++) (function (n) {
            setTimeout(function () {
              if (M.room.code !== code) return;
              var peer = { memberId: 'peer-' + n + '-' + rid(), orderIndex: n + 1, isHost: false, profile: { name: 'Peer ' + (n + 1) } };
              M.room.members.push(peer);
              roomEmit('member', { code: code, change: 'joined', member: copy(peer) });
              setTimeout(function () { if (M.room.code === code) roomEmit('message', { code: code, from: peer.memberId, seq: ++roomSeq, ts: Date.now(), payload: { type: 'hello', from: peer.profile.name } }); }, 600);
            }, peerDelay * (n + 1));
          })(i);
          return { room: { appId: 'mockapp', code: code, maxMembers: Number(p.maxMembers) || 4, createdAt: Date.now() }, self: { memberId: selfMember.memberId, orderIndex: 0, isHost: true }, members: [], lastSeq: roomSeq, state: { version: 0, tickHz: (p.state && p.state.tickHz) || 0, serverTime: Date.now(), shared: {}, members: {} } };
        }); },
        send: function (payload, o) { o = o || {}; return call('room.send', { payload: payload, options: o }, function () {
          requireScope('net.room', 'room.send'); inRoom(o.code);
          if (bytes(payload) > 16384) throw err('payload_too_large', 'payload over 16KB');
          var seq = ++roomSeq; M.room.log.push({ sent: payload, seq: seq });
          return { seq: seq };
        }); },
        leave: function (o) { o = o || {}; return call('room.leave', o, function () { requireScope('net.room', 'room.leave'); var had = !!M.room.code; M.room.code = null; M.room.members = []; return { left: had }; }); },
        peek: function (code) { return call('room.peek', { code: code }, function () { requireScope('net.room', 'room.peek'); var c = String(code || '').toUpperCase(); var exists = M.room.code === c; return { exists: exists, memberCount: exists ? M.room.members.length : 0, maxMembers: 4, hasPassword: false, listed: false }; }); },
        list: function (o) { return call('room.list', o || {}, function () { requireScope('net.room', 'room.list'); return { rooms: M.room.code ? [{ code: M.room.code, memberCount: M.room.members.length, maxMembers: 4, hasPassword: false, createdAt: Date.now() }] : [], total: M.room.code ? 1 : 0 }; }); },
        state: {
          set: function (patch, o) { patch = patch || {}; o = o || {}; return call('room.state.set', { patch: patch, options: o }, function () {
            requireScope('net.room', 'room.state.set'); inRoom(o.code);
            if (patch.expect) {
              var conflicts = {}, bad = false;
              Object.keys(patch.expect).forEach(function (k) { var cur = M.room.state.shared[k]; var ver = cur ? cur.ver : 0; if (Number(patch.expect[k]) !== ver) { bad = true; conflicts[k] = ver; } });
              if (bad) throw err('state_conflict', 'expected version mismatch', { current: conflicts });
            }
            return { version: bumpState(patch) };
          }); },
          get: function (o) { o = o || {}; return call('room.state.get', o, function () { requireScope('net.room', 'room.state.get'); inRoom(o.code); return { version: M.room.version, tickHz: 0, serverTime: Date.now(), shared: copy(M.room.state.shared), members: copy(M.room.state.members) }; }); },
          onChange: function (cb) { roomListeners.state.push(cb); return function () { var i = roomListeners.state.indexOf(cb); if (i >= 0) roomListeners.state.splice(i, 1); }; }
        },
        current: function () { return M.room.code ? [{ code: M.room.code, self: { memberId: selfMember.memberId, orderIndex: 0, isHost: true }, maxMembers: 4 }] : []; },
        onMessage: function (cb) { roomListeners.message.push(cb); return function () { var i = roomListeners.message.indexOf(cb); if (i >= 0) roomListeners.message.splice(i, 1); }; },
        onMember: function (cb) { roomListeners.member.push(cb); return function () { var i = roomListeners.member.indexOf(cb); if (i >= 0) roomListeners.member.splice(i, 1); }; },
        onClosed: function (cb) { roomListeners.closed.push(cb); return function () { var i = roomListeners.closed.indexOf(cb); if (i >= 0) roomListeners.closed.splice(i, 1); }; },
        onResync: function (cb) { roomListeners.resync.push(cb); return function () { var i = roomListeners.resync.indexOf(cb); if (i >= 0) roomListeners.resync.splice(i, 1); }; },
        onError: function (cb) { roomListeners.error.push(cb); return function () { var i = roomListeners.error.indexOf(cb); if (i >= 0) roomListeners.error.splice(i, 1); }; }
      },

      access: {
        status: function () { return call('access.status', {}, function () { return accessStatus(); }); },
        require: function (p) { p = p || {}; var sku = String(p.sku || 'app').toLowerCase(); M.accessRequests.push(sku);
          if (cfg.strict && !recentGesture()) violation('purchase-without-gesture', { sku: sku });
          if (!M.interactive) violation('purchase-during-preview', { sku: sku });
          return call('access.require', { sku: sku }, function () {
            var st = accessStatus();
            if (sku === 'app' && !isPaidApp()) return { unlocked: true, sku: sku, reason: 'free', receipt: null, status: st };
            if (owned[sku]) return { unlocked: true, sku: sku, reason: st.viewer === 'owner' ? 'owner' : 'owned', receipt: 'mock-' + sku, status: st };
            var item = sku === 'app' ? price() : (st.access.products.filter(function (x) { return x.sku === sku; })[0] || null);
            if (!item) return { unlocked: false, sku: sku, reason: 'unknown-sku', receipt: null, status: st };
            if (sku !== 'app' && isPaidApp() && !owned.app) return { unlocked: false, sku: sku, reason: 'APP_NOT_OWNED', receipt: null, status: st };
            if (acc.decline) return { unlocked: false, sku: sku, reason: 'declined', receipt: null, status: st };
            if (M.credits < item.amount) return { unlocked: false, sku: sku, reason: 'INSUFFICIENT_CREDITS', receipt: null, status: st };
            spend(item.amount); owned[sku] = true; emitAccess();
            return { unlocked: true, sku: sku, reason: 'purchased', receipt: 'mock-' + sku, status: accessStatus() };
          });
        },
        current: function () { return accessStatus(); },
        onChange: function (cb) { accessListeners.push(cb); return function () { var i = accessListeners.indexOf(cb); if (i >= 0) accessListeners.splice(i, 1); }; }
      },

      share: function (p) { return call('share', p || {}, function () { M.shares.push(p || {}); return { shared: true, method: 'host' }; }); }
    };

    // Namespaces the host "does not have" (older builds): remove them so the
    // SDK's feature detection and PaeanUnsupportedError paths get exercised.
    if (!has('ads')) delete bridge.ads;
    if (!has('pay')) delete bridge.pay;
    if (!has('room')) delete bridge.room;
    else { if (!has('room.state')) delete bridge.room.state; if (!has('room.list')) delete bridge.room.list; }
    if (!has('shared')) delete bridge.shared;
    if (!has('app')) delete bridge.app;
    if (!has('account')) delete bridge.account;
    if (!has('leaderboard')) delete bridge.leaderboard;
    else if (!has('leaderboard.stats')) delete bridge.leaderboard.stats;
    if (!has('storage')) delete bridge.storage;
    if (!has('access')) delete bridge.access;
    if (!has('share')) delete bridge.share;
    if (!has('agent')) delete bridge.agent;
    return bridge;
  }

  var authListeners = [], usageListeners = [];
  var usage = { callCount: 0, tokensIn: 0, tokensOut: 0, creditsSpent: 0 };
  function usageNow() { return { callCount: usage.callCount, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, creditsSpent: usage.creditsSpent, creditsRemaining: M.credits, creditsTotal: cfg.credits, tier: 'mock' }; }
  function spend(n) { usage.callCount += 1; usage.creditsSpent += n; M.credits -= n; var u = usageNow(); usageListeners.forEach(function (f) { try { f(u); } catch (e) {} }); }
  var LIMITS = { spend: { min: 10, max: 100000 }, tip: { min: 10, max: 1000000 } };
  function quote(kind, currency, amount) {
    if (currency !== 'credits' && currency !== 'usd') throw err(400, "currency must be 'credits' or 'usd'");
    var lim = LIMITS[kind] || LIMITS.spend;
    if (!(amount > 0)) throw err(400, 'amount must be a positive number');
    if (currency === 'credits' && (amount < lim.min || amount > lim.max)) throw err(400, 'credits amount must be between ' + lim.min + ' and ' + lim.max, { minCredits: lim.min, maxCredits: lim.max });
    var platform = Math.ceil(amount * 0.2);
    return { appHashKey: 'mockapp', kind: kind, currency: currency, amount: amount, platformAmount: platform, creatorAmount: amount - platform, upstreamAmount: 0, upstreamPayeeCount: 0, limits: currency === 'credits' ? { min: lim.min, max: lim.max } : { min: 0.1, max: 100 }, rates: { platformFeeBps: 2000, upstreamShareBps: 2000, upstreamLevelShareBps: 8000, maxUpstreamDepth: 5 } };
  }

  // ── install ─────────────────────────────────────────────────────────────
  var bridge = buildBridge();
  function install() {
    if (window.paean && window.paean.__v && !window.paean.__mock) return; // a real host won
    window.paean = bridge;
    M.interactive = true; M.preview = false;
    window.__paeanPreview = false; window.__paeanInteractive = true;
    publishChrome(chromeSpec, true);
    try { window.dispatchEvent(new CustomEvent('paean:interactive', { detail: { interactive: true } })); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('paean:ready')); } catch (e) {}
  }
  M.enterInteractive = install;
  M.setChrome = function (spec) { publishChrome(spec === undefined ? chromeSpec : spec); };
  M.grant = function (scopes) { (scopes || []).forEach(function (s) { var c = canonical(s); if (c) M.grants[c] = true; }); authListeners.forEach(function (f) { try { f({ scopes: Object.keys(M.grants) }); } catch (e) {} }); };
  M.revoke = function () { M.grants = {}; authListeners.forEach(function (f) { try { f({ scopes: [] }); } catch (e) {} }); };
  M.reset = function () { M.calls = []; M.requests = []; M.accessRequests = []; M.shares = []; M.violations = []; M.store = {}; M.shared = {}; M.rows = []; M.receipts = {}; M.credits = cfg.credits; owned = {}; M.room.code = null; };

  if (cfg.preview) {
    window.__paeanPreview = true; window.__paeanInteractive = false;
    if (cfg.tapin > 0) setTimeout(install, cfg.tapin);
  } else {
    install();
  }
  document.addEventListener('DOMContentLoaded', function () { publishChrome(chromeSpec, true); });
  window.addEventListener('resize', function () { publishChrome(chromeSpec); });
}

// ── browser auto-activation (usage A) ───────────────────────────────────────
(function () {
  if (typeof window === 'undefined' || typeof location === 'undefined') return;
  var cfg = null;
  if (window.PAEAN_MOCK && typeof window.PAEAN_MOCK === 'object') cfg = window.PAEAN_MOCK;
  else if (/[?&]mock=1(&|$)/.test(location.search)) {
    var q = {}; location.search.slice(1).split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)); q[k] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1)); });
    cfg = q;
  }
  if (!cfg) return;
  paeanMockFactory(normalizeMockConfig(cfg));
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { mockBridgeSource: mockBridgeSource, normalizeMockConfig: normalizeMockConfig, paeanMockFactory: paeanMockFactory };
else if (typeof globalThis !== 'undefined') { globalThis.mockBridgeSource = mockBridgeSource; globalThis.paeanMockFactory = paeanMockFactory; }
