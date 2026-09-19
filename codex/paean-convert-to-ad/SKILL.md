---
name: paean-convert-to-ad
description: Convert a published Paean / clide.app work into an HTML5 playable-ad bundle (Google Ads MEDIA_BUNDLE) that runs fully offline, opens straight into core play, and exits to the store. Use when turning a Square work into paid ad creative, or when a playable bundle is rejected, plays a menu instead of the game, or fails an ad container's offline requirement.
---

# Paean Convert to Ad (Codex)

Turn a finished work into a **playable ad**: a self-contained HTML5 bundle an ad network serves in
place of a video, where the viewer plays the real game before deciding to install.

> **Using this skill in Codex.** Codex has no frontmatter skill loader, so
> reference this file explicitly: add a line to your project `AGENTS.md` such as
> *"For this task, follow `8x-skills/codex/paean-convert-to-ad/SKILL.md`."*, or point Codex at
> this file in your prompt. Any scripts and reference files live next to this SKILL.md.

Why it matters: an install driven by an accidental tap on a video ad opens at a fraction of the
rate of one where the person already played. The playable is a self-selection filter, so expect
click volume to fall and install→open and D1 to rise. Judge it on those, not on CTR.

This skill ships a generic builder (`scripts/build-ad.mjs`) and the ad layer it injects
(`reference/ad-*.js|css`). **It never edits the game's source** — everything happens through
`index.html` injection plus standalone files.

## Verified facts (Google Ads API, measured — not from docs)

| Question | Answer | How it was established |
|---|---|---|
| Does Google support HTML5 playable ads? | Yes — asset type `MEDIA_BUNDLE`, attached to an App campaign's `AppAdInfo.html5_media_bundles` | Field is queryable; asset creation passes `validateOnly` |
| Bundle size ceiling | API accepts at least **4 MB** zipped | Gradient probe: 100/300/500/800/1200/2000/4000 KB all passed |
| Real work bundles | 269–555 KB for full games | Three converted works |

`validateOnly` checks structure only. Passing it does **not** mean the ad will serve — asset
processing and policy review come later. Always also run the bundle in a browser.

## The bundle contract

