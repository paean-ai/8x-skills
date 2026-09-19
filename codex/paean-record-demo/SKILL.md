---
name: paean-record-demo
description: Record a 20-30s arcade attract-mode demo video from a finished Paean / clide.app work — an auto-playing gameplay reel with an optional title card, timed captions and a CTA end card, exported as MP4/WebM/GIF plus a poster frame. Use when a work needs a store or Square preview video, a social or ad reel, a README/landing-page clip, or when an existing demo video opens on a menu, is the wrong length, or plays a static screen.
---

# Paean Record Demo (Codex)

Turn a finished work into a **demo reel**: 20–30 seconds of the game playing itself, composed like
an arcade cabinet's attract loop, with as much or as little promotional framing as the destination
wants.

> **Using this skill in Codex.** Codex has no frontmatter skill loader, so
> reference this file explicitly: add a line to your project `AGENTS.md` such as
> *"For this task, follow `8x-skills/codex/paean-record-demo/SKILL.md`."*, or point Codex at
> this file in your prompt. Any scripts and reference files live next to this SKILL.md.

Two things this is *not*. It is not a screen recording — the game runs in a throwaway headless
browser driven by a script, so the same config produces the same clip on any machine. And it is not
a playable: there is no interaction, so the whole job is **composition**, not affordance.

This skill ships a recorder (`scripts/record-demo.mjs`), an optional ffmpeg stage
(`scripts/encode.mjs`) and the promo layer it injects (`reference/demo-overlay.*`).
**It never edits the game's source.**

## Why 20–30 seconds

Shorter than ~20 s and a stranger sees a mechanic but never a *loop* — no consequence, no second
beat, nothing to want. Longer than ~30 s and the format fights you everywhere it lands: app-store
preview videos, most social autoplay, and ad video slots all sit in that band, and a viewer who has
not been given a reason by second thirty is not going to be.

The recorder warns outside 20–30 s rather than refusing. A 6 s GIF teaser and a 90 s walkthrough
are both real deliverables; they are just not what this default is tuned for.

## Measured behaviour of Playwright video capture

Recorded with Playwright 1.60 / bundled Chromium. These are the facts the script is built around,
and most of them are the opposite of what the API reads like:

| Question | Answer | How it was established |
|---|---|---|
| Output format | **VP8 in WebM, 25 fps, no audio track** | `ffprobe` on the output: `codec_name=vp8`, `r_frame_rate=25/1` |
| Does `recordVideo.size` scale the page up? | **No — it pads.** Viewport 390×844 recorded at 1170×2532 put the page in the top-left corner and filled the other ~85% of every frame with flat grey | Recorded both, extracted a frame |
| Does `deviceScaleFactor` raise video resolution? | **No.** At dsf 3 the video was still 390×844 of content | Same recording, `ffprobe` + frame extract |
| Is the clip the length you waited? | **No — it is longer.** Recording spans the whole browser context, so navigation, boot and teardown are all in it: a 22.0 s demo produced a 22.92 s master | `ffprobe -show_entries format=duration` |
| Can recording be started and stopped mid-page? | **No.** It is bound to the context's lifetime | Playwright API |
| Does `page.mouse.click` fire touch events in a `hasTouch` context? | **No.** Two clicks produced `pointerdown: 2, click: 2, touchstart: 0` | Counting listeners on a live page |

That last row is the quiet one. A phone game that binds only `touchstart` receives **nothing** from
a mouse-driven input track, and the result is 25 seconds of an untouched demo that still looks
entirely plausible. So the recorder dispatches the touch protocol (through CDP, since Playwright's
touchscreen exposes `tap` only and a flick is the gesture most often read by velocity) whenever the
capture viewport is phone-shaped, and falls back to the mouse for desktop viewports. Override with
`"touch": true | false` when the heuristic guesses wrong.

Two further consequences drive the design:

1. **Resolution is chosen by choosing a viewport.** `recordVideo.size` is derived from the viewport
   by the script and is not a config field, because every other value produces a grey border. If
   you want a bigger video, record a bigger viewport — and then check the game's layout still reads
   as the platform you are selling (a 1080-wide viewport gives most responsive games their tablet
   layout, not their phone one).
2. **The head of the master is not the demo.** So the overlay paints a cover on the very first
   frame and the clip opens on a designed title card rather than a white flash — the boot time
   becomes the intro instead of being something to hide.

## The demo is a composition, not a capture

A raw 25-second grab of a game playing itself is the *floor*, not the goal. Decide the arc first:

