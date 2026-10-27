#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export function planCommand(argv, read = file => fs.readFileSync(file, 'utf8')) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') return { help: true };
  const options = {}; let hash;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (['--yes', '--dry-run', '--latest', '--preview'].includes(arg)) options[arg.slice(2)] = true;
    else if (['--version', '--price', '--request-key', '--file', '--title', '--preview-file', '--language', '--offset', '--path', '--max-bytes'].includes(arg)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = rest[++i];
    } else if (!hash && !arg.startsWith('--')) hash = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(hash || '')) throw new Error('A game/tutorial hashKey is required');
  const integer = (name, min = 1) => { const n = Number(options[name]); if (!Number.isSafeInteger(n) || n < min || n > 100000) throw new Error(`--${name} must be an integer between ${min} and 100000`); return n; };
  const file = () => { if (!options.file) throw new Error('--file is required'); return JSON.parse(read(options.file)); };
  const documentFile = (saving = false) => {
    if (!options.file) throw new Error('--file is required');
    const raw = read(options.file);
    if (Buffer.byteLength(raw) > 500000) throw new Error('Document exceeds 500 KB');
    const ext = path.extname(options.file).toLowerCase();
    if (ext === '.json') return { document: JSON.parse(raw), mergeDraft: false };
    if (!['.html', '.htm', '.md', '.markdown'].includes(ext)) throw new Error('Use an HTML, Markdown or JSON file');
    const document = { format: ['.html', '.htm'].includes(ext) ? 'html' : 'markdown', content: raw };
    if (!saving) Object.assign(document, { title: path.basename(options.file, ext), priceCredits: 0 });
    if (options.title !== undefined) document.title = options.title;
    if (options.price !== undefined) document.priceCredits = integer('price', 0);
    if (options.language !== undefined) document.language = options.language;
    if (options['preview-file']) document.previewContent = read(options['preview-file']);
    return { document, mergeDraft: saving };
  };
  let method = 'GET', endpoint, body, mergeDraft = false;
  switch (command) {
    case 'list': endpoint = `/square/apps/${hash}/tutorials`; break;
    case 'show': endpoint = `/square/tutorials/${hash}`; break;
    case 'source-file': {
      const query = new URLSearchParams();
      if (options.path) query.set('path', options.path);
      if (options['max-bytes']) { const n = Number(options['max-bytes']); if (!Number.isInteger(n) || n < 1024 || n > 262144) throw new Error('--max-bytes must be 1024–262144'); query.set('maxBytes', String(n)); }
      endpoint = `/square/tutorials/${hash}/source-file?${query}`; break;
    }
    case 'source-files': case 'draft': case 'quote': case 'progress': case 'revenue': endpoint = `/square/tutorials/${hash}/${command}`; break;
    case 'skill': {
      const query = new URLSearchParams();
      if (options.version) query.set('version', integer('version'));
      if (options.path) query.set('path', options.path);
      endpoint = `/square/tutorials/${hash}/skill${query.size ? `?${query}` : ''}`; break;
    }
    case 'content': {
      const query = new URLSearchParams();
      if (options.version) query.set('version', integer('version'));
      if (options.preview) query.set('preview', '1');
      endpoint = `/square/tutorials/${hash}/content${query.size ? `?${query}` : ''}`; break;
    }
    case 'create': method = 'POST'; endpoint = `/square/apps/${hash}/tutorials`; body = documentFile().document; break;
    case 'save': {
      method = 'PATCH'; endpoint = `/square/tutorials/${hash}/draft`;
      const doc = documentFile(true); mergeDraft = doc.mergeDraft;
      body = { expectedVersion: integer('version'), document: doc.document }; break;
    }
    case 'publish': method = 'POST'; endpoint = `/square/tutorials/${hash}/publish`; body = { expectedVersion: integer('version') }; break;
    case 'unpublish': case 'learn': method = 'POST'; endpoint = `/square/tutorials/${hash}/${command}`; body = command === 'learn' && options.latest ? { useLatest: true, expectedVersion: integer('version') } : {}; break;
    case 'notes': method = 'PATCH'; endpoint = `/square/tutorials/${hash}/progress`; body = file(); break;
    case 'buy':
      method = 'POST'; endpoint = `/square/tutorials/${hash}/purchase`;
      body = { requestKey: options['request-key'] || randomUUID(), expectedPriceCredits: integer('price', 0), expectedVersion: integer('version') };
      if (!/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestKey)) throw new Error('Invalid --request-key');
      break;
    default: throw new Error(`Unknown command: ${command}`);
  }
  if ((['buy', 'publish', 'unpublish'].includes(command) || options.latest) && !options.yes && !options['dry-run'])
    throw new Error(`${command} requires --yes after user authorization`);
  if (options.offset && command === 'list') endpoint += `?offset=${integer('offset', 0)}`;
  return { method, endpoint, ...(mergeDraft ? { mergeDraft: true } : {}), ...(body === undefined ? {} : { body }), dryRun: !!options['dry-run'] };
}
export function credentials(env = process.env, home = os.homedir()) {
  if (env.PAEAN_AUTH_TOKEN) return env.PAEAN_AUTH_TOKEN;
  for (const file of [path.join(home, '.paean/credentials.json'), path.join(home, '.zero/credentials.json')]) {
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (typeof value.token === 'string' && value.token) return value.token; } catch { /* Try the next standard location. */ }
  }
  return null;
}
export async function execute(plan, { token, base = process.env.PAEAN_API_BASE_URL || 'https://api.paean.ai', fetchImpl = fetch } = {}) {
  if (plan.dryRun || plan.help) return plan;
  token ??= credentials();
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:')) throw new Error('API base must use HTTPS (except local development)');
  if (plan.method !== 'GET' && !token) throw new Error('Sign in to Paean before modifying or buying tutorials');
  const request = async (method, endpoint, body) => {
    const response = await fetchImpl(`${base.replace(/\/$/, '')}${endpoint}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.code || ''} ${data.error || 'Tutorial request failed'}`);
    return data;
  };
  let body = plan.body;
  if (plan.mergeDraft) {
    const draft = (await request('GET', plan.endpoint)).data;
    if (draft.draftVersion !== body.expectedVersion) throw new Error('The draft changed. Reload before saving.');
    // Raw .html/.md updates replace content while preserving pricing and public preview.
    body = { ...body, document: { ...draft.document, ...body.document } };
  }
  const data = await request(plan.method, plan.endpoint, body);
  return data;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const plan = planCommand(process.argv.slice(2));
    if (plan.help) console.log('tutorial.mjs list|show|draft|create|save|publish|unpublish|quote|buy|content|skill|learn|progress|notes|revenue [hashKey] [--file path] [--version n] [--price credits] [--title text] [--preview-file path] [--preview] [--latest] [--request-key key] [--yes] [--dry-run]');
    else console.log(JSON.stringify(await execute(plan), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
