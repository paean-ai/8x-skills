#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

const ignoredDirs = new Set(['.git', '.clide', '.remix-sources', 'node_modules']);
const textExts = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg']);
const sourceExts = new Set(['.html', '.css', '.js', '.mjs']);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mid': 'audio/midi', '.midi': 'audio/midi', '.woff2': 'font/woff2',
};

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: node validate-game.mjs <game-directory> [--static-only] [--screenshots <directory>]');
  process.exit(2);
}

function parseArgs(argv) {
  const result = { root: null, staticOnly: false, screenshots: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node validate-game.mjs <game-directory> [--static-only] [--screenshots <directory>]');
      process.exit(0);
    } else if (arg === '--static-only') result.staticOnly = true;
    else if (arg === '--screenshots') {
      if (!argv[i + 1]) usage('--screenshots needs a directory');
      result.screenshots = resolve(argv[++i]);
    } else if (arg.startsWith('-')) usage(`unknown option ${arg}`);
    else if (result.root) usage('provide exactly one game directory');
    else result.root = resolve(arg);
  }
  if (!result.root) usage('missing game directory');
  return result;
}

async function walk(root, dir = root) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let i = 2;
  while (i + 8 < buffer.length) {
    if (buffer[i] !== 0xff) { i += 1; continue; }
    const marker = buffer[i + 1];
    if (sof.has(marker)) return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : null;
}

function collectRuntimeRefs(text, extension) {
  const refs = [];
  if (extension === '.html') {
    for (const match of text.matchAll(/<(?:script|img|audio|video|source|track|iframe|link)\b[^>]*>/gi)) {
      const value = attr(match[0], 'src') ?? attr(match[0], 'href') ?? attr(match[0], 'poster');
      if (value) refs.push(value);
      const srcset = attr(match[0], 'srcset');
      if (srcset) refs.push(...srcset.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]));
    }
  }
  if (extension === '.css' || extension === '.html') {
    for (const match of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) refs.push(match[2]);
    for (const match of text.matchAll(/@import\s*(["'])(.*?)\1/gi)) refs.push(match[2]);
  }
  if (extension === '.js' || extension === '.mjs' || extension === '.html') {
    const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(|)\s*|\bfetch\s*\(|\bnew\s+(?:Worker|Audio|URL)\s*\()(["'])(.*?)\1/g;
    for (const match of text.matchAll(importPattern)) refs.push(match[2]);
  }
  return refs;
}

function normalizeRuntimeRef(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:data|blob|javascript):/i.test(trimmed)) return null;
  return trimmed.split('#')[0].split('?')[0];
}

async function staticChecks(root) {
  const errors = [];
  const warnings = [];
  let rootInfo;
  try { rootInfo = await stat(root); } catch { errors.push(`game directory does not exist: ${root}`); return { errors, warnings, files: [] }; }
  if (!rootInfo.isDirectory()) { errors.push(`not a directory: ${root}`); return { errors, warnings, files: [] }; }

  const files = await walk(root);
  const relFiles = new Set(files.map((file) => relative(root, file).split(sep).join('/')));
  for (const required of ['index.html', 'favicon.svg', 'banner.jpg']) {
    if (!relFiles.has(required)) errors.push(`missing top-level ${required}`);
  }
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const extension = extname(file).toLowerCase();
    if (['.ts', '.tsx', '.mts', '.cts'].includes(extension)) errors.push(`TypeScript is not allowed: ${rel}`);
    const info = await stat(file);
    if (textExts.has(extension) && info.size > 128 * 1024) warnings.push(`large editable source file (${Math.ceil(info.size / 1024)} KiB): ${rel}`);
    if (!textExts.has(extension)) continue;
    const text = await readFile(file, 'utf8');
    if (text.split('\n').length > 1500) warnings.push(`long editable source file (${text.split('\n').length} lines): ${rel}`);
    if (/\p{Extended_Pictographic}/u.test(text) && sourceExts.has(extension)) warnings.push(`possible emoji used in source/UI; inspect authored iconography: ${rel}`);
    if (!sourceExts.has(extension)) continue;
    for (const rawRef of collectRuntimeRefs(text, extension)) {
      const ref = normalizeRuntimeRef(rawRef);
      if (!ref) continue;
      if (/^(?:https?:)?\/\//i.test(ref) || /^file:/i.test(ref)) {
        errors.push(`external runtime reference in ${rel}: ${rawRef}`);
        continue;
      }
      if (ref.startsWith('/')) {
        errors.push(`root-absolute runtime reference in ${rel}: ${rawRef}`);
        continue;
      }
      const target = resolve(file, '..', decodeURIComponent(ref));
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        errors.push(`out-of-directory runtime reference in ${rel}: ${rawRef}`);
        continue;
      }
      try { await stat(target); } catch { errors.push(`missing local runtime reference in ${rel}: ${rawRef}`); }
    }
  }

  if (relFiles.has('index.html')) {
    const html = await readFile(join(root, 'index.html'), 'utf8');
    const head = /<head(?:\s[^>]*)?>/i.exec(html);
    if (!head) errors.push('index.html has no <head>');
    else {
      const afterHead = html.slice(head.index + head[0].length);
      if (!/^\s*<!--\s*Copyright \(c\) 2026 paean\.ai and the game['’]s creator\(s\)\.\s*-->/i.test(afterHead)) {
        errors.push('put the standard 2026 paean.ai copyright comment immediately after <head>');
      }
    }
    const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
    if (!/^en(?:-|$)/i.test(attr(htmlTag, 'lang') ?? '')) warnings.push('default document language should be English: <html lang="en">');
    const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
    const viewport = metas.find((tag) => (attr(tag, 'name') ?? '').toLowerCase() === 'viewport');
    const viewportContent = viewport ? (attr(viewport, 'content') ?? '') : '';
    if (!/width=device-width/i.test(viewportContent) || !/viewport-fit=cover/i.test(viewportContent)) {
      errors.push('viewport meta must include width=device-width and viewport-fit=cover');
    }
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
    const icon = links.find((tag) => /\bicon\b/i.test(attr(tag, 'rel') ?? ''));
    if (!icon || normalizeRuntimeRef(attr(icon, 'href') ?? '') !== 'favicon.svg') errors.push('index.html must link top-level favicon.svg');
  }

  if (relFiles.has('banner.jpg')) {
    const dimensions = jpegDimensions(await readFile(join(root, 'banner.jpg')));
    if (!dimensions) errors.push('banner.jpg is not a readable JPEG');
    else if (dimensions.width !== 800 || dimensions.height !== 400) errors.push(`banner.jpg must be 800x400, got ${dimensions.width}x${dimensions.height}`);
  }

  if (relFiles.has('package.json')) {
    try {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.vite || /\bvite\b/.test(pkg.scripts?.build ?? '')) errors.push('game must run directly and not depend on a Vite build');
    } catch { errors.push('package.json is invalid JSON'); }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], files };
}

async function startServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const path = resolve(root, `.${pathname}`);
      if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('outside root');
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  return server;
}

