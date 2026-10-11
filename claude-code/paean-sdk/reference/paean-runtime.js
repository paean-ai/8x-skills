/* Paean game runtime contract v1. Framework-independent; no account API or native rendering. */
(function (global) {
  "use strict";
  global.createPaeanRuntime = function createPaeanRuntime(options = {}) {
    const host = global.__paeanRuntimeHost;
    const metadata = global.document?.querySelector('meta[name="paean-content-version"]')?.content;
    const version = metadata || options.version || "development";
    const schema = options.saveSchema || 1;
    const saveKey = "paean.runtime." + (options.saveKey || "checkpoint") + "." + (options.userScope || "guest");
    const fallback = { paused: false, visible: true, interactive: global.__paeanInteractive !== false,
      reasons: [], quality: { mode: "play", targetFPS: 60, maxPixelRatio: 2, maxPixels: 2000000, level: 0 } };
    let state = host?.state?.() || fallback;
    let disposed = false, isReady = false, loopID = null, lastTick = null, lastDraw = null;
    let samples = [], sampleStart = null, lastFrame = null, lastCheckpoint = 0;
    let contextLost = false;
    const listeners = [];
    const clock = () => global.performance.now();
    const listen = (target, name, callback) => {
      target?.addEventListener(name, callback);
      listeners.push(() => target?.removeEventListener(name, callback));
    };
    function report(method, data) { if (!disposed) host?.[method]?.(data); }
    function resetClock() { lastTick = lastDraw = lastFrame = sampleStart = null; samples = []; }
    function current() {
      const hidden = global.document?.hidden === true;
      return { ...state, paused: state.paused || hidden || contextLost, visible: state.visible && !hidden };
    }
    function changed() {
      resetClock();
      options.onState?.(current());
      options.onQuality?.(state.quality);
      if (current().paused) checkpoint();
    }
    listen(global, "paean:runtime", e => { state = e.detail; changed(); });
    // Old hosts publish these events without the v1 state object.
    listen(global, "paean:paused", e => {
      if (!host) { state = { ...state, paused: !!e.detail?.paused }; changed(); }
    });
    listen(global, "paean:interactive", e => {
      if (!host) { state = { ...state, interactive: !!e.detail?.interactive }; changed(); }
    });
    listen(global.document, "visibilitychange", changed);
    listen(global, "pagehide", () => { checkpoint(); resetClock(); });
    listen(global, "paean:audio-route", e => options.onAudioRoute?.(e.detail));

    function checkpoint() {
      if (disposed || !isReady || !options.getSave) return false;
      try {
        const envelope = { schema, version, state: options.getSave(), savedAt: Date.now() };
        const text = JSON.stringify(envelope);
        if (new TextEncoder().encode(text).length > 65536) throw new Error("Checkpoint exceeds 64 KiB");
        global.localStorage.setItem(saveKey, text);
        // Integrate the existing consent-aware cloud-save adapter here. Never prompt.
        options.onCheckpoint?.(envelope);
        lastCheckpoint = clock();
        return true;
      } catch (error) { options.onError?.(error); return false; }
    }
    function restore() {
      try {
        const saved = JSON.parse(global.localStorage.getItem(saveKey) || "null");
        if (!saved) return false;
        if (saved.schema !== schema) {
          if (!options.migrateSave) return false;
          saved.state = options.migrateSave(saved.state, saved.schema);
        }
        // The game validates its own data before applying it. No arbitrary object merges.
        return typeof options.applySave === "function" && options.applySave(saved.state) !== false;
      } catch (error) { options.onError?.(error); return false; }
    }
    function frame(time = clock()) {
      if (!isReady || current().paused || !Number.isFinite(time)) { lastFrame = null; return; }
      if (lastFrame !== null && time > lastFrame) {
        samples.push(Math.min(10000, time - lastFrame));
        if (samples.length > 2000) samples.shift();
      }
      lastFrame = time;
      if (sampleStart === null) sampleStart = time;
      if (time - sampleStart >= 2000 && samples.length >= 5) {
        const sorted = samples.slice().sort((a, b) => a - b);
        const sample = { frames: samples.length, p50: sorted[Math.floor(sorted.length * .5)],
          p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))],
          longFrames: samples.filter(n => n > 50).length, veryLongFrames: samples.filter(n => n > 100).length, elapsed: time - sampleStart };
        report("sample", sample);
        options.onSample?.(sample);
        samples = []; sampleStart = time;
      }
      if (time - lastCheckpoint > 15000) checkpoint();
    }
    function startLoop(render) {
      stopLoop();
      function tick(time) {
        if (disposed) return;
        loopID = global.requestAnimationFrame(tick);
        if (current().paused) { resetClock(); return; }
        const interval = 1000 / (state.quality?.targetFPS || 60);
        if (lastDraw !== null && time - lastDraw < interval - .5) return;
        const dt = lastTick === null ? 0 : Math.min(.05, Math.max(0, (time - lastTick) / 1000));
        lastTick = time; lastDraw = time;
        render(dt, current());
        frame(time); // Count only the frames the renderer actually submitted.
      }
      loopID = global.requestAnimationFrame(tick);
    }
    function stopLoop() {
      if (loopID !== null) global.cancelAnimationFrame(loopID);
      loopID = null; resetClock();
    }
    function watchCanvas(canvas, rebuild) {
      listen(canvas, "webglcontextlost", e => { e.preventDefault(); contextLost = true; changed(); });
      listen(canvas, "webglcontextrestored", () => {
        Promise.resolve().then(rebuild).then(() => { contextLost = false; changed(); })
          .catch(error => options.onError?.(error));
      });
    }
    function watchDevice(device, rebuild) {
      device.lost.then(info => {
        if (disposed) return;
        contextLost = true; changed();
        return Promise.resolve(rebuild(info)).then(() => { contextLost = false; changed(); });
      }).catch(error => options.onError?.(error));
    }
    async function verifyOffline() {
      if (!global.isSecureContext || !global.navigator?.serviceWorker || !/^[a-f0-9]{64}$/.test(version)) return false;
      try {
        const base = new URL(".", global.location.href);
        // A packaged, hash-verifying worker; old hosted games do not register one.
        const registration = await global.navigator.serviceWorker.register(new URL("paean-offline.js", base),
          { scope: base.pathname, updateViaCache: "none" });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Offline installation timeout")), 30000);
          global.navigator.serviceWorker.ready.then(value => { clearTimeout(timeout); resolve(value); },
            error => { clearTimeout(timeout); reject(error); });
        });
        const worker = registration.active;
        if (!worker) return false;
        const result = await new Promise((resolve, reject) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(() => { channel.port1.close(); reject(new Error("Offline verification timeout")); }, 10000);
          channel.port1.onmessage = e => { clearTimeout(timeout); channel.port1.close(); resolve(e.data); };
          worker.postMessage({ type: "paean-offline-status", version }, [channel.port2]);
        });
        const verified = result?.verified === true && result?.version === version;
        report("offline", { version, verified });
        return verified;
      } catch (error) { report("offline", { version, verified: false }); options.onError?.(error); return false; }
    }
    report("configure", { version, canvas: options.canvas === true, opaque: options.opaque === true,
      keepAwake: options.keepAwake === true });
    // Configuration may synchronously change native state; always expose the latest.
    changed();
    return {
      version, state: current, frame, startLoop, stopLoop, checkpoint, restore, watchCanvas, watchDevice, verifyOffline,
      pixelRatio(width, height) {
        const q = state.quality || fallback.quality;
        return Math.max(.25, Math.min(global.devicePixelRatio || 1, q.maxPixelRatio,
          Math.sqrt(q.maxPixels / Math.max(1, width * height))));
      },
      ready() {
        if (isReady || disposed) return;
        isReady = true; resetClock();
        if (host) report("ready", {});
        else global.PaeanNative?.ready?.();
      },
      dispose() {
        if (disposed) return;
        checkpoint(); stopLoop(); disposed = true; listeners.forEach(remove => remove());
      }
    };
  };
})(typeof window === "undefined" ? globalThis : window);