```text
0:00  title card      name + one line of why          ~2.4s
0:02  the hook        the strongest readable moment, immediately
0:06  beat 1          name the mechanic the viewer is watching
0:12  escalation      a harder/faster/denser version of the same loop
0:15  beat 2          name the depth behind it
0:19  end card        title + CTA + where to play     ~3.2s
```

- **Open on the hook, not on level one.** First levels are deliberately sparse. Enter the second
  one, with the seed the author already tuned for the showcase.
- **Show one loop twice.** Once so it is legible, once so it is clearly deeper than it looked.
  Two mechanics shown once each reads as noise; one mechanic shown twice reads as a game.
- **Captions name what is on screen**, in the same second it happens. A caption that describes a
  mechanic the viewer is not currently looking at is worse than no caption.
- **End on the loop, never on a death or a results panel.** If the demo can lose, restart it — the
  last gameplay frame before the end card is the one the viewer decides on.

### Promotional framing is allowed, and often right

The demo does not have to be pure unadorned gameplay. A title card, timed captions, a mark and a
CTA end card are all supported, and for a Square listing or a social post they usually help. Pick
the level of framing from where the clip lands:

| Destination | Framing | Why |
|---|---|---|
| Square / store preview | title card + end card, few or no captions | The page already carries the name and the button; the video's job is the game |
| Social autoplay (muted) | captions throughout, strong first frame, mark | No sound, no context, and a thumb three centimetres from scrolling past |
| Video ad slot | full framing — title, captions, CTA end card | A stranger with no page around the video; the clip is the entire pitch |
| README / landing page | no framing at all, loop-friendly, GIF | Framing repeats what the surrounding page already says |

Keep the framing honest: describe what the clip shows rather than promising what it does not.
An absolute claim you cannot verify from the 25 seconds on screen is the fastest way to a rejected
ad review.

## Find the seam

The recorder needs one expression that starts a real, playable session. It is the same seam the
production standard's *Ad-conversion readiness* section asks every work to expose, in the same
priority order — `window.__game` handle, event bus, module export, DOM click as a last resort.

Start by looking rather than guessing:

```bash
node <skill>/scripts/record-demo.mjs --probe
```

It loads the game and reports the global handles it found, the methods on them whose names look
like a session start, the canvases, and the clickable elements — enough to write `enter` without
reading the source. Works built to the current standard answer with something like:

```json
{ "handles": [{ "name": "window.__game", "shape": "{ startRound, state, enterAttract }" }],
  "likelyStart": ["window.__game.startRound()"] }
```

If a work has a good native attract mode, the best `enter` is often the work's own — let the author's
demo run and record that, rather than scripting a worse one.

## Run it

```bash
node <skill>/scripts/record-demo.mjs [--config demo.config.json] [--seconds 25]
```

`demo.config.json`, next to the project:

```json
{
  "name": "orbit-runner",
  "source": ".",
  "outDir": "demo",
  "seconds": 25,
  "viewport": { "width": 430, "height": 932 },

  "waitFor": "() => !!window.__game && window.__game.ready",
  "enter": "window.__game.startRound({ autopilot: true, floor: 2, seed: 20260901 })",

  "title": { "text": "Orbit Runner", "tagline": "One thumb. Twelve orbits.", "logo": "icon.jpg" },
  "beats": [
    { "at": 4,  "hold": 3.5, "text": "Chain orbits to | build speed" },
    { "at": 11, "hold": 3.5, "text": "Every colour is a | different rule" }
  ],
  "end": { "text": "Orbit Runner", "cta": "Play free", "url": "orbit.clide.app" },
  "mark": "8x.gg",

  "music": "promo/track.mp3",
  "gif": { "seconds": 6, "width": 320 }
}
```

| Field | Meaning |
|---|---|
| `waitFor` | selector, or a predicate evaluated until truthy. **Not a delay** — a fixed wait opens the clip on a loading screen on any machine slower than yours |
| `enter` | expression that starts a real session. Returning `false` fails the run rather than recording a menu |
| `beats[].text` | a `\|` splits the caption into plain and accent halves: `"Chain orbits to \| build speed"` |
| `input` | scripted `{at, tap \| key \| swipe \| eval}` steps, for works with no autopilot |
| `touch` | force touch or mouse input. Defaults to touch below a 900 px-wide viewport |
| `music` | audio muxed in by ffmpeg, trimmed to the clip with a 1 s fade-out. Playwright captures no audio, so this is the only way to get any |
| `scale` | ffmpeg output scale, e.g. `"1080:-2"`. Upscaling does not add detail; it just makes the deliverable the size a platform demands |