async function runtimeChecks(root, screenshotDir) {
  let chromium;
  for (const base of [join(root, 'package.json'), join(process.cwd(), 'package.json')]) {
    try { ({ chromium } = createRequire(base)('playwright')); break; } catch { /* try next location */ }
  }
  if (!chromium) try { ({ chromium } = await import('playwright')); } catch { /* report below */ }
  if (!chromium) {
    throw new Error('Playwright is required for final validation. Install it in the working environment and run `npx playwright install chromium`.');
  }
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const server = await startServer(root);
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const profiles = [
    { name: 'phone-portrait', viewport: { width: 390, height: 844 }, mobile: true },
    { name: 'phone-landscape', viewport: { width: 844, height: 390 }, mobile: true },
    { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
  ];
  const errors = [];
  let browser;
  try {
    const launchOptions = { headless: true };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browser = await chromium.launch(launchOptions);
    for (const profile of profiles) {
      const context = await browser.newContext({ viewport: profile.viewport, hasTouch: profile.mobile, isMobile: profile.mobile, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`${profile.name} pageerror: ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`${profile.name} console: ${message.text()}`); });
      page.on('request', (request) => {
        if (!request.url().startsWith(origin) && !/^(?:data|blob):/.test(request.url())) errors.push(`${profile.name} external request: ${request.url()}`);
      });
      page.on('response', (response) => {
        if (response.url().startsWith(origin) && response.status() >= 400) errors.push(`${profile.name} local HTTP ${response.status()}: ${response.url()}`);
      });
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => ({
        x: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
        y: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) - window.innerHeight,
      }));
      if (overflow.x > 1 || overflow.y > 1) errors.push(`${profile.name} viewport scrolls by ${Math.max(0, overflow.x)}x${Math.max(0, overflow.y)} CSS px`);
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${profile.name}.png`), fullPage: false });
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((done) => server.close(done));
  }
  return [...new Set(errors)];
}

const args = parseArgs(process.argv.slice(2));
const result = await staticChecks(args.root);
let runtimeErrors = [];
if (!args.staticOnly && result.errors.length === 0) {
  try { runtimeErrors = await runtimeChecks(args.root, args.screenshots); }
  catch (error) { runtimeErrors.push(error.message); }
}

for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
for (const error of [...result.errors, ...runtimeErrors]) console.error(`ERROR ${error}`);
const failures = result.errors.length + runtimeErrors.length;
if (failures) {
  console.error(`\nValidation failed with ${failures} error(s) and ${result.warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  console.log(`Validation passed: ${result.files.length} files, ${result.warnings.length} warning(s)${args.staticOnly ? ' (static only)' : ', Playwright runtime clean'}.`);
  if (args.screenshots) console.log(`Screenshots: ${args.screenshots}`);
}
