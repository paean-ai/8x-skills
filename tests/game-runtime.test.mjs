import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { packageRuntime, verifyRuntimePackage, workerSource } from "../claude-code/paean-game-create/scripts/package-runtime.mjs";

const runtimeSource = await readFile(new URL("../claude-code/paean-sdk/reference/paean-runtime.js", import.meta.url), "utf8");
function runtime() {
  const events = new Map(), callbacks = new Map(), storage = new Map(), reports = [];
  let time = 0, id = 0;
  const context = {
    TextEncoder, performance: { now: () => time }, devicePixelRatio: 3, document: { hidden: false, querySelector: () => null },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); },
    requestAnimationFrame(fn) { callbacks.set(++id, fn); return id; }, cancelAnimationFrame(id) { callbacks.delete(id); },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    __paeanRuntimeHost: {
      state: () => ({ paused: false, visible: true, interactive: true,
        quality: { targetFPS: 60, maxPixelRatio: 2, maxPixels: 1000000, level: 0 } }),
      configure: data => reports.push(["configure", data]), ready: () => reports.push(["ready"]),
      sample: data => reports.push(["sample", data])
    }
  };
  context.document.addEventListener = context.addEventListener;
  context.document.removeEventListener = context.removeEventListener;
  context.window = context;
  vm.runInNewContext(runtimeSource, context);
  return { context, reports, storage, events,
    tick(value) { time = value; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn(time)); }
  };
}

test("ready is explicit, frame summaries count actual renders, resume resets dt", () => {
  const env = runtime(), steps = [];
  const game = env.context.createPaeanRuntime({ canvas: true, saveSchema: 1 });
  assert.equal(env.reports.filter(r => r[0] === "ready").length, 0);
  game.ready(); game.ready();
  game.startLoop(dt => steps.push(dt));
  for (let i = 0; i < 150; i++) env.tick(i * 17);
  assert.equal(env.reports.filter(r => r[0] === "ready").length, 1);
  assert.equal(env.reports.filter(r => r[0] === "sample").length, 1);
  assert.ok(game.pixelRatio(390, 844) < 2);
  const oldState = game.state();
  env.events.get("paean:runtime")({ detail: { ...oldState, paused: true, reasons: ["host-modal"] } });
  const count = steps.length; env.tick(60000);
  assert.equal(steps.length, count);
  env.events.get("paean:runtime")({ detail: { ...oldState, paused: false } });
  env.tick(120000);
  assert.equal(steps.at(-1), 0);
  game.dispose(); env.tick(120020); assert.equal(steps.length, count + 1);
});

test("checkpoint schema and validation preserve progress without account calls", () => {
  const env = runtime(); let level = 7;
  const game = env.context.createPaeanRuntime({ saveKey: "test", getSave: () => ({ level }),
    applySave: value => { if (!Number.isInteger(value.level)) return false; level = value.level; } });
  game.ready(); assert.equal(game.checkpoint(), true); level = 0;
  assert.equal(game.restore(), true); assert.equal(level, 7);
  const other = env.context.createPaeanRuntime({ saveKey: "test", saveSchema: 2 });
  assert.equal(other.restore(), false);
  game.dispose(); other.dispose();
});

test("release packaging is deterministic and detects changed or missing resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "paean-runtime-"));
  try {
    await writeFile(join(root, "index.html"), '<html><head><!-- Copyright (c) 2026 --></head><body><script>createPaeanRuntime({});</script></body></html>');
    await writeFile(join(root, "asset.js"), "window.level=1");
    const first = await packageRuntime(root), second = await packageRuntime(root);
    assert.equal(first.version, second.version);
    assert.deepEqual(await verifyRuntimePackage(root, true), []);
    await writeFile(join(root, "asset.js"), "window.level=2");
    assert.match((await verifyRuntimePackage(root, true)).join(), /changed after packaging/);
    await rm(join(root, "asset.js"));
    assert.match((await verifyRuntimePackage(root, true)).join(), /Missing runtime asset/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("offline worker rejects incomplete installs and never exposes a partial cache", async () => {
  const handlers = {}, caches = new Map();
  const manifest = { schema: 1, version: "a".repeat(64), assets: [{ path: "index.html", bytes: 5, sha256: "b".repeat(64) }] };
  vm.runInNewContext(workerSource(manifest), {
    URL, Response, crypto: webcrypto,
    self: { location: { href: "https://game.example/paean-offline.js" }, addEventListener: (name, fn) => handlers[name] = fn },
    caches: {
      open: async key => { const cache = { match: async () => undefined, put: async () => {} }; caches.set(key, cache); return cache; },
      delete: async key => caches.delete(key)
    },
    fetch: async () => new Response("wrong")
  });
  let pending;
  handlers.install({ waitUntil: promise => pending = promise });
  await assert.rejects(pending, /integrity mismatch/);
  assert.equal(caches.size, 0);
});

test('performance gate rejects short/interrupted evidence and separates FPS profiles', async () => {
  const { analyzeRuntime } = await import('../claude-code/paean-game-create/scripts/analyze-runtime.mjs');
  const event = i => ({ event: 'frames', contentKey: 'game', version: 'a'.repeat(64), mode: 'play',
    timestamp: i * 2, appBuild: '1', systemVersion: '26',
    values: { elapsed: 2000, frames: 120, targetFPS: 60, p95: 17, longFrames: 0, veryLongFrames: 0 } });
  const metadata = { kind: 'physical-device', device: 'test-fixture' };
  const full = Array.from({ length: 450 }, (_, i) => event(i));
  assert.equal(analyzeRuntime(full, metadata).profiles[0].frameGate, 'passed');
  assert.equal(analyzeRuntime(full.slice(0, 30), metadata).profiles[0].frameGate, 'not-passed');
  full.splice(200, 0, { event: 'paused' });
  assert.equal(analyzeRuntime(full, metadata).profiles[0].frameGate, 'not-passed');
  assert.equal(analyzeRuntime([event(0)]).profiles[0].frameGate, 'not-passed');
  const incomplete = event(0); delete incomplete.values.elapsed;
  const report = analyzeRuntime([incomplete], metadata).profiles[0];
  assert.equal(report.frameGate, 'not-passed');
  assert.ok(!report.blockers.some(reason => reason.startsWith('Frame stability')), 'Missing data is not evidence of a performance failure');
});
