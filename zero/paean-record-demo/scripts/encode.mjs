#!/usr/bin/env node
/*
 * encode.mjs — the optional ffmpeg half of the recorder.
 *
 * Playwright writes VP8 WebM and nothing else. That is a fine master but a
 * poor deliverable: ad networks, app stores and most social uploaders want
 * H.264 MP4, and the raw clip is always a little longer than the demo because
 * recording spans the whole browser context, including navigation and boot.
 *
 * So everything here is post-processing, and all of it is optional. Without
 * ffmpeg the recorder still produces a usable WebM; with it you additionally
 * get an exactly-trimmed MP4, a poster frame and (on request) a GIF.
 *
 * ffmpeg is found on PATH — no bundled binary, no download. On Windows that
 * resolves `ffmpeg.exe` through the normal executable lookup, so no shell is
 * involved and paths with spaces need no quoting: every argument is passed as
 * its own array element.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Run ffmpeg/ffprobe, resolving with stdout. Rejects with a readable message. */
export async function runFfmpeg(bin, args, opts = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', c => { stdout += c.toString() })
    child.stderr.on('data', c => { stderr += c.toString() })
    child.on('error', err => {
      reject(err.code === 'ENOENT'
        ? new Error(`${bin} is not on PATH`)
        : new Error(`${bin} failed to start: ${err.message}`))
    })
    child.on('close', code => {
      if (code === 0) resolve(stdout)
      // ffmpeg's diagnostics are the last few stderr lines; the rest is banner.
      else reject(new Error(`${bin} exited with code ${code}\n${stderr.trim().split('\n').slice(-6).join('\n')}`))
    })
  })
}

/** `{ ffmpeg, ffprobe }` when both are usable, otherwise `null`. */
export async function detectFfmpeg() {
  try {
    await runFfmpeg('ffmpeg', ['-hide_banner', '-version'])
    await runFfmpeg('ffprobe', ['-hide_banner', '-version'])
    return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }
  } catch {
    return null
  }
}

/** Duration in seconds of a media file, or null when it cannot be read. */
export async function probeDuration(file, ffprobe = 'ffprobe') {
  try {
    const out = await runFfmpeg(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ])
    const n = Number.parseFloat(out.trim())
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/*
 * H.264 in yuv420p needs even dimensions on both axes, and a viewport such as
 * 431x933 is not unusual. `trunc(../2)*2` drops at most one pixel per axis,
 * which is invisible, where an odd size is a hard encoder error.
 */
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

/**
 * Arguments for the MP4 encode. Kept pure so the flag order, the trim and the
 * even-dimension guard can be asserted without invoking ffmpeg.
 */
export function mp4Args({ input, output, start = 0, duration, fps = 30, crf = 20, scale = null, audio = null }) {
  const filters = [scale ? `scale=${scale}:flags=lanczos` : null, EVEN, `fps=${fps}`].filter(Boolean)
  const args = ['-hide_banner', '-v', 'error', '-y']
  // -ss before -i seeks the input, which is both faster and frame-accurate for
  // a re-encode; after -i it would decode and discard everything before it.
  if (start > 0) args.push('-ss', start.toFixed(3))
  args.push('-i', input)
  if (audio) args.push('-i', audio)
  if (duration != null) args.push('-t', duration.toFixed(3))
  args.push('-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p')
  if (audio) {
    // Music is trimmed to the video and faded out, never left to cut off mid-bar.
    args.push('-c:a', 'aac', '-b:a', '160k', '-shortest')
    if (duration != null) args.push('-af', `afade=t=out:st=${Math.max(0, duration - 1).toFixed(3)}:d=1`)
  } else {
    args.push('-an')
  }
  args.push('-movflags', '+faststart', output)
  return args
}

/**
 * Arguments for the GIF encode. Two-pass palette in a single graph:
 * `palettegen` on a copy of the stream, `paletteuse` on the other. A GIF
 * without it quantises to the default 216-colour web palette and bands badly
 * on exactly the gradients a game demo is made of.
 */
export function gifArgs({ input, output, start = 0, duration, fps = 15, width = 320 }) {
  const args = ['-hide_banner', '-v', 'error', '-y']
  if (start > 0) args.push('-ss', start.toFixed(3))
  if (duration != null) args.push('-t', duration.toFixed(3))
  args.push('-i', input, '-vf',
    `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop', '0', output)
  return args
}

/** Arguments for a single poster frame. */
export function posterArgs({ input, output, at = 0 }) {
  return ['-hide_banner', '-v', 'error', '-y', '-ss', at.toFixed(3), '-i', input, '-frames:v', '1', '-q:v', '2', output]
}

/**
 * Produce the deliverables next to `output` (minus extension).
 * Returns what was written; never throws for a missing optional target.
 */
export async function encodeDeliverables(opts) {
  const { tools, source, outBase, start, duration } = opts
  mkdirSync(path.dirname(outBase), { recursive: true })
  const written = []

  const mp4 = outBase + '.mp4'
  await runFfmpeg(tools.ffmpeg, mp4Args({
    input: source, output: mp4, start, duration,
    fps: opts.fps, crf: opts.crf, scale: opts.scale, audio: opts.audio,
  }))
  written.push({ kind: 'mp4', file: mp4 })

  if (opts.poster !== false) {
    // A third of the way in: past the title card, before the end card — the
    // frame a store listing or a social preview actually shows.
    const poster = outBase + '-poster.jpg'
    await runFfmpeg(tools.ffmpeg, posterArgs({ input: source, output: poster, at: start + duration / 3 }))
    written.push({ kind: 'poster', file: poster })
  }

  if (opts.gif) {
    const gif = outBase + '.gif'
    const g = typeof opts.gif === 'object' ? opts.gif : {}
    await runFfmpeg(tools.ffmpeg, gifArgs({
      input: source, output: gif, start,
      // A 25 s GIF is tens of megabytes and nothing accepts it; take the middle.
      duration: Math.min(duration, g.seconds || 6),
      fps: g.fps || 15, width: g.width || 320,
    }))
    written.push({ kind: 'gif', file: gif })
  }

  return written
}

// CLI: re-encode an existing clip without re-recording it.
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const [input, outBase] = process.argv.slice(2)
  if (!input || !outBase) {
    console.error('Usage: node encode.mjs <input.webm> <out-basename> [--start S] [--duration S]')
    process.exit(2)
  }
  const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d }
  const tools = await detectFfmpeg()
  if (!tools) { console.error('ffmpeg/ffprobe not found on PATH'); process.exit(1) }
  if (!existsSync(input)) { console.error('input not found: ' + input); process.exit(1) }
  const total = await probeDuration(input, tools.ffprobe)
  const start = flag('--start', 0)
  const written = await encodeDeliverables({
    tools, source: path.resolve(input), outBase: path.resolve(outBase),
    start, duration: flag('--duration', Math.max(1, (total || 25) - start)),
  })
  for (const w of written) console.log(`${w.kind.padEnd(7)} ${w.file}`)
}
