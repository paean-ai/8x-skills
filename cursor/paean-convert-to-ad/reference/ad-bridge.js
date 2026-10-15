/* 互动广告桥接层 —— 在广告容器里提供统一的"退出到商店"入口。
 * 各广告网络的 API 不同，这里全部防御性探测，命中哪个用哪个。
 * 本文件不依赖游戏内部实现，只挂一个全局 AdBridge。 */
(function (w, d) {
  'use strict';
  var fired = false;

  /* ── 语言：广告素材统一英文 ──
   * 这段必须在 <head> 里、任何游戏模块之前执行：i18n 模块在 import 时就读存储/设备语言。
   * 作品的取值方式不一：有的读 navigator.language，有的读一个存储键。
   * 这里把配置里列出的键全部预置成目标语言，并钉死 documentElement.lang。 */
  (function forceLang() {
    var L = w.AD_LANG;
    if (!L || !L.lang) return;
    try { d.documentElement.lang = L.lang; } catch (e) {}
    for (var i = 0; i < (L.storageKeys || []).length; i++) {
      var k = L.storageKeys[i];
      try {
        if (typeof k === 'string') localStorage.setItem(k, L.lang);
        else if (k && k.key) {                       // JSON 形态：{ key:'x.settings', field:'lang' }
          var cur = {};
          try { cur = JSON.parse(localStorage.getItem(k.key) || '{}') || {}; } catch (e2) { cur = {}; }
          cur[k.field || 'lang'] = L.lang;
          localStorage.setItem(k.key, JSON.stringify(cur));
        }
      } catch (e3) {}
    }
  })();

  function storeUrl() {
    return (w.AD_STORE_URL) || 'https://play.google.com/store/apps/details?id=gg.x8.app';
  }

  /** 统一的 CTA：把用户送到商店。多网络防御探测，只触发一次。 */
  function exit(reason) {
    if (fired) return;
    var url = storeUrl();
    // 只有在确认某条退出通道真的接管之后才上锁；否则允许用户再点一次。
    // （早置 fired 会导致 window.open 被拦截时整个 CTA 失效）
    function done() { fired = true; try { if (w.AdBridge.onExit) w.AdBridge.onExit(reason || 'cta'); } catch (e) {} }
    // 1) MRAID（多数可玩广告容器，含 Google App campaign playable）
    try { if (w.mraid && typeof w.mraid.open === 'function') { w.mraid.open(url); done(); return; } } catch (e) {}
    // 2) Google Display / Studio ExitApi
    try { if (w.ExitApi && typeof w.ExitApi.exit === 'function') { w.ExitApi.exit(); done(); return; } } catch (e) {}
    // 3) Meta Playable（便于同素材复用到 FB/IG）
    try { if (w.FbPlayableAd && typeof w.FbPlayableAd.onCTAClick === 'function') { w.FbPlayableAd.onCTAClick(); done(); return; } } catch (e) {}
    // 4) 传统 clickTag
    try { if (typeof w.clickTag === 'string' && w.clickTag) { if (w.open(w.clickTag, '_blank')) { done(); return; } } } catch (e) {}
    // 5) 兜底：被拦截则不上锁，用户可再点
    try { if (w.open(url, '_blank')) done(); } catch (e) {}
  }

  /** 容器就绪（MRAID 有 loading → default 的生命周期）。 */
  function whenReady(cb) {
    try {
      if (w.mraid && typeof w.mraid.getState === 'function') {
        if (w.mraid.getState() === 'loading') { w.mraid.addEventListener('ready', cb); return; }
      }
    } catch (e) {}
    cb();
  }

  // 试玩计时的起点。默认为页面挂载，但导演层进入真实可玩状态时应调用 markPlayStart()
  // 覆盖它 —— 否则加载慢、先看演示、被面板阻塞都会吃掉用户的试玩时间。
  var playStart = 0;
  function markPlayStart() { playStart = Date.now(); try { if (w.AdBridge.onPlayStart) w.AdBridge.onPlayStart(); } catch (e) {} }
  function playElapsed() { return playStart ? Date.now() - playStart : 0; }

  w.AdBridge = { exit: exit, whenReady: whenReady, storeUrl: storeUrl, onExit: null,
                 markPlayStart: markPlayStart, playElapsed: playElapsed, onPlayStart: null,
                 hasPlayStarted: function () { return !!playStart; } };

  // 广告容器里禁掉可能触发系统 UI 的手势
  d.addEventListener('contextmenu', function (e) { e.preventDefault(); }, { passive: false });
  d.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
})(window, document);
