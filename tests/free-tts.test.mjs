// free-tts must stay offline unless cloud synthesis is explicitly requested.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../codex/paean-tts/scripts/free-tts.mjs')

function run(args, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  delete env.PAEAN_AUTH_TOKEN
  delete env.PAEAN_TOKEN
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
}

function withHome(fn) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'free-tts-'))
  try { return fn(home) } finally { rmSync(home, { recursive: true, force: true }) }
}

test('auto never falls through to cloud synthesis when no local engine exists', () => withHome((home) => {
  const out = path.join(home, 'out.wav')
  const result = run(['--text', 'hello', '--out', out], home)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /No local TTS engine found/)
  assert.equal(existsSync(out), false)
}))

test('an explicitly selected local engine that is missing fails clearly', () => withHome((home) => {
  const result = run(['--engine', 'kokoro', '--text', 'hello', '--out', path.join(home, 'out.wav')], home)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /kokoro-tts is not installed/)
}))

test('--list reports when no local engine is installed', () => withHome((home) => {
  const result = run(['--list'], home)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /No local TTS engine found/)
}))

test('auto uses an installed local engine', { skip: process.platform === 'win32' }, () => withHome((home) => {
  const bin = path.join(home, '.local', 'bin')
  mkdirSync(bin, { recursive: true })
  const stub = path.join(bin, 'kokoro-tts')
  const log = path.join(home, 'args.txt')
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`)
  chmodSync(stub, 0o755)
  const result = run(['--text', 'hello', '--out', path.join(home, 'out.wav')], home)
  assert.equal(result.status, 0)
  assert.match(readFileSync(log, 'utf8'), /zm_010/)
}))
