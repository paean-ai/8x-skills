/*
 * test-example.mjs — how to test your Paean integration offline with Playwright
 * + mock-bridge.js. Adapt the selectors/asserts to your own app. Run:
 *
 *   npm i -D playwright-core            # or use your installed browser
 *   node test-example.mjs
 *
 * The point: mock-bridge.js reproduces the host-shape variations that only show
 * up on real devices, so you can prove your integration handles them BEFORE
 * publishing — no account, no network, no device farm.
 */
import { chromium } from 'playwright-core';
import { mockBridgeSource } from './mock-bridge.js';

const APP_URL = process.env.APP_URL || 'http://localhost:8000/'; // your app

const cases = [
  { name: 'plain browser stays playable', mock: null,
    check: async (p) => (await p.evaluate(() => !!window.PaeanSDK)) },

  { name: 'silent connect when host pre-granted', expectAuth: true,
    mock: mockBridgeSource({ grant: ['storage.kv', 'storage.leaderboard', 'account.profile'],
      seed: { save: { best: 9000 } }, me: { userKey: 'me', displayName: 'Tester' } }) },

  { name: 'iOS-like: storage granted, leaderboard withheld', expectAuth: true,
    mock: mockBridgeSource({ grantExcept: ['storage.leaderboard'], me: { userKey: 'me' } }) },

  { name: 'host rejects unknown scope wholesale', expectAuth: true,
    mock: mockBridgeSource({ throwOnScope: ['storage.leaderboard'], me: { userKey: 'me' } }) },

  { name: 'missing save as resolved null', mock: mockBridgeSource({ grant: ['storage.kv'], missingAsNull: true }) },
  { name: 'missing save as rejected 404', mock: mockBridgeSource({ grant: ['storage.kv'] }) },
  { name: 'bare-value storage.get shape', mock: mockBridgeSource({ grant: ['storage.kv'], returnBare: true, seed: { save: { best: 1 } } }) },

  // Host chrome. The asserts below only prove the contract is published and
  // self-consistent — whether your HUD actually clears the capsule is a LOOK:
  // screenshot this case and check nothing readable or tappable sits in the
  // top-right rect.
  { name: 'host chrome published on both channels',
    mock: mockBridgeSource({ grant: ['storage.kv'], chrome: true }),
    check: async (p) => {
      const ok = await p.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const px = (n) => parseFloat(css.getPropertyValue(n));
        const r = window.paean.chromeRect();
        return !!r
          && r.left + r.width + r.right === window.innerWidth   // derived from the live viewport
          && r.top + r.height + r.bottom === window.innerHeight
          && px('--paean-chrome-inset-top') === r.top + r.height // CSS agrees with JS
          && px('--paean-safe-bottom') === window.paean.safeArea().bottom;
      });
      // Rotation: the capsule keeps its right-edge anchor and the event fires.
      await p.evaluate(() => {
        window.__rotated = null;
        window.addEventListener('paeanchromechange', (e) => { window.__rotated = e.detail.chrome; });
      });
      await p.setViewportSize({ width: 852, height: 393 });
      await p.waitForTimeout(100);
      const rotated = await p.evaluate(() => window.__rotated && window.__rotated.right === 16);
      return ok && rotated;
    } },
];

const browser = await chromium.launch(); // add { executablePath } if using a system browser
let fail = 0;
for (const c of cases) {
  // Phone-shaped: the mock derives the capsule's left/bottom edges from the
  // live viewport, so a desktop window would park the fake capsule far from
  // wherever your HUD actually sits and hide the collision it exists to show.
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (c.mock) await page.addInitScript(c.mock);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const clean = errs.length === 0;
  let extra = true;
  if (typeof c.check === 'function') extra = await c.check(page);
  const passed = clean && extra;
  console.log((passed ? 'PASS' : 'FAIL') + '  ' + c.name + (errs.length ? '  ' + errs[0] : ''));
  if (!passed) fail++;
  await page.close();
}
await browser.close();
console.log(fail ? `\n${fail} failed` : '\nall clear');
process.exit(fail ? 1 : 0);
