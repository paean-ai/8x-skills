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
];

const browser = await chromium.launch(); // add { executablePath } if using a system browser
let fail = 0;
for (const c of cases) {
  const page = await browser.newPage();
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
