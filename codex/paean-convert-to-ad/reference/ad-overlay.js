/* 广告态 UI：常驻 CTA、到时结束卡。与游戏逻辑零耦合，只读时间、只调 AdBridge。 */
(function (w, d) {
  'use strict';
  var CFG = w.AD_CONFIG || {};
  var PLAY_MS = CFG.playMs || 30000;      // 允许试玩多久后强制结束卡
  var CTA_TEXT = CFG.ctaText || 'Play Free';
  var END_TITLE = CFG.endTitle || 'Keep playing in 8x';
  var END_SUB = CFG.endSub || 'Thousands of playable AI mini-apps. Free, no sign-up.';
  // 自动跳过开场剧情等前置面板。可玩广告必须几秒内进核心玩法。
  // 配置成选择器数组，命中即点击；持续观察 DOM，最多生效 AUTOSKIP_MS 毫秒。
  var AUTOSKIP = CFG.autoSkip || [];
  // 0 = 不设上限。一次性面板可能因加载慢而晚出现，过早停止轮询会让用户卡在面板里。
  var AUTOSKIP_MS = CFG.autoSkipMs != null ? CFG.autoSkipMs : 0;

  function el(tag, attrs, html) {
    var n = d.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }

  /** 隐藏语言切换等在广告里只会添乱的控件。 */
  function hideChrome() {
    var sels = (w.AD_LANG && w.AD_LANG.hideSelectors) || [];
    for (var i = 0; i < sels.length; i++) {
      try { d.querySelectorAll(sels[i]).forEach(function (n) { n.style.display = 'none'; }); } catch (e) {}
    }
  }

  function mount() {
    hideChrome();
    // 没有导演层的作品（纯 DOM 跳过）不会调 markPlayStart，
    // 此时退化为挂载即计时，而不是等 20 秒兜底再开始。
    try {
      if (!w.AD_DIRECTOR && w.AdBridge && !w.AdBridge.hasPlayStarted()) w.AdBridge.markPlayStart();
    } catch (e) {}
    w.setInterval(hideChrome, 800);   // 面板可能晚挂载
    var cta = el('button', { id: 'ad-cta', type: 'button' }, CTA_TEXT);
    cta.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); w.AdBridge.exit('cta'); });
    d.body.appendChild(cta);

    var end = el('div', { id: 'ad-end' });
    end.appendChild(el('div', { class: 'ad-end-title' }, END_TITLE));
    end.appendChild(el('div', { class: 'ad-end-sub' }, END_SUB));
    var btn = el('button', { class: 'ad-end-btn', type: 'button' }, CTA_TEXT);
    btn.addEventListener('click', function (e) { e.preventDefault(); w.AdBridge.exit('endcard'); });
    end.appendChild(btn);
    d.body.appendChild(end);

    // 结束卡从「真实可玩」开始计时，不是页面挂载。导演层调 AdBridge.markPlayStart()
    // 标记起点；没有导演层的作品退化为挂载即计时。
    if (PLAY_MS > 0) startEndTimer(end);
    if (AUTOSKIP.length) startAutoSkip();
  }

  /** 结束卡计时：等到真实可玩状态出现后才开始走表。 */
  function startEndTimer(end) {
    var B = w.AdBridge;
    function arm() { w.setTimeout(function () { end.classList.add('show'); }, PLAY_MS); }
    if (!B || typeof B.hasPlayStarted !== 'function') { arm(); return; }
    if (B.hasPlayStarted()) { arm(); return; }
    var t0 = Date.now();
    var iv = w.setInterval(function () {
      if (B.hasPlayStarted()) { w.clearInterval(iv); arm(); }
      else if (Date.now() - t0 > 20000) { w.clearInterval(iv); arm(); }   // 兜底，避免永不收尾
    }, 200);
  }

  /** 反复扫描配置的选择器并点击，直到超时（AUTOSKIP_MS=0 表示不限）。对 DOM 结构变化容错。 */
  function startAutoSkip() {
    var t0 = Date.now(), seen = 0;
    function sweep() {
      for (var i = 0; i < AUTOSKIP.length; i++) {
        var n = null;
        try { n = d.querySelector(AUTOSKIP[i]); } catch (e) { continue; }
        if (n && n.offsetParent !== null) {
          try { n.click(); seen++; } catch (e) {}
        }
      }
    }
    var iv = w.setInterval(function () {
      sweep();
      if (AUTOSKIP_MS > 0 && Date.now() - t0 > AUTOSKIP_MS) w.clearInterval(iv);
    }, 250);
    sweep();
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { w.AdBridge.whenReady(mount); });
  else w.AdBridge.whenReady(mount);
})(window, document);
