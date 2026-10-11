import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packageRuntime } from '../claude-code/paean-game-create/scripts/package-runtime.mjs';

// npm install --no-save playwright (or make it available through NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');
test('real browser: actual rendering, lifecycle, checkpoint, context recovery and verified offline releases', { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'paean-runtime-browser-'));
  let browser, server;
  const errors = [];
  try {
    for (const mode of ['2d', '3d']) {
      const dir = join(root, mode); await mkdir(dir);
      const html = await readFile(new URL('./fixtures/runtime/runtime-' + mode + '.html', import.meta.url), 'utf8');
      await writeFile(join(dir, 'index.html'), html);
      await copyFile(new URL('./fixtures/runtime/runtime-' + mode + '.js', import.meta.url), join(dir, 'runtime-' + mode + '.js'));
      await copyFile(new URL('../claude-code/paean-sdk/reference/paean-runtime.js', import.meta.url), join(dir, 'paean-runtime.js'));
      await packageRuntime(dir);
    }
    server = createServer(async (req, res) => {
      try {
        const path = new URL(req.url, 'http://localhost').pathname;
        const file = resolve(root, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(root + '/')) throw new Error('Invalid path');
        const data = await readFile(file);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html');
        res.setHeader('Cache-Control', 'no-store'); res.end(data);
      } catch { res.writeHead(404); res.end('Missing fixture'); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await context.addInitScript(() => {
      window.runtimeReports = [];
      let state = { paused: false, visible: true, interactive: true, reasons: [],
        quality: { mode: 'play', targetFPS: 60, maxPixelRatio: 2, maxPixels: 2000000, level: 0 } };
      window.__paeanRuntimeHost = { state: () => state,
        configure: value => runtimeReports.push({ type: 'configure', value }),
        ready: () => runtimeReports.push({ type: 'ready' }),
        sample: value => runtimeReports.push({ type: 'sample', value }),
        offline: value => runtimeReports.push({ type: 'offline', value }) };
      window.setRuntimeState = changes => {
        state = { ...state, ...changes };
        dispatchEvent(new CustomEvent('paean:runtime', { detail: state }));
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/2d/');
    await page.waitForFunction(() => runtimeReports.some(r => r.type === 'sample'));
    assert.equal(await page.evaluate(() => runtimeReports.filter(r => r.type === 'ready').length), 1);
    await page.evaluate(() => setRuntimeState({ paused: true, reasons: ['host-modal'] }));
    const before = await page.evaluate(() => runtimeBenchmark.elapsed);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => runtimeBenchmark.elapsed), before);
    await page.evaluate(() => setRuntimeState({ paused: false, reasons: [], quality: { targetFPS: 30, maxPixelRatio: 1, maxPixels: 300000, level: 2 } }));
    await page.waitForFunction(value => runtimeBenchmark.elapsed > value, before);
    assert.ok(await page.evaluate(() => document.querySelector('canvas').width * document.querySelector('canvas').height <= 301000));
    const saved = await page.evaluate(() => { runtimeBenchmark.runtime.checkpoint(); return runtimeBenchmark.elapsed; });
    await page.reload();
    await page.waitForFunction(() => runtimeReports.some(r => r.type === 'ready'));
    assert.ok(await page.evaluate(() => runtimeBenchmark.elapsed) >= saved);
    assert.equal(await page.evaluate(() => runtimeBenchmark.runtime.verifyOffline()), true);
    const version2d = await page.evaluate(() => runtimeBenchmark.runtime.version);
    const second = await context.newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(base + '/3d/');
    await second.waitForFunction(() => runtimeReports.some(r => r.type === 'ready'));
    await second.evaluate(() => { window.loss = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); loss.loseContext(); });
    await second.waitForFunction(() => runtimeBenchmark.runtime.state().paused);
    await second.waitForTimeout(100);
    await second.evaluate(() => loss.restoreContext());
    await second.waitForFunction(() => !runtimeBenchmark.runtime.state().paused);
    assert.equal(await second.evaluate(() => runtimeBenchmark.runtime.verifyOffline()), true);
    assert.notEqual(await second.evaluate(() => runtimeBenchmark.runtime.version), version2d);
    assert.equal(await page.evaluate(() => runtimeBenchmark.runtime.verifyOffline()), true, 'Another release cannot remove the first complete cache');
    await context.setOffline(true);
    await page.goto(base + '/2d/?_r=offline-replay');
    await page.waitForFunction(() => runtimeReports.some(r => r.type === 'ready'));
    await second.reload();
    await second.waitForFunction(() => runtimeReports.some(r => r.type === 'ready'));
    await page.evaluate(async () => {
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) if (request.url.endsWith('/2d/runtime-2d.js')) await cache.delete(request);
      }
    });
    assert.equal(await page.evaluate(() => runtimeBenchmark.runtime.verifyOffline()), false, 'Evicted assets revoke offline availability');
    assert.deepEqual(errors, []);
    console.log('Verified Canvas2D, WebGL2, context loss, pause/resume, checkpoint and offline cache integrity. Desktop software rendering: no device performance claim.');
    await context.close();
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
