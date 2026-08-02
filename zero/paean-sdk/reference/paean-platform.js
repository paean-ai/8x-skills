/*
 * paean-platform.js — drop-in cloud-save + shared-leaderboard integration for
 * a Paean Apps Square app (a static site published to *.clide.app).
 *
 * Requires `paean-sdk.js` loaded first (exposes the global `PaeanSDK`). This
 * module never touches tokens or any backend URL: every call goes through the
 * host bridge (`PaeanSDK.host`), which the Paean app / 8x.gg web shell proxies
 * on behalf of the signed-in user, isolated per (app × user). In a plain
 * browser (no host) everything degrades to localStorage and the game stays
 * fully playable.
 *
 * Framework-agnostic, no build step, MIT. Copy it into your project and wire
 * the callbacks. See SKILL.md for the integration recipe and the gotchas this
 * module already handles.
 *
 *   <script src="paean-sdk.js"></script>
 *   <script src="paean-platform.js"></script>
 *   <script>
 *     const platform = createPaeanPlatform({
 *       storageNamespace: 'mygame',           // prefixes localStorage fallback keys
 *       saveKey: 'save',                       // KV key for the cloud save blob
 *       board: 'main',                         // leaderboard name
 *       getLocalSave: () => ({ best, level }), // your current savable state
 *       applySave:   (s) => { best = s.best }, // apply a (merged) save
 *       mergeSave:   (cloud, local) => merged, // resolve cloud vs local
 *       onState:     (st) => renderCloudUI(st) // mode/auth/profile changed
 *     });
 *     platform.init();
 *   </script>
 */
