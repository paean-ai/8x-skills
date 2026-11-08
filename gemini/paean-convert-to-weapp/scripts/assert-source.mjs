#!/usr/bin/env node
// Guard the unchanged source boundary using a saved audit-source report.
import { readFileSync } from 'node:fs'
import { auditSource } from './audit-source.mjs'

try {
  if (process.argv.length !== 4) throw new Error('Usage: node assert-source.mjs SOURCE_DIRECTORY BASELINE_AUDIT.json')
  const before = JSON.parse(readFileSync(process.argv[3], 'utf8')), after = auditSource(process.argv[2])
  if (before.schema !== 1 || !Array.isArray(before.files) || !before.sourceDigest) throw new Error('Invalid baseline audit')
  const old = new Map(before.files.map(f => [f.path, f.sha256])), now = new Map(after.files.map(f => [f.path, f.sha256]))
  const changed = [...old.keys()].filter(p => now.has(p) && now.get(p) !== old.get(p))
  const missing = [...old.keys()].filter(p => !now.has(p)), added = [...now.keys()].filter(p => !old.has(p))
  const intact = !changed.length && !missing.length && !added.length && before.sourceDigest === after.sourceDigest
  console.log(JSON.stringify({ status: intact ? 'source-unchanged' : 'source-changed', changed, missing, added, sourceDigest: after.sourceDigest }, null, 2))
  if (!intact) process.exitCode = 1
} catch (error) { console.error(error.message); process.exitCode = 1 }
