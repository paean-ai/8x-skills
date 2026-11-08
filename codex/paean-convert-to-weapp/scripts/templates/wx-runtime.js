// A small explicit port boundary, not a DOM/browser polyfill. CommonJS for game.js.
module.exports = function createRuntime(wx, options) {
  options = options || {}
  var namespace = options.namespace
  if (!namespace || !/^[a-z0-9._-]+$/i.test(namespace)) throw new Error('Set a dedicated storage namespace')
  var raf = options.requestFrame || requestAnimationFrame
  var caf = options.cancelFrame || cancelAnimationFrame
  var canvas = wx.createCanvas() // FIRST canvas is the visible surface. Create textures later.
  var maxDpr = options.maxDpr || 2, view, active = new Map(), memory = new Map()
  var touches = new Set(), resizes = new Set(), hides = new Set(), shows = new Set()
  var hidden = false, disposed = false, running = false, frame = null, last = null, draw = null
  var bindings = []
  function emit(set, value) { set.forEach(function (fn) { fn(value) }) }
  function subscribe(set, fn) { set.add(fn); return function () { set.delete(fn) } }
  function bind(on, off, fn) {
    if (typeof wx[on] === 'function') {
      wx[on](fn)
      bindings.push(function () { if (typeof wx[off] === 'function') wx[off](fn) })
    }
  }
  function cancelTouches(reason) {
    active.forEach(function (p) { emit(touches, Object.assign({}, p, { type: 'cancel', reason: reason })) })
    active.clear()
  }
  function measure() {
    var info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
    var width = info.windowWidth, height = info.windowHeight
    if (!(width > 0 && height > 0)) throw new Error('Invalid wx window size')
    var dpr = Math.max(1, Math.min(maxDpr, info.pixelRatio || 1))
    var raw = info.safeArea || { left: 0, top: 0, right: width, bottom: height }
    var safe = { left: Math.max(0, raw.left || 0), top: Math.max(0, raw.top || 0),
      right: Math.min(width, raw.right == null ? width : raw.right), bottom: Math.min(height, raw.bottom == null ? height : raw.bottom) }
    var menu = null
    try { if (wx.getMenuButtonBoundingClientRect) menu = wx.getMenuButtonBoundingClientRect() } catch (_) {}
    view = { width: width, height: height, dpr: dpr, safeArea: safe, menu: menu }
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
    return view
  }
  function resize() { if (disposed) return; cancelTouches('resize'); measure(); emit(resizes, view) }
  function touch(type, event) {
    if (disposed || hidden) return
    var changed = event.changedTouches || []
    if (type === 'cancel' && !changed.length) { cancelTouches('system'); return }
    changed.forEach(function (t) {
      var id = t.identifier, x = t.clientX == null ? t.pageX : t.clientX, y = t.clientY == null ? t.pageY : t.clientY
      if (id == null || !Number.isFinite(x) || !Number.isFinite(y)) return
      if (type !== 'start' && !active.has(id)) return
      var p = { id: id, x: x, y: y, type: type } // Window coordinates, NOT framebuffer pixels.
      if (type === 'end' || type === 'cancel') active.delete(id); else active.set(id, p)
      emit(touches, p)
    })
  }
  function unschedule() { if (frame !== null) caf(frame); frame = null; last = null }
  function tick(timestamp) {
    frame = null
    if (!running || hidden || disposed) return
    var dt = last === null ? 0 : Math.max(0, Math.min(0.05, (timestamp - last) / 1000))
    last = timestamp
    try { draw(dt, view) } catch (error) { running = false; last = null; throw error }
    if (running && !hidden && !disposed) frame = raf(tick)
  }
  function schedule() { if (running && !hidden && !disposed && frame === null) frame = raf(tick) }
  bind('onTouchStart', 'offTouchStart', function (e) { touch('start', e) })
  bind('onTouchMove', 'offTouchMove', function (e) { touch('move', e) })
  bind('onTouchEnd', 'offTouchEnd', function (e) { touch('end', e) })
  bind('onTouchCancel', 'offTouchCancel', function (e) { touch('cancel', e) })
  bind('onWindowResize', 'offWindowResize', resize)
  bind('onHide', 'offHide', function () { hidden = true; cancelTouches('hide'); unschedule(); emit(hides) })
  bind('onShow', 'offShow', function () { hidden = false; resize(); last = null; emit(shows); schedule() })
  measure()
  function key(k) { return namespace + ':' + k }
  function warn(error) { if (options.onStorageError) options.onStorageError(error) }
  return {
    canvas: canvas,
    viewport: function () { return view },
    resize: resize,
    onTouch: function (fn) { return subscribe(touches, fn) },
    onResize: function (fn) { return subscribe(resizes, fn) },
    onHide: function (fn) { return subscribe(hides, fn) },
    onShow: function (fn) { return subscribe(shows, fn) },
    toLogical: function (point, rect, width, height) {
      if (!(rect.width > 0 && rect.height > 0)) throw new Error('Invalid hit rectangle')
      return { x: (point.x - rect.x) * width / rect.width, y: (point.y - rect.y) * height / rect.height }
    },
    storage: {
      get: function (k, fallback) {
        var name = key(k)
        if (memory.has(name)) return memory.get(name) === undefined ? fallback : memory.get(name)
        try {
          var raw = wx.getStorageSync(name)
          if (raw === '' || raw == null) return fallback
          var value = JSON.parse(raw); memory.set(name, value); return value
        } catch (error) { warn(error); return fallback }
      },
      set: function (k, value) {
        var raw = JSON.stringify(value)
        if (raw === undefined) throw new Error('Storage value must be JSON serializable')
        memory.set(key(k), value)
        try { wx.setStorageSync(key(k), raw); return true } catch (error) { warn(error); return false }
      },
      remove: function (k) {
        // Keep a tombstone even when the device write fails, so stale persisted data cannot reappear this session.
        memory.set(key(k), undefined)
        try { wx.removeStorageSync(key(k)); return true } catch (error) { warn(error); return false }
      }
    },
    start: function (callback) { if (disposed) throw new Error('Runtime disposed'); draw = callback; running = true; schedule() },
    stop: function () { running = false; unschedule() },
    dispose: function () {
      running = false; disposed = true; unschedule(); cancelTouches('dispose')
      bindings.forEach(function (off) { off() }); touches.clear(); resizes.clear(); hides.clear(); shows.clear()
    }
  }
}