function createPaeanPlatform(opts) {
  opts = opts || {};
  var SCOPES = opts.scopes || ['storage.kv', 'storage.leaderboard', 'account.profile'];
  var SAVE_KEY = opts.saveKey || 'save';
  var BOARD = opts.board || 'main';
  var NS = opts.storageNamespace || 'paeanapp';
  var SAVE_THROTTLE_MS = opts.saveThrottleMs || 5000;
  var LK_AUTHED = NS + '.paeanAuthed';   // remembers a prior grant on this device
  var LK_QUEUE = NS + '.scoreQueue';     // offline / pre-auth score queue
  var LK_SAVE = NS + '.save';            // localStorage fallback for the save blob

  // mode: 'boot' | 'local' | 'preview' | 'paean'
  var S = {
    mode: 'boot', p: null,
    authed: false, denied: false,
    kvGranted: false, lbGranted: false, acGranted: false,
    name: null, userKey: null, myRank: null,
    loaded: false, dirty: false, lastError: null, lastSyncAt: 0
  };

  function emit() { if (typeof opts.onState === 'function') { try { opts.onState(view()); } catch (e) {} } }
  function view() {
    return {
      mode: S.mode, authed: S.authed, denied: S.denied,
      caps: caps(), kvGranted: S.kvGranted, lbGranted: S.lbGranted,
      name: S.name, userKey: S.userKey, myRank: S.myRank,
      loaded: S.loaded, dirty: S.dirty, lastError: S.lastError, lastSyncAt: S.lastSyncAt
    };
  }

  function caps() {
    var h = S.p ? S.p.host : null;
    return { storage: !!(h && h.storage), leaderboard: !!(h && h.leaderboard), account: !!(h && h.account) };
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ── detection / connection ────────────────────────────────────────────────
  function init() {
    localLoad(); // restore the localStorage fallback save (any mode; cloud merges later)
    if (typeof PaeanSDK === 'undefined') { S.mode = 'local'; emit(); return; }
    try {
      var d = PaeanSDK.detect();
      S.mode = d.supported ? 'paean' : (d.reason === 'preview' ? 'preview' : 'local');
    } catch (e) { S.mode = 'local'; }
    emit();
    connectReady();
  }

  var readyPolls = 0;
  function connectReady() {
    // ready() stays pending while parked as a feed preview (resolves when the
    // user opens the app), and rejects in a plain browser → local fallback.
    PaeanSDK.ready().then(function (p) {
      S.p = p; S.mode = 'paean';
      // Auto-connect silently when the host already holds the grant (granted on
      // another device/session) or when this device connected before — no
      // consent UI needed in either case.
      var hostGranted = false;
      try { hostGranted = !!(p.auth && p.auth.has && p.auth.has('storage.kv')); } catch (e) {}
      if (lsGet(LK_AUTHED) === '1' || hostGranted) ensureAuth();
      emit();
    }).catch(function () {
      S.mode = 'local'; emit();
      // GOTCHA (late injection): some native hosts inject window.paean AFTER
      // ready()'s grace window. Keep polling and reconnect when it appears,
      // instead of staying stuck in local mode for the whole session.
      // readyPolls is a TOTAL budget across reconnect attempts, so a bridge
      // that appears but whose ready() keeps rejecting (bridge-unreachable /
      // sdk-too-old) can't spin an endless retry loop.
      var iv = setInterval(function () {
        if (++readyPolls > 40) { clearInterval(iv); return; } // ~20s total
        if (PaeanSDK.isAvailable && PaeanSDK.isAvailable()) { clearInterval(iv); connectReady(); }
      }, 500);
    });
  }

  // ── authorization ─────────────────────────────────────────────────────────
  function applyScopes() {
    // GOTCHA (partial grant): a host may support/grant only SOME requested
    // scopes (e.g. a build with no leaderboard yet). Read each scope's truth
    // independently — never let one missing scope take cloud save down too.
    var A = S.p.auth;
    S.kvGranted = !!A.has('storage.kv');
    S.lbGranted = !!A.has('storage.leaderboard');
    S.acGranted = !!A.has('account.profile');
    S.authed = S.kvGranted || S.lbGranted;
    S.denied = !S.authed;
    if (S.authed) {
      lsSet(LK_AUTHED, '1');
      if (S.acGranted) loadProfile();
      cloudLoad(); flushQueue(); fetchMyRank();
    }
    emit();
    return S.authed;
  }

  function ensureAuth() {
    if (S.mode !== 'paean' || !S.p) return Promise.resolve(false);
    if (S.authed) return Promise.resolve(true);
    var want = SCOPES.slice();
    // don't request a scope the host can't serve
    if (want.indexOf('storage.leaderboard') >= 0 && !caps().leaderboard) {
      want = want.filter(function (s) { return s !== 'storage.leaderboard'; });
    }
    var req;
    try { req = S.p.auth.ensure(want); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(req).then(applyScopes).catch(function (err) {
      // GOTCHA (wholesale rejection): a host may reject a request containing an
      // unknown scope outright. Retry with the bare minimum so at least cloud
      // save survives — but if the USER declined, don't re-prompt immediately.
      var m = (err && err.message) || '';
      if (/denied|declined|reject|cancel/i.test(m)) { S.denied = true; emit(); return false; }
      var req2;
      try { req2 = S.p.auth.ensure(['storage.kv']); }
      catch (e) { S.denied = true; emit(); return false; }
      return Promise.resolve(req2).then(applyScopes).catch(function (e) {
        S.denied = true; S.lastError = 'auth: ' + ((e && e.message) || 'failed'); emit(); return false;
      });
    });
  }

  // acquire just the leaderboard scope later (denied/unsupported at first)
  function ensureLeaderboard() {
    if (S.mode !== 'paean' || !S.p || !caps().leaderboard) return Promise.resolve(false);
    if (S.lbGranted) return Promise.resolve(true);
    var req;
    try { req = S.p.auth.ensure(['storage.leaderboard']); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(req).then(function () { applyScopes(); return S.lbGranted; })
      .catch(function () { return false; });
  }

  function loadProfile() {
    if (!caps().account) return;
    try {
      Promise.resolve(S.p.host.account.profile()).then(function (r) {
        if (r && r.displayName) S.name = String(r.displayName);
        if (r && r.userKey) S.userKey = r.userKey;
        emit();
      }).catch(function () {});
    } catch (e) {}
  }

  // ── save persistence: localStorage fallback + cloud KV ─────────────────────
  // The save blob ALWAYS persists to localStorage (so a plain browser keeps
  // progress across refreshes); when a host grant is present it additionally
  // syncs to cloud KV. S.loaded gates the first cloud push: never overwrite
  // the cloud with a fresh device's empty save before we've read (or truly
  // failed to read) what's up there.
  function localLoad() {
    var raw = lsGet(LK_SAVE);
    if (!raw) return;
    var saved = null;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    if (!saved || typeof saved !== 'object') return;
    var merged = typeof opts.mergeSave === 'function' ? opts.mergeSave(saved, safeLocalSave()) : saved;
    if (typeof opts.applySave === 'function') { try { opts.applySave(merged); } catch (e) {} }
  }
  function localSave() {
    try { lsSet(LK_SAVE, JSON.stringify(safeLocalSave())); } catch (e) {}
  }

  var cloudLoading = false, loadRetries = 0;
  function cloudLoad() {
    if (S.loaded || cloudLoading) return; // one load-merge-push cycle per session
    if (!caps().storage || !S.kvGranted) { S.loaded = true; return; }
    cloudLoading = true;
    try {
      Promise.resolve(S.p.host.storage.get(SAVE_KEY)).then(function (v) {
        // GOTCHA (return shape): some hosts return the entry wrapper
        // {key,value,...}; others return the bare value. Unwrap defensively.
        var cloud = (v && typeof v === 'object' && v.value !== undefined) ? v.value : v;
        if (cloud && typeof cloud === 'object') {
          var merged = typeof opts.mergeSave === 'function'
            ? opts.mergeSave(cloud, safeLocalSave())
            : cloud;
          if (typeof opts.applySave === 'function') opts.applySave(merged);
        }
        cloudLoading = false; S.loaded = true; S.lastError = null;
        S.dirty = true; flushSave(); // push the merged result straight back up
        emit();
      }).catch(function (e) {
        cloudLoading = false;
        // GOTCHA (missing save): a fresh account has no save. Some hosts express
        // that as a rejected "key not found", others resolve null (handled
        // above). A rejected not-found is NOT an error — seed the first save.
        var msg = (e && e.message) || '';
        if (/not found/i.test(msg)) { S.loaded = true; S.dirty = true; flushSave(); }
        else {
          // GOTCHA (first-write ordering): a TRANSIENT read failure must not
          // unlock pushes, or this device's empty state could overwrite the
          // cloud. Retry the read with backoff before giving up.
          S.lastError = 'load: ' + (msg || 'failed');
          if (++loadRetries <= 5) setTimeout(cloudLoad, 3000 * loadRetries);
          else S.loaded = true; // give up: allow saves rather than block forever
        }
        emit();
      });
    } catch (e) { cloudLoading = false; S.loaded = true; }
  }

  function safeLocalSave() {
    try { return typeof opts.getLocalSave === 'function' ? opts.getLocalSave() : {}; }
    catch (e) { return {}; }
  }

  function flushSave() {
    if (!S.dirty) return;
    localSave(); // localStorage fallback always gets the latest state
    if (!caps().storage || !S.kvGranted) { S.dirty = false; return; } // local-only mode
    if (!S.loaded) return; // cloud read still pending — stay dirty, retry next tick
    var payload = safeLocalSave();
    try {
      Promise.resolve(S.p.host.storage.put(SAVE_KEY, payload))
        .then(function () { S.dirty = false; S.lastSyncAt = Date.now(); S.lastError = null; emit(); })
        .catch(function (e) { S.lastError = 'save: ' + ((e && e.message) || 'failed'); emit(); /* stay dirty, retry */ });
    } catch (e) {}
  }

  // call whenever your savable state changes; the push itself is throttled
  function markDirty() { S.dirty = true; }
  setInterval(flushSave, SAVE_THROTTLE_MS);
  // GOTCHA (mobile lifecycle): WebViews get killed without warning — flush the
  // moment we're backgrounded, don't wait for the throttle.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushSave(); });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', function () { flushSave(); });
    window.addEventListener('online', function () { flushSave(); flushQueue(); });
  }

  // ── leaderboard ─────────────────────────────────────────────────────────────
  function queueScore(score, meta) {
    var q = [];
    try { q = JSON.parse(lsGet(LK_QUEUE) || '[]'); } catch (e) {}
    q.push({ score: score, metadata: meta, at: Date.now() });
    while (q.length > 20) q.shift();
    lsSet(LK_QUEUE, JSON.stringify(q));
  }
  function flushQueue() {
    if (!caps().leaderboard || !S.lbGranted) return;
    var q = [];
    try { q = JSON.parse(lsGet(LK_QUEUE) || '[]'); } catch (e) {}
    if (!q.length) return;
    // the board keeps each player's best, so submitting the max is enough
    var top = q.reduce(function (m, e) { return (e && e.score > m.score) ? e : m; }, q[0]);
    try {
      Promise.resolve(S.p.host.leaderboard.submitScore(BOARD, top.score, { metadata: top.metadata }))
        .then(function () { lsSet(LK_QUEUE, '[]'); }).catch(function () {});
    } catch (e) {}
  }

  // submit a run's score; cb(rank|null). Queues (never loses) on any failure.
  function submitScore(score, meta, cb) {
    cb = cb || function () {};
    if (!(score > 0)) return cb(null);
    if (S.mode !== 'paean') { queueScore(score, meta); return cb(null); }
    ensureAuth().then(function (ok) {
      if (!ok || !caps().leaderboard || !S.lbGranted) { queueScore(score, meta); return cb(null); }
      try {
        Promise.resolve(S.p.host.leaderboard.submitScore(BOARD, score, { metadata: meta }))
          .then(function () { flushQueue(); return safeRank(); })
          .then(function (rank) { if (rank) { S.myRank = rank; emit(); } cb(rank); })
          .catch(function () { queueScore(score, meta); cb(null); });
      } catch (e) { queueScore(score, meta); cb(null); }
    });
  }

  function safeRank() {
    try {
      return Promise.resolve(S.p.host.leaderboard.getMyRank(BOARD))
        .then(function (r) { return (typeof r === 'number') ? r : (r && (r.rank || r.myRank)) || null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function fetchMyRank() {
    if (!caps().leaderboard || !S.lbGranted) return;
    safeRank().then(function (rank) { if (rank) { S.myRank = rank; emit(); } });
  }

  // cb({ entries:[{rank,name,score,userKey,picture,isSelf,metadata}], me })
  function getLeaderboard(limit, cb) {
    if (typeof limit === 'function') { cb = limit; limit = 20; }
    cb = cb || function () {};
    if (S.mode !== 'paean' || !caps().leaderboard || !S.lbGranted) return cb(null);
    try {
      Promise.resolve(S.p.host.leaderboard.get(BOARD, { limit: limit || 20 })).then(function (res) {
        res = res || {};
        var raw = res.entries || res.list || res.items || (Array.isArray(res) ? res : []);
        if (!Array.isArray(raw)) raw = [];
        var meRaw = (res.me && typeof res.me === 'object') ? res.me : null;
        function norm(e, fallbackRank, selfKnown) {
          e = e || {};
          // GOTCHA (self flag / naming): the authoritative self marker is
          // `isSelf`; also fall back to matching userKey. Names/pictures come
          // under several possible keys across hosts — read defensively.
          var mine = selfKnown || e.isSelf === true || e.isMe === true
            || (meRaw && meRaw.userKey && e.userKey === meRaw.userKey)
            || (S.userKey && e.userKey === S.userKey);
          return {
            rank: e.rank || e.myRank || fallbackRank,
            name: e.userName || e.displayName || e.name || 'Player',
            score: (typeof e.score === 'number') ? e.score : (parseInt(e.score, 10) || 0),
            userKey: e.userKey || null,
            picture: e.userPicture || e.picture || e.avatar || null,
            metadata: e.metadata || null,
            isSelf: !!mine
          };
        }
        var entries = raw.map(function (e, i) { return norm(e, i + 1, false); });
        // `me` gets the SAME normalized shape as entries
        var me = meRaw ? norm(meRaw, null, true) : null;
        if (me && me.rank) { S.myRank = me.rank; emit(); }
        cb({ entries: entries, me: me });
      }).catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  return {
    init: init,
    connect: ensureAuth,          // call from a "Sync"/"Connect" button
    connectLeaderboard: ensureLeaderboard,
    save: flushSave,
    markDirty: markDirty,
    submitScore: submitScore,
    getLeaderboard: getLeaderboard,
    fetchMyRank: fetchMyRank,
    state: view                    // current snapshot for your UI
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createPaeanPlatform: createPaeanPlatform };
