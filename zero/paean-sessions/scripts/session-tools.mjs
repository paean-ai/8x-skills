// Canonical implementation. sync-variants.mjs also bundles this in paean-publish.
// Local only: nothing here uploads, and transcript contents are never printed or executed.
import { existsSync, mkdirSync, readdirSync, readFileSync, openSync, readSync, closeSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { prepare, prepareText } from './creation-upload.mjs';
import { buildFileBundle, linesFromFile, readPortableBundle } from './multi-file.mjs';

export const SESSION_CLIENTS = ['claude-code', 'codex', 'cursor', 'gemini', 'zero'];
const MAX_CHILD_STREAMS = 99; // A manifest holds at most 100 streams, including the main one.

const list = dir => { try { return readdirSync(dir); } catch { return []; } };
const statOf = file => { try { return statSync(file); } catch { return undefined; } };
const within = (parent, child) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** The project and its parents below home: agents often run one level above a game's own folder. */
function projectChain(project, home) {
  const chain = [];
  for (let dir = project; ; dir = dirname(dir)) {
    if (dir === home && chain.length) break;
    chain.push(dir);
    if (dir === dirname(dir) || dir === home) break;
  }
  return chain;
}

const childLogDir = file => join(dirname(file), basename(file, '.jsonl'), 'subagents');
const childLogs = file => list(childLogDir(file)).filter(name => name.endsWith('.jsonl')).sort()
  .map(name => join(childLogDir(file), name)).filter(path => statOf(path)?.isFile() && statOf(path).size > 0);

function candidate(client, file, match, extra = {}) {
  const stat = statOf(file);
  if (!stat?.isFile() || !stat.size) return undefined;
  return { client, file, sessionId: basename(file).replace(/\.jsonl?$/, ''), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), match, childLogs: childLogs(file).length, ...extra };
}

/** Reads only the head of a Codex rollout, whose first record names its working directory. */
function codexWorkingDirectory(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(1024 * 1024), n = readSync(fd, head, 0, head.length, 0);
    const found = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(head.toString('utf8', 0, n));
    return found ? JSON.parse(found[1]) : undefined;
  } catch { return undefined; } finally { closeSync(fd); }
}

/** Lists this project's session logs by metadata. Other projects are never returned. */
export function locateSessions({ project = process.cwd(), client, env = process.env, home = homedir(), limit = 20 } = {}) {
  if (client && !SESSION_CLIENTS.includes(client)) throw Error(`Unknown client; use one of ${SESSION_CLIENTS.join(', ')}`);
  const root = realpathSync(project), realHome = existsSync(home) ? realpathSync(home) : home;
  const chain = projectChain(root, realHome);
  const match = dir => (dir === root ? 'project' : 'ancestor');
  const slug = path => path.replace(/[^A-Za-z0-9]/g, '-');
  const wanted = name => !client || client === name;
  const found = [];
  const add = item => { if (item) found.push(item); };
  const slugged = (name, base) => {
    if (!wanted(name)) return;
    for (const dir of chain) {
      const folder = join(base, 'projects', slug(dir));
      for (const entry of list(folder)) if (entry.endsWith('.jsonl')) add(candidate(name, join(folder, entry), match(dir)));
    }
  };
  slugged('claude-code', env.CLAUDE_CONFIG_DIR || join(realHome, '.claude'));
  slugged('zero', env.ZERO_CONFIG_DIR || join(realHome, '.zero'));
  if (wanted('cursor')) {
    for (const dir of chain) {
      const folder = join(realHome, '.cursor', 'projects', slug(dir).replace(/^-+/, ''), 'agent-transcripts');
      for (const entry of list(folder)) {
        const nested = join(folder, entry, `${entry}.jsonl`);
        add(candidate('cursor', entry.endsWith('.jsonl') ? join(folder, entry) : nested, match(dir)));
      }
    }
  }
  if (wanted('gemini')) {
    const tmp = join(realHome, '.gemini', 'tmp');
    for (const entry of list(tmp)) {
      let projectRoot;
      try { projectRoot = readFileSync(join(tmp, entry, '.project_root'), 'utf8').trim(); } catch { continue; }
      if (!chain.includes(projectRoot)) continue;
      const chats = join(tmp, entry, 'chats');
      for (const name of list(chats)) if (name.endsWith('.json')) add(candidate('gemini', join(chats, name), match(projectRoot), { format: 'json', needsConversion: true }));
    }
  }
  if (wanted('codex')) {
    const base = join(env.CODEX_HOME || join(realHome, '.codex'), 'sessions');
    let checked = 0;
    scan: for (const year of list(base).sort().reverse()) for (const month of list(join(base, year)).sort().reverse()) for (const day of list(join(base, year, month)).sort().reverse()) {
      for (const name of list(join(base, year, month, day)).sort().reverse()) {
        if (!name.endsWith('.jsonl')) continue;
        if (++checked > 1000) break scan;
        const file = join(base, year, month, day, name), cwd = codexWorkingDirectory(file);
        if (cwd && chain.includes(cwd)) add(candidate('codex', file, match(cwd)));
      }
    }
  }
  found.sort((a, b) => (a.match === b.match ? b.modifiedAt.localeCompare(a.modifiedAt) : a.match === 'project' ? -1 : 1));
  return { project: root, total: found.length, candidates: found.slice(0, limit) };
}

