/*
 * test-example.mjs — how to test your Paean integration offline with Playwright
 * + mock-bridge.js. Adapt the selectors/asserts to your own app. Run:
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node test-example.mjs
 *
 * (The game validator uses the same `playwright` package, so one install serves
 * both. `playwright-core` also works if you point it at a system browser.)
 *
 * The point: mock-bridge.js reproduces the host-shape variations that only show
 * up on real devices, so you can prove your integration handles them BEFORE
 * publishing — no account, no network, no device farm.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// paean-mock.js is CommonJS; requiring it works whether or not YOUR project
// has "type": "module" in package.json (a bare import would not).
const { mockBridgeSource } = require('./paean-mock.js');
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('playwright-core')); }

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

  // Feed preview: no bridge, __paeanPreview set. The app must NOT prompt for
  // anything and must keep running its demo; the bridge arrives on tap-in.
  { name: 'feed preview stays silent until tap-in',
    mock: mockBridgeSource({ preview: true, grant: ['storage.kv'] }),
    check: async (p) => {
      const parked = await p.evaluate(() => window.__paeanPreview === true && !window.paean
        && window.PaeanSDK.detect().reason === 'preview' && window.__mock.requests.length === 0);
      await p.evaluate(() => window.__mock.enterInteractive());
      await p.waitForTimeout(300);
      const live = await p.evaluate(() => !!window.paean && window.PaeanSDK.detect().supported);
      return parked && live;
    } },

  // Paid app (SDK ≥ 1.10). Boot must stay in demo — no access.require() until
  // the first intentional tap. Trigger your "start" affordance in the check
  // and assert the run only starts once `unlocked` is true.
  { name: 'paid app: demo first, purchase on the first intentional tap',
    mock: mockBridgeSource({ access: { model: 'paid', price: 100 } }),
    check: async (p) => {
      const silentBoot = await p.evaluate(() => window.__mock.accessRequests.length === 0);
      const r = await p.evaluate(() => window.PaeanSDK.access.require());
      return silentBoot && r.unlocked === true && r.reason === 'purchased'
        && (await p.evaluate(() => window.PaeanSDK.access.owned('app')));
    } },
  { name: 'paid app: a declined purchase keeps the demo, never throws',
    mock: mockBridgeSource({ access: { model: 'paid', price: 100, decline: true } }),
    check: async (p) => {
      const r = await p.evaluate(() => window.PaeanSDK.access.require());
      return r.unlocked === false && r.reason === 'declined';
    } },
  { name: 'free app: access.require resolves at once with no UI',
    mock: mockBridgeSource({}),
    check: async (p) => (await p.evaluate(() => window.PaeanSDK.access.require())).unlocked === true },

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
