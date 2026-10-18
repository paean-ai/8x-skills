#!/usr/bin/env node
/** Portable Paean cloud computer client. No cloud-provider credentials needed. */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGIONS = Object.freeze({ hongkong: 'https://pc.paean.ai', beijing: 'https://cc.paean.ai', singapore: 'https://sg.paean.ai' });
const API = 'https://api.paean.ai';
const ws = /^ws-[a-f0-9]{32}$/;
const run = /^cr-[a-f0-9]{32}$/;
export function credentials(env = process.env, home = homedir()) {
  for (const name of ['PAEAN_AUTH_TOKEN', 'PAEAN_API_KEY']) {
    if (env[name] !== undefined) {
      if (!env[name].trim()) throw new Error(`${name} is empty; refusing to switch identities.`);
      return env[name].trim();
    }
  }
  const files = env.PAEAN_CREDENTIALS_FILE ? [env.PAEAN_CREDENTIALS_FILE] : [path.join(home, '.zero/credentials.json'), path.join(home, '.paean/credentials.json')];
  for (const file of files) {
    if (!existsSync(file)) { if (env.PAEAN_CREDENTIALS_FILE) throw new Error('Explicit credential file not found.'); continue; }
    let value;
    try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('Paean credential file is invalid.'); }
    const token = value.token || value.apiKey || value.paean_token;
    if (typeof token === 'string' && token.trim()) return token.trim();
    throw new Error('Paean credential file has no token. Sign in with zero login.');
  }
  throw new Error('Sign in with zero login, or configure PAEAN_AUTH_TOKEN securely. Never paste credentials into chat.');
}
function id(value, pattern) { if (!pattern.test(value || '')) throw new Error('Invalid resource ID. Use the ID returned by list.'); return value; }
export function operation(group, command, options = {}) {
  const region = options.region || 'beijing';
  if (!Object.hasOwn(REGIONS, region)) throw new Error('Region must be beijing, hongkong or singapore.');
  if (group === 'personal') {
    const origin = REGIONS[region];
    if (command === 'list') return { origin, path: '/v1/workspaces', method: 'GET' };
    if (command === 'backups') return { origin, path: '/v1/workspace-backups', method: 'GET' };
    if (command === 'create') {
      if (options.backup && !/^wbk-[a-f0-9]{32}$/.test(options.backup)) throw new Error('Invalid backup ID.');
      return { origin, path: '/v1/workspaces', method: 'POST', body: { restore_backup_id: options.backup || '' } };
    }
    const resource = id(options.id, ws);
    if (command === 'get') return { origin, path: '/v1/workspaces/' + resource, method: 'GET' };
    if (['pause', 'resume', 'connect'].includes(command)) return { origin, path: `/v1/workspaces/${resource}/${command}`, method: 'POST' };
    if (command === 'delete') {
      if (!options.confirm) throw new Error('Deletion requires --confirm after user authorization. The server must complete private backup first.');
      return { origin, path: '/v1/workspaces/' + resource, method: 'DELETE' };
    }
  }
  if (group === 'tasks') {
    if (options.region && options.region !== 'beijing') throw new Error('Delegated tasks currently run in Beijing; personal computers are regional.');
    if (command === 'list') return { origin: API, path: '/cloud-computer/tasks', method: 'GET' };
    if (command === 'submit') {
      if (!options.prompt || options.prompt.length > 16000 || !options.prompt.trim()) throw new Error('A nonempty brief of at most 16000 characters is required.');
      if (!options.requestKey || options.requestKey.length > 128) throw new Error('Set --request-key once for this task; reuse it after an uncertain submission.');
      const timeout = Number(options.timeout || 3600);
      if (!Number.isInteger(timeout) || timeout < 60 || timeout > 10800) throw new Error('Timeout must be 60–10800 seconds.');
      const model = options.model || 'praxis-auto';
      if (!['praxis-auto','praxis-lite','praxis-flash','praxis-pro'].includes(model)) throw new Error('Invalid task model.');
      return { origin: API, path: '/cloud-computer/tasks', method: 'POST', body: { prompt: options.prompt, request_key: options.requestKey, timeout_seconds: timeout, model } };
    }
    const resource = id(options.id, run);
    if (['get','artifacts','cancel'].includes(command)) return { origin: API, path: '/cloud-computer/tasks/' + resource + (command === 'get' ? '' : '/' + command), method: command === 'cancel' ? 'POST' : 'GET' };
  }
  throw new Error('Unknown command. Run --help.');
}
export function client({ token, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('Paean login required.');
  let credential = token;
  async function renew() {
    const renewed = await fetchImpl(REGIONS.beijing + '/auth/refresh', { method:'POST', redirect:'error', signal:AbortSignal.timeout(15000), headers:{Authorization:'Bearer '+credential, Origin:REGIONS.beijing} });
    if (renewed.ok) { const value=await renewed.json(); if(typeof value.token==='string' && value.token){credential=value.token; return true;} }
    return false;
  }
  async function call(spec, refresh = true) {
    if (![API, ...Object.values(REGIONS)].includes(spec.origin) || !/^\/(v1\/workspaces(?:\/ws-[a-f0-9]{32}(?:\/(?:pause|resume|connect))?)?|v1\/workspace-backups|cloud-computer\/tasks(?:\/cr-[a-f0-9]{32}(?:\/(?:cancel|artifacts))?)?)$/.test(spec.path)) throw new Error('Refusing to send credentials to an unsupported endpoint.');
    if (refresh && credential.split('.').length === 3) {
      let expires = 0;
      try { expires = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url')).exp * 1000; } catch {}
      if (expires > Date.now() && expires < Date.now() + 300000) await renew();
    }
    const response = await fetchImpl(spec.origin + spec.path, { method: spec.method, redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: 'Bearer ' + credential, Origin: spec.origin, 'Content-Type': 'application/json' }, body: spec.body === undefined ? undefined : JSON.stringify(spec.body) });
    if (response.status === 401 && refresh && credential.split('.').length === 3) {
      // Renew only through the trusted portal; retain the current identity and
      // credential in memory. Never write a refreshed token to stdout or disk.
      if (await renew()) return call(spec, false);
    }
    if (!response.ok) {
      const reason = response.status===401?'Paean login expired; run zero login.':response.status===402||response.status===403?'Check your account, cloud-computer subscription and credits.':response.status===409?'Operation conflicts with the current state. Read status before retrying.':'Request failed. Read status before retrying a mutation; reuse the same task request key.';
      throw new Error(`HTTP ${response.status}: ${reason}`);
    }
    return response.status === 204 ? { ok:true } : response.json();
  }
  return { call };
}
export function parse(argv) {
  const [group, command, ...rest] = argv; const options = {};
  const flags = { '--region':'region','--id':'id','--backup':'backup','--prompt-file':'promptFile','--request-key':'requestKey','--timeout':'timeout','--model':'model' };
  for (let i=0;i<rest.length;i++) {
    const flag=rest[i]; if(flag==='--confirm'){options.confirm=true;continue;}
    if(!flags[flag] || !rest[i+1] || rest[i+1].startsWith('--')) throw new Error('Unknown or incomplete option: '+flag);
    if(options[flags[flag]] !== undefined)throw new Error('Repeated option: '+flag);
    options[flags[flag]]=rest[++i];
  }
  if(options.promptFile)options.prompt=readFileSync(options.promptFile,'utf8');
  return {group,command,options};
}
const HELP = `Paean cloud computer — infrastructure for your Personal Agent
Node.js 18+, zero login or a securely configured Paean token.

personal list|backups|create [--region beijing|hongkong|singapore] [--backup ID]
personal get|pause|resume|connect --id ws-… [--region …]
personal delete --id ws-… --region … --confirm

tasks list
tasks submit --prompt-file brief.md --request-key UNIQUE_STABLE_KEY [--timeout 3600] [--model praxis-auto]
tasks get|cancel|artifacts --id cr-…

Personal computers retain their environment across pause/resume. Deletion
creates a private backup first; inspect status until complete. Delegated tasks
use a separate Beijing computer; local files are NOT transferred automatically.
Cloud compute and model usage may cost credits. Private result/connection links
are sensitive; do not publish them. This CLI never prints the Paean credential.`;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help') || process.argv.length===2) console.log(HELP);
    else {const {group,command,options}=parse(process.argv.slice(2)); const spec=operation(group,command,options); console.log(JSON.stringify(await client({token:credentials()}).call(spec),null,2));}
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
