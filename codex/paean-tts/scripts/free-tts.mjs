#!/usr/bin/env node
/**
 * free-tts.mjs — Unified Free & Offline Neural TTS Runner for macOS / RedNote / Paean Workflows
 *
 * Engine Priority (`--engine auto|qwen3|kokoro|paean`):
 *   1. `qwen3`  — Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16 (`qwen3-tts` via Apple Silicon MLX: 9 expressive speakers
 *                 `serena`, `vivian`, `uncle_fu`, `ryan`, `aiden`, `ono_anna`, `sohee`, `eric` [四川话], `dylan` [北京话]
 *                 + `--instruct` emotion/style control). Studio human-grade prosody, zero cost, 100% offline.
 *   2. `kokoro` — Kokoro-82M v1.1-zh 24kHz (`kokoro-tts` ONNX: 45 Chinese male `zm_009..zm_100` + 55 Chinese female
 *                 `zf_001..zf_099` + English `af_maple`, `af_sol`, `bf_vale`). Ultra-fast CPU/ONNX, zero cost, 100% offline.
 *   3. `paean`  — Cloud Paean TTS (`paean_tts.mjs` using creator's local Paean JWT). Only with an explicit `--engine paean`;
 *                 `auto` never falls through to it, because synthesis may use account quota.
 *
 * Local engines are not bundled: `qwen3-tts` / `kokoro-tts` must already be installed in ~/.local/bin.
 * See ../references/local-tts.md.
 *
 * Usage:
 *   free-tts --list
 *   free-tts --text "放学铃后：校园通行证外传。" --out output.wav [--engine qwen3|kokoro|auto] [--voice serena|vivian|uncle_fu|ryan|zm_010|zf_001] [--instruct "温和沉静的叙事女声"] [--speed 1.05]
 *   free-tts --manifest segments.json --out audio_dir/ [--engine qwen3|kokoro|auto] [--voice serena] [--instruct "..."] [--speed 1.05]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const QWEN3_BIN = path.join(HOME, '.local', 'bin', 'qwen3-tts');
const KOKORO_BIN = path.join(HOME, '.local', 'bin', 'kokoro-tts');
const PAEAN_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'paean_tts.mjs');
const NO_ENGINE = 'No local TTS engine found (expected ~/.local/bin/qwen3-tts or ~/.local/bin/kokoro-tts). '
  + 'This tool does not install engines. Use --engine paean to call Paean cloud TTS explicitly; it may use account quota.';

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flag = (names, def = null) => {
    for (const n of names) {
      const i = argv.indexOf(n);
      if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1];
    }
    return def;
  };
  return {
    list: argv.includes('--list') || argv.includes('-l'),
    help: argv.includes('--help') || argv.includes('-h'),
    engine: flag(['--engine', '-e'], 'auto'),
    voice: flag(['--voice', '-v'], null),
    instruct: flag(['--instruct', '-i'], null),
    lang: flag(['--lang'], 'chinese'),
    text: flag(['--text', '-t'], null),
    textFile: flag(['--text-file', '-f'], null),
    manifest: flag(['--manifest', '-m'], null),
    out: flag(['--out', '-o'], 'output.wav'),
    speed: Number(flag(['--speed', '-s'], '1.0')) || 1.0,
  };
}

function chooseEngine(engine, voice, instruct) {
  const e = (engine || 'auto').toLowerCase();
  if (e === 'paean') return e;
  if (e === 'qwen3' || e === 'qwen' || e === 'mlx') {
    if (!fs.existsSync(QWEN3_BIN)) fail(`qwen3-tts is not installed at ${QWEN3_BIN}`);
    return 'qwen3';
  }
  if (e === 'kokoro') {
    if (!fs.existsSync(KOKORO_BIN)) fail(`kokoro-tts is not installed at ${KOKORO_BIN}`);
    return 'kokoro';
  }
  // Auto-route Kokoro voice IDs (zm_010, zf_001, af_maple, bf_vale) to kokoro
  if (voice && /^(zm_|zf_|af_|bf_)/i.test(voice) && fs.existsSync(KOKORO_BIN)) return 'kokoro';
  // Prefer Qwen3-TTS 1.7B MLX model by default for superior human-like prosody & emotion
  if (fs.existsSync(QWEN3_BIN)) return 'qwen3';
  if (fs.existsSync(KOKORO_BIN)) return 'kokoro';
  fail(NO_ENGINE);
}

function synthesizeSegment({ engine, voice, instruct, lang, text, outPath, speed }) {
  const chosen = chooseEngine(engine, voice, instruct);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  if (chosen === 'qwen3') {
    const qwenArgs = [
      '--voice', voice || 'serena',
      '--lang', lang || 'chinese',
      '--speed', String(speed || 1.0),
      '--text', text,
      '--out', outPath,
    ];
    if (instruct) qwenArgs.push('--instruct', instruct);
    execFileSync(QWEN3_BIN, qwenArgs, { stdio: 'inherit' });
    return;
  }

  if (chosen === 'kokoro') {
    const kokoroVoice = voice || 'zm_010';
    execFileSync(KOKORO_BIN, [
      '--voice', kokoroVoice,
      '--speed', String(speed || 1.0),
      '--text', text,
      '--out', outPath,
    ], { stdio: 'inherit' });
    return;
  }

  // Explicit --engine paean only
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paean-tts-'));
  const txtFile = path.join(tmpDir, 'input.txt');
  fs.writeFileSync(txtFile, text, 'utf8');
  execFileSync('node', [
    PAEAN_SCRIPT, 'synthesize',
    '--text-file', txtFile,
    '--voice', voice || 'Cherry',
    '--speed', String(speed || 1.0),
    '--out', tmpDir,
  ], { stdio: 'inherit' });
  const produced = fs.readdirSync(tmpDir).find((f) => f.endsWith('.wav'));
  if (produced) fs.copyFileSync(path.join(tmpDir, produced), outPath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: free-tts --text "文本" --out output.wav [--engine auto|qwen3|kokoro|paean] [--voice serena|vivian|uncle_fu|ryan|zm_010|zf_001] [--instruct "语气风格描述"] [--speed 1.0] [--list]'
    );
    return;
  }

  if (args.list) {
    if (!fs.existsSync(QWEN3_BIN) && !fs.existsSync(KOKORO_BIN)) console.log(NO_ENGINE);
    if (fs.existsSync(QWEN3_BIN)) {
      console.log('=== [1] Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16 (qwen3-tts, Apple Silicon MLX, 100% Offline, Default) ===');
      execFileSync(QWEN3_BIN, ['--list'], { stdio: 'inherit' });
    }
    if (fs.existsSync(KOKORO_BIN)) {
      console.log('\n=== [2] Kokoro-82M v1.1-zh Neural Engine (kokoro-tts, 24kHz ONNX, 100% Offline) ===');
      execFileSync(KOKORO_BIN, ['--list'], { stdio: 'inherit' });
    }
    return;
  }

  if (args.manifest) {
    const chosen = chooseEngine(args.engine, args.voice, args.instruct);
    const outDir = path.resolve(args.out);
    fs.mkdirSync(outDir, { recursive: true });

    // Single-pass batch model load when using Qwen3-TTS
    if (chosen === 'qwen3' && fs.existsSync(QWEN3_BIN)) {
      const qwenArgs = [
        '--manifest', path.resolve(args.manifest),
        '--out', outDir,
        '--voice', args.voice || 'serena',
        '--lang', args.lang || 'chinese',
        '--speed', String(args.speed || 1.0),
      ];
      if (args.instruct) qwenArgs.push('--instruct', args.instruct);
      execFileSync(QWEN3_BIN, qwenArgs, { stdio: 'inherit' });
      return;
    }

    const raw = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    const segments = Array.isArray(raw) ? raw : raw.segments || [];
    for (const seg of segments) {
      const outPath = seg.out || path.join(outDir, `${seg.id}.raw.wav`);
      synthesizeSegment({
        engine: seg.engine || args.engine,
        voice: seg.voice || args.voice,
        instruct: seg.instruct || args.instruct,
        lang: seg.lang || args.lang,
        text: seg.tts || seg.text,
        outPath,
        speed: seg.speed || args.speed,
      });
    }
    return;
  }

  let text = args.text;
  if (!text && args.textFile) {
    text = fs.readFileSync(args.textFile, 'utf8').trim();
  }
  if (!text) {
    console.error('Error: pass --text, --text-file, --manifest, or --list');
    process.exit(1);
  }

  synthesizeSegment({
    engine: args.engine,
    voice: args.voice,
    instruct: args.instruct,
    lang: args.lang,
    text,
    outPath: path.resolve(args.out),
    speed: args.speed,
  });
}

try {
  main();
} catch (e) {
  // A failed engine has already reported through inherited stdio; keep its exit code, skip the stack.
  if (typeof e.status !== 'number') throw e;
  process.exit(e.status);
}
