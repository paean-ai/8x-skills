import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const validator = resolve('codex/paean-game-create/scripts/validate-game.mjs');
const temporaryParents = [];

after(async () => {
  await Promise.all(temporaryParents.map((path) => rm(path, { recursive: true, force: true })));
});

function banner(width = 800, height = 400) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

async function fixture(overrides = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'paean-game-validator-'));
  temporaryParents.push(parent);
  const root = join(parent, 'game');
  await mkdir(join(root, 'scripts'), { recursive: true });
  const files = {
    'index.html': `<!doctype html><html lang="en"><head>
<!-- Copyright (c) 2026 paean.ai and the game's creator(s). -->
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" href="favicon.svg"><link rel="stylesheet" href="styles.css">
</head><body><main id="game"></main><script type="module" src="scripts/main.js"></script></body></html>`,
    'styles.css': 'html,body{width:100%;height:100%;margin:0;overflow:hidden}#game{height:100dvh}',
    'scripts/main.js': 'import "./state.js"; document.querySelector("#game").textContent = "DEMO - TAP TO PLAY";',
    'scripts/state.js': 'export const state = "attract";',
    'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 4h24v24H4z"/></svg>',
    'banner.jpg': banner(),
    ...overrides,
  };
  for (const [name, contents] of Object.entries(files)) {
    if (contents === null) continue;
    const path = join(root, name);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [validator, root, '--static-only'], { encoding: 'utf8' });
}

test('accepts a self-contained pure-JS static game', async () => {
  const result = run(await fixture());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validation passed/);
});

test('rejects TypeScript, external assets, and Vite build dependency', async () => {
  const root = await fixture({
    'debug.ts': 'const score: number = 0;',
    'remote.js': 'import "https://cdn.example/game.js";',
    'package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: 'latest' } }),
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TypeScript is not allowed/);
  assert.match(result.stderr, /external runtime reference/);
  assert.match(result.stderr, /not depend on a Vite build/);
});

test('rejects missing and out-of-directory runtime references', async () => {
  const root = await fixture({
    'scripts/main.js': 'import "./missing.js"; import "../../shared.js";',
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing local runtime reference/);
  assert.match(result.stderr, /out-of-directory runtime reference/);
});

test('requires exact banner dimensions and immediate copyright comment', async () => {
  const root = await fixture({
    'banner.jpg': banner(640, 320),
    'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8">
<!-- Copyright (c) 2026 paean.ai and the game's creator(s). -->
<meta name="viewport" content="width=device-width,viewport-fit=cover">
<link rel="icon" href="favicon.svg"></head><body></body></html>`,
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /copyright comment immediately after/);
  assert.match(result.stderr, /banner.jpg must be 800x400/);
});

test('runs cleanly in Playwright at phone, tablet, and desktop viewports', {
  skip: !process.env.PAEAN_PLAYWRIGHT_NODE_PATH,
}, async () => {
  const root = await fixture();
  const screenshots = join(resolve(root, '..'), 'screenshots');
  const result = spawnSync(process.execPath, [validator, root, '--screenshots', screenshots], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_PATH: process.env.PAEAN_PLAYWRIGHT_NODE_PATH,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PAEAN_PLAYWRIGHT_EXECUTABLE_PATH,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Playwright runtime clean/);
  await Promise.all([
    'phone-compact.png',
    'phone-portrait.png',
    'phone-landscape.png',
    'tablet-portrait.png',
    'tablet-landscape.png',
    'desktop.png',
  ].map((name) => access(join(screenshots, name))));
});

test('closes its local server when Chromium cannot launch', {
  skip: !process.env.PAEAN_PLAYWRIGHT_NODE_PATH,
}, async () => {
  const root = await fixture();
  const result = spawnSync(process.execPath, [validator, root], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_PATH: process.env.PAEAN_PLAYWRIGHT_NODE_PATH,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: join(resolve(root, '..'), 'missing-chromium'),
    },
  });
  assert.equal(result.signal, null, 'validator hung after launch failure');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Validation failed/);
});
