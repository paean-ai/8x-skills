/*
 * demo-overlay.js — the promo layer, run inside the page being recorded.
 *
 * Installed through Playwright's addInitScript, so it executes before any of
 * the game's own scripts. That ordering is the point: it lets the cover paint
 * on the very first frame, and the clip then opens on a designed title card
 * instead of a white flash or a half-laid-out page.
 *
 * The layer is pointer-events:none throughout. The recorder's scripted input
 * has to reach the game underneath, and a promo overlay that swallows taps
 * would silently produce 25 seconds of a game that never started.
 *
 * Everything is driven off one monotonic clock started at reveal, not off a
 * chain of setTimeouts: a slow frame early on would otherwise push every later
 * beat out of sync with the end card.
 */
(function () {
  var CFG = window.__PAEAN_DEMO__
  if (!CFG || window.__PAEAN_DEMO_READY__) return
  window.__PAEAN_DEMO_READY__ = true

  var doc = document
  var state = { t0: 0, started: false, beats: [], raf: 0 }
  var el = {}

  function make(tag, cls, parent) {
    var n = doc.createElement(tag)
    if (cls) n.className = cls
    if (parent) parent.appendChild(n)
    return n
  }

  function install() {
    if (el.root) return
    var style = make('style')
    style.textContent = CFG.css || ''
    ;(doc.head || doc.documentElement).appendChild(style)

    var root = make('div', 'pd-root')
    root.setAttribute('data-paean-demo', '')
    var vars = {
      '--pd-bg': CFG.theme.background,
      '--pd-accent': CFG.theme.accent,
      '--pd-accent-ink': CFG.theme.accentInk,
      '--pd-font': CFG.theme.font,
      '--pd-safe-top': CFG.theme.safeTop,
      '--pd-safe-bottom': CFG.theme.safeBottom,
      '--pd-fade': CFG.fadeMs + 'ms',
    }
    for (var k in vars) if (vars[k]) root.style.setProperty(k, vars[k])

    el.cover = make('div', 'pd-cover', root)

    if (CFG.title) {
      el.card = make('div', 'pd-card', root)
      if (CFG.title.logo) {
        var img = make('img', 'pd-logo', el.card)
        img.src = CFG.title.logo
        // A missing icon must not leave a broken-image glyph in the clip.
        img.onerror = function () { img.remove() }
      }
      var h = make('h1', 'pd-title', el.card)
      h.textContent = CFG.title.text || ''
      if (CFG.title.tagline) {
        var p = make('p', 'pd-tagline', el.card)
        p.textContent = CFG.title.tagline
      }
    }

    el.beats = make('div', 'pd-beats', root)
    el.beats.setAttribute('data-pos', CFG.beatPosition || 'bottom')

    if (CFG.end) {
      el.end = make('div', 'pd-end', root)
      var eh = make('h2', 'pd-end-title', el.end)
      eh.textContent = CFG.end.text || ''
      if (CFG.end.cta) make('div', 'pd-cta', el.end).textContent = CFG.end.cta
      if (CFG.end.url) make('div', 'pd-url', el.end).textContent = CFG.end.url
    }

    if (CFG.mark) make('div', 'pd-mark', root).textContent = CFG.mark

    el.root = root
    ;(doc.body || doc.documentElement).appendChild(root)
  }

  // The cover has to exist before the game paints, but <body> may not yet.
  if (doc.body) install()
  else doc.addEventListener('DOMContentLoaded', install, { once: true })

  function setBeat(text, accent) {
    if (!el.beats) return
    var node = el.beats.firstChild
    if (!text) {
      if (node) node.setAttribute('data-state', 'out')
      return
    }
    if (!node) node = make('div', 'pd-beat', el.beats)
    node.textContent = ''
    // A leading "! " marks the accented half of a caption: "! Chain | combos".
    var parts = String(text).split('|')
    node.appendChild(doc.createTextNode(parts[0]))
    if (parts[1] !== undefined) {
      var span = make('span', 'pd-beat-accent', node)
      span.textContent = parts[1]
    }
    if (accent) node.style.setProperty('--pd-accent', accent)
    node.setAttribute('data-state', 'in')
  }

  function tick(now) {
    var t = (now - state.t0) / 1000
    var active = null
    for (var i = 0; i < state.beats.length; i++) {
      var b = state.beats[i]
      if (t >= b.at && t < b.at + b.hold) active = b
    }
    var key = active ? active.at + ':' + active.text : ''
    if (key !== state.lastBeat) {
      state.lastBeat = key
      setBeat(active ? active.text : '', active && active.accent)
    }
    if (el.card && t >= CFG.titleSeconds && el.card.getAttribute('data-state') === 'in') {
      el.card.setAttribute('data-state', 'out')
    }
    if (el.end && CFG.endAt != null && t >= CFG.endAt && el.end.getAttribute('data-state') !== 'in') {
      el.end.setAttribute('data-state', 'in')
      setBeat('')
    }
    state.raf = requestAnimationFrame(tick)
  }

  /*
   * Called by the recorder once the game is actually running — never on a
   * timer. Boot time varies with asset weight and machine, and a clip whose
   * title card lifts before the game is ready shows a loading screen where the
   * gameplay was meant to be.
   */
  window.__paeanDemoStart = function (opts) {
    install()
    if (state.started) return false
    state.started = true
    var o = opts || {}
    state.beats = (o.beats || CFG.beats || []).map(function (b) {
      return { at: +b.at || 0, hold: b.hold == null ? 3 : +b.hold, text: b.text, accent: b.accent }
    })
    if (o.endAt != null) CFG.endAt = o.endAt
    state.t0 = performance.now()
    if (el.card) el.card.setAttribute('data-state', 'in')
    el.cover.setAttribute('data-state', 'gone')
    state.raf = requestAnimationFrame(tick)
    return true
  }

  window.__paeanDemoStop = function () {
    if (state.raf) cancelAnimationFrame(state.raf)
    state.raf = 0
    return true
  }
})()
