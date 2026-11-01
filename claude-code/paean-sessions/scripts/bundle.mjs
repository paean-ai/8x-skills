import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

import { creationLimits } from './creation-index.mjs';
const MAX = creationLimits.maxBytes;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const read = path => {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX) throw Error('Select a regular file up to 256 MiB');
  return readFileSync(path);
};

/** Explicit allowlist only. No history scans, command execution or directory recursion. */
export function buildBundle(manifest, manifestDirectory, projectDirectory, prepare) {
  if (!Array.isArray(manifest.streams) || !manifest.streams.length || manifest.streams.length > 100 ||
      !Array.isArray(manifest.scripts) || manifest.scripts.length > 500) throw Error('Expected 1–100 streams and 0–500 script snapshots');
  const root = realpathSync(projectDirectory);
  const streams = new Map();
  for (const s of manifest.streams) {
    if (!identifier(s.id) || streams.has(s.id) || typeof s.file !== 'string') throw Error('Invalid or duplicate stream ID / file');
    if (s.parentStreamId !== undefined && !identifier(s.parentStreamId)) throw Error('Invalid parent stream');
    if (s.parentCallId !== undefined && (!identifier(s.parentCallId) || !s.parentStreamId)) throw Error('Parent call requires parent stream');
    streams.set(s.id, { id: s.id, ...(s.parentStreamId ? { parentStreamId: s.parentStreamId } : {}), ...(s.parentCallId ? { parentCallId: s.parentCallId } : {}) });
  }
  for (const s of streams.values()) {
    const seen = new Set([s.id]);
    let parent = s.parentStreamId;
    while (parent !== undefined) {
      if (!streams.has(parent) || seen.has(parent)) throw Error('Missing or cyclic parent stream');
      seen.add(parent); parent = streams.get(parent).parentStreamId;
    }
  }
  const lines = [];
  let size = 0;
  const append = value => {
    const line = JSON.stringify(value);
    size += Buffer.byteLength(line) + 1;
    if (Buffer.byteLength(line) > creationLimits.maxRecordBytes || size > MAX || lines.length >= 50000) throw Error('Creation bundle exceeds record or total size limits');
    lines.push(line);
  };
  append({ type: 'paean_creation_bundle', version: 1, streams: [...streams.values()] });
  for (const s of manifest.streams) {
    const events = prepare(read(resolve(manifestDirectory, s.file))).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const event of events) {
      if (['paean_creation_bundle', 'creation_event', 'creation_script'].includes(event.type)) throw Error('Select original session logs, not nested creation bundles');
      append({ type: 'creation_event', streamId: s.id, event });
    }
  }
  const scriptIDs = new Set();
  for (const s of manifest.scripts) {
    if (!identifier(s.scriptId) || scriptIDs.has(s.scriptId) || typeof s.file !== 'string') throw Error('Invalid or duplicate script ID / file');
    if (s.streamId !== undefined && !streams.has(s.streamId)) throw Error('Invalid script stream');
    if (s.callId !== undefined && (!identifier(s.callId) || !s.streamId)) throw Error('Script call requires a stream');
    scriptIDs.add(s.scriptId);
    const actual = realpathSync(resolve(root, s.file));
    const path = relative(root, actual);
    if (!path || isAbsolute(path) || path === '..' || path.startsWith('..' + sep)) throw Error('Script must remain inside selected project (including symlinks)');
    const portable = path.split(sep).join('/');
    if (portable.length > 500 || /[\\:\x00-\x1f\x7f]/.test(portable)) throw Error('Invalid relative script path');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(read(actual));
    if (content.includes('\0')) throw Error('Scripts must be UTF-8 text');
    append({ type: 'creation_script', scriptId: s.scriptId, path: portable, content,
      ...(s.streamId ? { streamId: s.streamId } : {}), ...(s.callId ? { callId: s.callId } : {}) });
  }
  return prepare(Buffer.from(lines.join('\n') + '\n'));
}