/** Prepares one session and its sub-agent logs into a new private bundle directory. */
export function buildSessionBundle({ file, out, children = true }) {
  if (/\.gz$/i.test(file)) throw Error('Decompress the session first; bundles read uncompressed JSONL');
  if (!statOf(file)?.isFile()) throw Error('Select a regular session file');
  const logs = children ? childLogs(file) : [];
  const included = logs.slice(0, MAX_CHILD_STREAMS);
  const streams = [{ id: 'main', file }, ...included.map((path, i) => ({ id: `child-${i + 1}`, file: path, parentStreamId: 'main' }))];
  mkdirSync(dirname(out), { recursive: true }); // The usual target, .clide/creation-session, comes before .clide exists.
  let manifest;
  try { ({ manifest } = buildFileBundle({ streams, scripts: [] }, dirname(file), dirname(file), prepare, prepareText, out)); }
  catch (error) {
    // Node's JSON errors quote the input, and this output must never contain transcript text.
    if (error instanceof SyntaxError) throw Error('Session log contains invalid JSON; it may be truncated or still being written');
    throw error;
  }
  return {
    format: 'creation-bundle-v2', directory: out, streams: manifest.streams.length, files: manifest.files.length,
    bytes: manifest.files.reduce((n, f) => n + f.bytes, 0), omittedChildLogs: logs.length - included.length,
    warning: 'Run review on this directory before upload. Automated redaction can miss sensitive information.',
  };
}

const SECRET_KINDS = {
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  paeanApiKey: /\bos_ak_[A-Za-z0-9_-]{8,}/g,
  googleApiKey: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  slackToken: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  npmToken: /\bnpm_[A-Za-z0-9]{30,}/g,
  gitlabToken: /\bglpat-[A-Za-z0-9_-]{16,}/g,
  stripeKey: /\b[sr]k_live_[A-Za-z0-9]{16,}/g,
  privateKey: /BEGIN [A-Z ]*PRIVATE KEY/g,
  connectionString: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/"'\\]+:[^\s@\/"'\\]+@[^\s\/"'\\]+/g,
};
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const NOT_PERSONAL_EMAIL = /^(?:git|no-?reply|.*\+noreply)@|@(?:users\.noreply\.github\.com|example\.[a-z]+)$|\.(?:png|jpe?g|gif|svg|webp|js|mjs|ts|css|json|map|md)$/i;
const SENSITIVE_PATH = /\.ssh\/|\.aws\/credentials|\.netrc\b|\bid_rsa\b|\bcredentials\.json\b|\.env(?:\.[a-z]+)?\b/g;
const BLOB = /[A-Za-z0-9+\/=_-]{512,}/g;
const MANY_EMAILS = 3; // The user's own address and a collaborator are expected in git output.
const maskEmail = email => {
  const [local, domain] = email.split('@'), dot = domain.lastIndexOf('.');
  return `${local[0]}***@${domain[0]}***${domain.slice(dot)}`;
};

