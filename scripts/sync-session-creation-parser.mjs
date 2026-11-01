#!/usr/bin/env node
// Development-only: vendor the backend parser without runtime TypeScript/API dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const at=process.argv.indexOf('--api-dir');
if(at<0 || !process.argv[at+1] || process.argv[at+1].startsWith('--'))throw Error('Usage: --api-dir <zero-api-checkout> [--check]');
const api=resolve(process.argv[at+1]);
const ts=createRequire(join(api,'package.json'))('typescript');
const source=readFileSync(join(api,'src/modules/session-assets/creation.ts'),'utf8');
const dependency='import { SessionError } from "./config";';
if(!source.includes(dependency))throw Error('Backend parser imports changed; review the standalone adapter');
const adapted=source.replace(dependency,'class SessionError extends Error { constructor(public status: number, message: string) { super(message); } }');
const digest=createHash('sha256').update(source).digest('hex');
const compiled=ts.transpileModule(adapted,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2020}}).outputText;
if(/from ["']\./.test(compiled))throw Error('Backend parser added a local dependency; review the standalone adapter');
const expected=`// Generated from zero-api src/modules/session-assets/creation.ts (SHA-256 ${digest}).\n// Standalone Node adapter; no database, network, credentials or script execution.\n${compiled}`;
const target=resolve(dirname(fileURLToPath(import.meta.url)),'../claude-code/paean-sessions/scripts/creation-index.mjs');
if(process.argv.includes('--check')) {
  if(readFileSync(target,'utf8')!==expected)throw Error('Offline parser is stale; regenerate it and sync variants');
  console.log('Offline parser matches backend source');
} else {
  writeFileSync(target,expected);
  console.log('Updated offline parser; run node scripts/sync-variants.mjs');
}