- **Zip** with `index.html` at the root.
- `<meta name="ad.size" content="width=W,height=H">` in `<head>`.
- **No network at runtime.** No `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or absolute
  external URL. Everything inlined in the zip. The builder fails loudly on any of these.
- Wrap all storage in `try/catch` — ad iframes often block `localStorage`.
- A CTA that exits to the store, and an end card once the trial is over.

## Find the seam: open straight into core play

The whole value is play-before-install, so an ad that opens on a title, story, hub, or draft screen
has wasted the format. Find a seam and start a real session directly. **In priority order:**

| Seam | Looks like | Cost |
|---|---|---|
| **Global handle** | `window.__game = { startRound, game, state, ... }` | lowest — plain script, no imports |
| **Event bus** | `emit('cmd', { type: 'start-run', seed, floor, ... })` | low — import the bus module |
| **Module export** | `export const game = {...}` from the entry module | low — `import { game } from './js/main.js'` |
| **DOM click** | poll and click `.story-pnl [data-act="skip"]` | last resort — breaks when UI moves |

Read the entry module first (`js/main.js` or equivalent) and grep for `window.__`, `on('cmd'`,
and `^export`. Works built to the current production standard expose at least one of these.

A module-scoped director can `import` from the entry module: ES modules are singletons, so a second
import returns the same instance and does not re-run boot. Load it **after** the game's entry tag.

## Design the showcase run

Do not start the default new-game session. Pass parameters tuned for a 30-second stranger:

| Parameter | Choose | Why |
|---|---|---|
| level / floor | the **second** one, not the first | first levels are deliberately sparse; the ad needs action on frame one |
| seed | the work's own exported `DEMO_SEED` | the author already tuned that showcase; a fixed seed also makes A/B comparable |
| difficulty / tutorial | the gentle path | a viewer dying in ten seconds is a wasted impression; brief control hints help a stranger |
| character / weapon | copy the attract mode's config | it is the author's own showcase choice — better than guessing |

## Auto-play, then hand over

The highest-value pattern in playable advertising: **play itself for a few seconds to show the fun,
then give the viewer control.** Works whose autopilot flag is read per frame support this directly:

```js
startSession({ ...showcase, autopilot: true })          // ad plays itself
setTimeout(() => { run.autopilot = false; flash('YOUR TURN') }, 4200)
```

Some works need nothing at all: if the native attract mode is already a cinematic autonomous demo,
let it run, then call the work's own "begin real session" entry when the beat lands.

Budget **4–5 s** of auto-play. Less does not establish the loop; more and the viewer disengages.

### Take over the work's own "tap to play" handler

If the native attract screen shows a *TAP TO PLAY* prompt, **read where that handler actually goes
before trusting it.** In four conversions so far it has gone to a hub or menu as often as to
gameplay — Neon Dynasty's reads:

```js
G.firstTap = () => { if (G.state !== 'attract') return; Audio.unlock(); enterHome(); };
```

A viewer who follows the on-screen instruction lands in a main menu, which is exactly the screen a
playable ad exists to skip. Override the handler to run your showcase entry instead:

```js
g.firstTap = () => { interacted = true; toBattle(true) }
```

This also buys the best case for free: an eager viewer who taps at second one gets control
immediately instead of waiting out the auto-play budget. Hook it as soon as the handle exists,
before the auto-play timer, and route every later re-entry through the same override.

## Exit: probe every network

CTA APIs differ per network, so probe defensively **in this order**, and fire once only
(`fired` latch — a repeat exit is a policy violation). `reference/ad-bridge.js` implements this:

```
mraid.open(url)            → most playable containers, incl. Google App campaign playable
ExitApi.exit()             → Google Display / Studio
FbPlayableAd.onCTAClick()  → Meta (same bundle reusable on FB/IG)
window.clickTag            → legacy clickTag
window.open(url)           → fallback
```

MRAID containers have a `loading → default` lifecycle; wait for `ready` before mounting UI.

## Run it

```bash
node <skill>/scripts/build-ad.mjs --config ad.config.json [--keep]
```

`ad.config.json`, next to the project:

```json
{
  "source": ".remix-sources/<hashKey>",
  "entryScriptTag": "<script type=\"module\" src=\"js/main.js\"></script>",
  "directorFile": "ad/ad-director.js",
  "directorIsModule": true,
  "bundleName": "mygame-playable-320x480.zip",
  "ad": {
    "width": 320, "height": 480,
    "storeUrl": "https://play.google.com/store/apps/details?id=<pkg>",
    "drop": ["paean-sdk.js", "banner.jpg", "icon.jpg", "clide.json"],
    "stripScripts": ["paean-sdk.js"],
    "playMs": 30000,
    "ctaText": "Play Free",
    "director": { "autoPlayMs": 4200, "turnText": "YOUR TURN", "showcase": { "floor": 2, "seed": 20260901 } },
    "excludeFromScan": ["lib/"]
  }
}
```

`drop` removes files from the bundle; `stripScripts` also removes their `<script>` tags (dropping a
file without removing its tag leaves a 404). Third-party libraries under `excludeFromScan` are
skipped by the network check — verify by hand that they do not actually issue requests
(three.js, for example, contains a `fetch` in a loader path most games never reach).

## Then verify — both halves

1. **Browser.** Serve `build/` at a phone viewport, play a round, and confirm **zero console
   errors**. API validation passing does not mean the game still runs once the SDK is gone.
2. **Google Ads.** Upload as a `MEDIA_BUNDLE` asset and attach it to an App campaign ad group.

## Verify against a genuinely fresh profile

The single most common way to ship a broken playable: testing in a browser that already played the
game once. One-shot panels (opening story, tutorial cards, "what's new") are gated on a saved flag,
so the second load looks perfect while **every real ad impression gets the panel**.

A real case: a build was verified as "lands straight in the dungeon" because the preview tool had
loaded the page once before the screenshot, setting `save.story.intro`. On a clean profile the
viewer got six story cards instead, and the end card fired while they were still on card one.

- Test on a **port/origin that has never loaded the build**, or clear storage first, and assert the
  absence of panels programmatically rather than eyeballing one screenshot.
- **Pre-set the one-shot flags** in the director before starting the session, through the game's own
  save module — `save.story.intro = true; commit()`. Do not merely hide the panel: it pauses the
  simulation while the ad's own timers keep running.
- Grep the UI layer for `run-start` / `session-start` handlers to find what opens on a first session.
- Grep the **session-entry function itself** for a save-flag guard, not just the UI layer. Two of
  four works so far gated the story *inside* the entry point, so the seam call alone still plays it:

  ```js
  if (ch.storyBefore && STORY[ch.storyBefore] && !Save.data.seenStory[ch.storyBefore]) {
    G.state = 'story'; await playStoryScene(ch, ch.storyBefore)        // ← blocks the whole run
  }
  ```

  Set **every** such key the showcase can reach, including the post-session one (`storyAfter`),
  which otherwise fires on the keep-alive restart.

## Keep the ad alive when nobody plays

After handing control over, many viewers watch rather than touch. Left alone the character dies and
the ad spends its remaining seconds on a death or results screen — the worst possible frame to
convert on. Two guards, both in the director:

```js
// idle → let the AI take back over; the first touch returns control instantly
r.autopilot = (Date.now() - lastInput > 2600)
// session ended → restart the same showcase rather than sitting on a result panel
if (r.state === 'dead' || r.state === 'won') startShowcase()
```

Verified by leaving a build untouched for 40 s: without the guard the run ended at 27 s and showed
a run report; with it the ad stayed on live gameplay the whole time.

Where the work has a **native attract demo**, branch on whether the viewer ever touched the screen:

```js
if (!interacted && g.enterAttract) g.enterAttract()   // never touched → back to the author's demo
else startShowcase()                                  // touched → restart, keep it playable
```

A viewer who is only watching gets competent scripted play rather than a character who dies on
repeat. This is only safe once `firstTap` is overridden — otherwise returning to attract hands the
next tap to the menu.

## Time the end card from real play, not page load

A fixed `setTimeout` at mount charges the viewer for loading, for the auto-play beat, and for any
panel that blocked them. Start the clock when the session actually becomes playable — the director
calls `AdBridge.markPlayStart()` — and keep a generous fallback so the ad always closes.

The same applies to any DOM auto-skip polling: do not give it a short deadline. A panel that appears
late on a slow device outlives a 12-second window and traps the viewer.

## Copy: name the action

The in-game cue says *TAP TO PLAY* and the ad button also said *Play Free* — but that button leaves
for the store. Name the store action for what it is (**Install 8x**) and keep play cues distinct.

Avoid absolute claims you cannot verify from the bundle ("Free, no sign-up") on an app that has
subscriptions or optional accounts. Describe instead of promising.

## Language: ship English-first creative

Ad creatives go to a **global** audience, so pin the bundle to English rather than letting it follow
the device. A creative that renders in a language the media buy did not target is wasted spend, and
a viewer who mis-taps a language toggle turns the whole impression into a foreign-language ad.

Three things to do, in the order they execute:

1. **Pre-seed the language before any game module loads.** i18n modules read storage (or
   `navigator.language`) at import time, so this must run in a `<head>` classic script —
   `ad-bridge.js` does it from `window.AD_LANG`. Works differ in how they store it: a raw key
   (`"skysea-united.lang": "en"`) or a field inside a settings JSON blob
   (`{ key: "saltypaws.settings", field: "lang" }`); the bridge handles both shapes.
2. **Hide the language switcher.** `hideSelectors` removes it and keeps removing it (panels can
   mount late). It is pure downside in a 30-second ad.
3. **Fix static markup.** Some works ship a localized `<html lang>` and hard-coded strings that the
   i18n pass replaces a frame later — rewrite them at build time so the first painted frame is
   already English.

Check the default before assuming there is a problem: a work whose boot is
`settings.lang || save.lang || 'en'` is already English on empty storage even though it also exports
a `detect()` that reads the device. Verify, then decide.

Assert it, do not eyeball it — on a fresh profile check `document.documentElement.lang`, that the
toggle is hidden, and that **no CJK appears in `document.body.innerText`**.

### Keep campaign language targeting in step with the copy

The bundle is only half of it. Ad **text assets and the campaign's language targeting must agree**,
and the rule is the same one that governs the creative:

- **Global buy → English copy, English language targeting.**
- **Single-country buy → that country's language for both**, if you actually ship localized copy.
- Never target a language you have no copy in: targeting Chinese while every headline is English
  just shows English ads to a Chinese-interface audience.

Check it before drawing conclusions from a comparison: a new campaign created through the API has
**no language criterion at all**, which means *all languages* — not the same setting as an existing
campaign that was built in the UI with English selected. Two campaigns that differ on this are not
comparable, however identical their creative is.

```bash
# audit, then align
SELECT campaign.name, campaign_criterion.language.language_constant
FROM campaign_criterion WHERE campaign_criterion.type='LANGUAGE'
```

Narrowing language **reduces reach**, so weigh it per market rather than applying it blindly: in a
country where most users run a non-English Google interface, English-only targeting can cut a
well-performing market's volume sharply.


## What this skill does *not* prove

- `validateOnly` and a local browser pass say nothing about a real ad container: **the exit path is
  unverified until an actual impression**. Google's guidance for hand-built (non-GWD) playables is
  to load its exit framework explicitly; probing for `ExitApi`/`mraid` objects is a fallback, not a
  substitute. Confirm on the first live impression that gameplay taps do *not* navigate and only the
  CTA does.
- Low bundle size is not proof of low-end Android performance, WebGL support, or touch feel.
- Ad-group numbers are **not** H5 numbers: an App ad group also serves the campaign's text, image,
  and video assets. Read the MEDIA_BUNDLE's own asset-level metrics, and never add asset rows into
  a "unique users" total.
- One ad group per playable inside one campaign is convenient, **not a controlled experiment** —
  different works, different demo styles, and system traffic allocation all vary at once. Treat it
  as exploratory screening.
- A playable does not guarantee a lower CPI. Expect clicks to fall; judge it on **cost per first
  open** and **cost per matured D1**, tracked per country and device so a shift to cheaper traffic
  is not mistaken for a creative win.


## Google Ads API gotchas

- **`html5_media_bundles` is immutable.** You cannot add or swap a playable on an existing App ad —
  it returns `IMMUTABLE_FIELD`. Create a **new ad group** instead. This is convenient: one ad group
  per playable inside one campaign is a clean A/B at identical budget, text, image, and video.
- Creating an App campaign requires `containsEuPoliticalAdvertising`.
- API errors are generic ("Request contains an invalid argument") — read `errorCode` and
  `fieldName` out of the response body, not `message`.
- Audio stays silent until the first real tap. Bypassing the work's own attract handler skips its
  `sfx.unlock()`; browser autoplay policy would block it anyway. Expected in an ad.

## Attribution

Promoting Square works is covered by the Paean creator terms, so no per-work permission is needed.
Keep the `Copyright (c) 2026 paean.ai and the game's creator(s).` comment in `index.html`, and when
the source came through **paean-remix**, keep the lineage in `clide.json`.

## Related

- **paean-remix** — download a published work's full source first (binary assets included).
- **paean-game-create** — the production standard's *Ad-conversion readiness* section lists the
  four affordances a new work should ship so this conversion needs no gameplay edits.