/** Counts what a person should know before a private upload. Reports locations and masks, never values. */
export function reviewEntries(entries, { project = process.cwd(), home = homedir() } = {}) {
  const root = realpathSync(project);
  const report = { records: 0, bytes: 0, firstTimestamp: null, lastTimestamp: null, workingDirectories: [], emails: { distinct: 0, samples: [] }, possibleSecrets: { count: 0, kinds: {} }, sensitivePathMentions: 0, largeBinaryBlobs: 0, locations: [], needsAttention: [] };
  const emails = new Set(), cwds = new Map();
  const locate = (file, line, kind) => { if (report.locations.length < 20) report.locations.push({ file, line, kind }); };
  for (const { file, line, text } of entries) {
    report.records++; report.bytes += Buffer.byteLength(text) + 1;
    const stamp = /"timestamp":"([^"]{1,64})"/.exec(text)?.[1];
    if (stamp) { report.firstTimestamp ??= stamp; report.lastTimestamp = stamp; }
    const cwd = /"cwd":"((?:[^"\\]|\\.){1,1024})"/.exec(text)?.[1];
    if (cwd) cwds.set(cwd, (cwds.get(cwd) || 0) + 1);
    // Inline media cannot be read here, and its base64 would only produce false secret matches.
    const scannable = text.replace(BLOB, () => { report.largeBinaryBlobs++; return ''; });
    for (const [kind, pattern] of Object.entries(SECRET_KINDS)) {
      const hits = scannable.match(pattern)?.length || 0;
      if (hits) { report.possibleSecrets.count += hits; report.possibleSecrets.kinds[kind] = (report.possibleSecrets.kinds[kind] || 0) + hits; locate(file, line, kind); }
    }
    // `user:password@host` looks like an email, and a masked sample would show part of the password.
    for (const email of scannable.replace(SECRET_KINDS.connectionString, '').match(EMAIL) || []) if (!NOT_PERSONAL_EMAIL.test(email)) emails.add(email.toLowerCase());
    report.sensitivePathMentions += scannable.match(SENSITIVE_PATH)?.length || 0;
  }
  report.emails = { distinct: emails.size, samples: [...emails].slice(0, 5).map(maskEmail) };
  for (const [raw, records] of cwds) {
    let path = raw;
    try { path = JSON.parse(`"${raw}"`); } catch { /* keep the escaped form */ }
    // A log records the path as typed; compare resolved paths so a symlink is not "another project".
    let resolved = path;
    try { resolved = realpathSync(path); } catch { /* it no longer exists here */ }
    const relation = within(root, resolved) ? 'project' : within(resolved, root) ? 'ancestor' : 'other';
    report.workingDirectories.push({ path: within(home, path) ? '~' + path.slice(home.length) : path, records, relation });
  }
  if (report.possibleSecrets.count) report.needsAttention.push('possible-secrets');
  if (report.workingDirectories.some(d => d.relation === 'other')) report.needsAttention.push('other-project-directories');
  if (report.emails.distinct > MANY_EMAILS) report.needsAttention.push('many-email-addresses');
  return report;
}

function* linesOf(file, bytes) {
  let line = 0;
  for (const text of bytes.toString('utf8').split('\n')) { line++; if (text.trim()) yield { file, line, text }; }
}

function* fileEntries(file) {
  let line = 0;
  for (const raw of linesFromFile(file)) { line++; const text = raw.toString('utf8'); if (text.trim()) yield { file: basename(file), line, text }; }
}

function* bundleEntries(bundle) {
  for (const f of bundle.manifest.files) yield* linesOf(f.path, bundle.blobs.get(f.id));
}

export const reviewBytes = (bytes, options) => reviewEntries(linesOf('creation-session.jsonl', bytes), options);
export const reviewFile = (file, options) => reviewEntries(fileEntries(file), options);
export function reviewBundle(directory, options) {
  const bundle = readPortableBundle(directory, { layout: 'local' });
  const scripts = bundle.manifest.files.filter(f => f.kind === 'script').length;
  return { streams: bundle.manifest.streams.length, scripts, files: bundle.manifest.files.length, ...reviewEntries(bundleEntries(bundle), options) };
}