Outputs land in `outDir`: `<name>-demo.mp4` (trimmed to exactly `seconds`), `<name>-demo-poster.jpg`,
and `<name>-demo.gif` when configured. `--keep-raw` also keeps the untrimmed WebM master.

### Works without an autopilot

If the game exposes no autopilot flag, script the input instead. It is worse — it desynchronises
the moment anything in the game's timing changes — but it works today and needs no gameplay edits:

```json
"input": [
  { "at": 3.0, "tap": [215, 700] },
  { "at": 4.2, "swipe": [215, 700, 215, 380], "ms": 260 },
  { "at": 6.0, "key": "Space" }
]
```

Prefer fixing the work: an autopilot flag **read every frame** is three lines and makes every future
demo, ad and trailer trivial. The production standard asks for it for exactly this reason.

## ffmpeg is optional

The recorder always writes the WebM master using nothing but Playwright. ffmpeg, when it is on
PATH, adds the trim to an exact length, the MP4, the poster frame and the GIF.

```bash
brew install ffmpeg                 # macOS
winget install Gyan.FFmpeg          # Windows
sudo apt install ffmpeg             # Debian/Ubuntu
```

Without it the script says so, reports the lead-in it measured, and leaves you a usable master.
`scripts/encode.mjs` can be run on its own later against any clip:

```bash
node <skill>/scripts/encode.mjs demo/orbit-demo.webm demo/orbit-demo --start 0.9 --duration 25
```

## Then verify — the clip, not the log

A recorder that cannot tell gameplay from a frozen title screen produces a plausible-looking file of
nothing, so the script samples three frames across the play window and **exits non-zero when they
are byte-identical**. That catches a demo that never started. It does *not* catch a demo that
started and is merely idling on an animated menu — for that, look at the poster frame, which is
taken a third of the way in precisely so it is worth looking at.

Check, in this order:

1. **Poster frame.** If it does not make you want to play, the clip does not either. Re-tune the
   showcase parameters before touching anything else.
2. **First second.** The title card must be legible at thumbnail size and over the game's own
   background, not just on the one you designed it against.
3. **Muted.** Watch the whole clip with sound off, because most of its audience will. If it only
   reads with the music, the captions are doing too little.
4. **Page errors.** The script reports console and page errors caught during the demo. A clip that
   looks fine while the game throws every frame will diverge from real play the moment anything
   changes.

## Record from a genuinely fresh profile

The single most common way to ship a wrong demo: recording a game the browser has already played.
One-shot panels — opening story, tutorial cards, "what's new" — are gated on a saved flag, so the
run you watched looks perfect while the recorded run gets the panel.

The recorder launches a throwaway context every time, so **every** run is a first run. That is the
safe default, and it means the failure it exposes is real: if the clip shows a story card, so does
every genuinely new player. Set the one-shot flags in `enter` through the game's own save module
before starting the session — do not merely hide the panel, since a hidden panel usually still
pauses the simulation while the recorder's clock keeps running.

## Cross-platform notes

Verified on macOS; written for Windows and Linux as an explicit constraint rather than an
afterthought.

- **Playwright resolution** walks up from the game directory, then checks the global npm root under
  both the POSIX (`<prefix>/lib/node_modules`) and Windows (`node_modules` beside `node.exe`)
  layouts. A global `npm i -g playwright` is **not** importable by bare specifier, so the path has
  to be found by hand — a plain `import('playwright')` fails with `ERR_MODULE_NOT_FOUND`.
- **ffmpeg** is spawned with an argument array and **no shell**, so a project path containing spaces
  needs no quoting and behaves identically on Windows, where `ffmpeg.exe` resolves through the
  normal executable lookup.
- **The static host** rejects anything resolving outside the game directory using `path.sep`, so the
  containment check holds under both separators.
- **Input is dispatched through Chromium's own protocol**, not the host's window system, so the
  scripted track behaves identically on all three platforms and needs no display server on Linux.
- **H.264 needs even dimensions** in `yuv420p`, and viewports like 431×933 are not unusual, so the
  encode filter truncates each axis to an even number. Without it ffmpeg fails outright.

## Related

- **paean-game-create** — the production standard's *Attract mode* section defines the 20–30 s demo
  arc this skill records, and *Ad-conversion readiness* defines the seam it drives.
- **paean-convert-to-ad** — same seam, but for a bundle the viewer actually plays. A demo reel and a
  playable are the two halves of a campaign; build the seam once and both are cheap.
- **paean-publish** — the poster frame this skill produces is a reasonable source for a Square
  listing's `banner.jpg` when no dedicated art exists yet.
