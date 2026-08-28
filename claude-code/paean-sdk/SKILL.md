---
name: paean-sdk
description: Add Paean platform capabilities — cross-device cloud save and a shared global leaderboard — to a static app/game published to Paean Apps Square (*.clide.app / 8x.gg), via the Paean Web SDK. Use when the user wants to add cloud save, sync progress across devices, add a global/online leaderboard or high-score board, show player rank, or "接入积分/存档/排行榜" to a Paean/clide.app app. Not for publishing (see paean-publish).
---

# Paean SDK — cloud save + shared leaderboard

Give a published Paean app **cross-device cloud save** and a **shared global
leaderboard**, using the Paean Web SDK. The app never sees a token or a backend
URL: every call goes through a host bridge (`window.paean`, wrapped by
`PaeanSDK`) that the Paean app / `8x.gg` web shell proxies for the signed-in
user, isolated per **(app × user)**. In a plain browser there is no host, so
everything must degrade to `localStorage` and the game must stay fully playable.

This skill integrates platform services into an existing game. For creating or broadly polishing
the game itself, use `paean-game-create`; do not load production design requirements into the SDK
integration task unless both capabilities are requested.

This skill bundles a **verified reference implementation** you copy into the
project and wire up — it already handles the cross-host edge cases that
otherwise only surface on a real device.

## Files (`reference/`)

- **`paean-platform.js`** — framework-agnostic integration module. Detection,
  auth, throttled cloud save with cross-device merge, leaderboard submit/query
  with an offline queue, and full `localStorage` fallback. Copy into the project
  next to `paean-sdk.js`.
- **`mock-bridge.js`** — an injectable fake `window.paean` for Playwright tests.
  Reproduces the host-shape variations (see Gotchas) so you can prove the
  integration offline, with no account or device.
- **`test-example.mjs`** — a runnable Playwright test skeleton driving the mock
  through each edge case.

## Prerequisite: ship `paean-sdk.js`

The app must load the Paean Web SDK. Add it as a top-level file and include it
before your scripts:

```html
<script src="paean-sdk.js"></script>
```

Once published, the clide platform serves the canonical latest SDK for any
request ending in `/paean-sdk.js`, so bundle a copy as a placeholder. If the
project doesn't have one, copy it from any published app
(`https://<any-handle>.clide.app/paean-sdk.js`). The SDK exposes the global
`PaeanSDK` and **never** overwrites `window.paean`; reach the raw host bridge
via `PaeanSDK.host`.

## The SDK surface you use

```js
// 1) Readiness (handles the injection race). Rejects with a
//    PaeanUnsupportedError in a plain browser; stays pending while parked as a
//    scrolling feed preview and resolves when the user opens the app.
const p = await PaeanSDK.ready();
// PaeanSDK.detect() → { supported, reason }
//   reason ∈ 'not-in-paean' | 'preview' | 'bridge-unreachable' | 'sdk-too-old'

// 2) Ask consent (first time shows the host's consent UI; the web shell may
//    prompt sign-in first). Grants only the scopes not already held.
const okAll = await p.auth.ensure(['storage.kv', 'storage.leaderboard', 'account.profile']);
p.auth.has('storage.kv');   // sync, cached: is a scope granted right now?

// 3) Per-user cloud save (private KV; value is any JSON):
await p.host.storage.put('save', { best: 240, level: 7 });
const rec = await p.host.storage.get('save');   // see Gotchas for shape/absent
await p.host.storage.list({ limit: 50 });

// 4) Shared leaderboard (board name is yours: 'main', 'weekly', …):
await p.host.leaderboard.submitScore('main', score, { metadata: { level } });
const board = await p.host.leaderboard.get('main', { limit: 20 }); // { entries, me }
const mine  = await p.host.leaderboard.getMyRank('main');

// 5) De-identified display name for the current player:
const { displayName, userKey } = await p.host.account.profile();
```

`storage.kv`, `storage.leaderboard`, and `account.profile` live on the raw
bridge under `PaeanSDK.host`; the top-level `PaeanSDK` wrapper covers auth and
detection. Always guard `PaeanSDK.host && PaeanSDK.host.leaderboard` before use
(see Gotchas — capabilities).

## Integration recipe

1. Copy `reference/paean-platform.js` into the project, next to `paean-sdk.js`,
   and load both:
   ```html
   <script src="paean-sdk.js"></script>
   <script src="paean-platform.js"></script>
   ```
2. Create the platform and wire four callbacks to your game state:
   ```js
   const platform = createPaeanPlatform({
     storageNamespace: 'mygame',          // prefixes localStorage fallback keys
     saveKey: 'save', board: 'main',
     getLocalSave: () => ({ best, unlocks }),        // your current savable state
     applySave:   (s) => { best = Math.max(best, s.best||0); },
     mergeSave:   (cloud, local) => ({ best: Math.max(cloud.best||0, local.best||0) }),
     onState:     (st) => renderCloudUI(st),         // mode/auth/profile changed
   });
   platform.init();
   ```
3. On every change to savable state call `platform.markDirty()` (the push is
   throttled and also flushed when the app is backgrounded).
4. At game over / level complete call
   `platform.submitScore(score, meta, rank => showRank(rank))`. The first call
   triggers the consent prompt.
5. Render a leaderboard from `platform.getLeaderboard(20, ({entries, me}) => …)`;
   each entry has `{ rank, name, score, userKey, picture, isSelf, metadata }`.
6. Drive connect/retry from a visible **Sync** control using `platform.connect()`
   and `platform.connectLeaderboard()`; read `platform.state()` for UI.

## Graceful degradation (required)

The game must be fully playable and error-free with no host. `state().mode`:

- **`local`** (`reason: 'not-in-paean'`, e.g. a plain browser) — fall back to
  `localStorage` for saves and best score. The reference module does this for
  you: it persists the save blob under `<storageNamespace>.save` on every
  throttled flush and restores it in `init()`. Show the leaderboard entry as
  "Open in the Paean App or on 8x.gg to compete globally." **Never block play.**
- **`preview`** — a scrolling feed preview: do NOT call authorized APIs or show
  any consent UI. `PaeanSDK.ready()` stays pending; init platform features only
  once it resolves. The reference module does this for you.
- **auth denied** (`ensure` → false) — degrade as `local`, but keep a retry
  entry point.
- **failed submit** (network/host error) — queue the score in `localStorage` and
  flush on the next launch or when back online. The module does this.

## Gotchas (verified across hosts — the reference module handles all of these)

- **Capabilities vary.** Some hosts don't (yet) offer a leaderboard. Check
  `PaeanSDK.host && PaeanSDK.host.leaderboard` (and `.storage`, `.account`)
  before calling; degrade that feature to `local` if absent.
- **Grants are per-scope, not all-or-nothing.** A host may grant only some of
  the scopes you request. Read each scope's truth independently with
  `p.auth.has(scope)` — never let one missing scope (e.g. leaderboard) take
  cloud save down with it. If a request containing an unknown scope is rejected
  wholesale, retry with the bare minimum (`['storage.kv']`).
- **`storage.get` return shape differs.** Some hosts return the entry wrapper
  `{ key, value, … }`; others return the bare value. Unwrap defensively:
  `const v = (r && r.value !== undefined) ? r.value : r;`
- **"No save yet" has two shapes.** A fresh account's `storage.get` may *reject*
  with "key not found" on one host and *resolve* `null` on another. Treat both
  as a new account (seed the first save), not an error.
- **First-write ordering.** Don't push a save before the first read completes,
  or a fresh device can overwrite the cloud with empty state. Gate the first
  `put` on the first `get` finishing (or failing).
- **Late bridge injection.** Some native hosts inject `window.paean` *after*
  `ready()`'s grace window. If `ready()` rejected, keep polling
  `PaeanSDK.isAvailable()` briefly and reconnect when it appears, instead of
  staying in local mode all session.
- **Leaderboard self-marker.** The authoritative "this is me" flag on an entry
  is `isSelf`; also fall back to matching `userKey`. Names/pictures arrive under
  a few possible keys — read them defensively.
- **Quotas exist.** Per-value, per-user, and per-board limits are enforced
  server-side; oversized or over-count writes fail (HTTP 4xx). Keep saves small
  (store a compact blob under one key) and handle a failed write gracefully.

## Host chrome + full-screen layout (required for every Square app)

Independent of cloud save / leaderboards: the Paean player runs your page **full
screen** — edge to edge, under the notch / Dynamic Island and under the home
indicator — and floats a host capsule (`···` menu + exit) over the **top-right**
corner. Two regions are therefore not yours. The host publishes both; read them
instead of guessing, and never hard-code a top-right element at `top: 8px`.

| CSS variable | Meaning |
| --- | --- |
| `--paean-chrome-top` / `-right` / `-bottom` / `-left` / `-width` / `-height` | the host capsule's rect, in CSS px |
| `--paean-chrome-inset-top` | `top + height` — the first y a top-right element may use |
| `--paean-safe-top` / `-right` / `-bottom` / `-left` | device safe-area insets |

Rules:

- Ship `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`.
- Always give a `0px` fallback so the same page still lays out in a plain browser
  where nothing sets these: `var(--paean-chrome-inset-top, 0px)`.
- Top-right UI clears `--paean-chrome-inset-top`; the other edges clear `--paean-safe-*`.
- Backgrounds and canvases SHOULD fill the viewport. It is only what the player
  must read or tap that insets.
- Optional JS, for relayout on rotation: `paeanChrome()` / `onPaeanChromeChange(fn)` in `reference/paean-platform.js` (read the CSS
  vars, fire on rotation), or the raw `window.paean.chromeRect()` /
  `window.paean.safeArea()` plus the `paeanchromechange` event.

```css
:root{
  --hud-top-right: calc(var(--paean-chrome-inset-top, var(--paean-safe-top, 0px)) + 8px);
  --hud-bottom:    calc(var(--paean-safe-bottom, 0px) + 8px);
}
.hud-top-right { position: fixed; top: var(--hud-top-right); right: calc(var(--paean-safe-right, 0px) + 8px); }
.hud-bottom    { position: fixed; bottom: var(--hud-bottom); }
```

Check before publishing: nothing interactive or critical sits under the capsule
or under the notch / home indicator, in both orientations.

## Security rules

- Never ask the user for an account, password, or token. Auth is entirely the
  host's consent flow.
- Send nothing to any third-party server. The only I/O is through
  `PaeanSDK` / `window.paean`.
- Never modify or fake `window.paean`, `PaeanSDK.host`, or the SDK's internal
  transport globals.

## Testing

Prove the integration offline before publishing:

1. Serve the app locally (`python3 -m http.server`, `npx serve`, …).
2. Adapt `reference/test-example.mjs` (set `APP_URL`, add asserts for your UI).
3. `node reference/test-example.mjs` — it injects `mock-bridge.js` to exercise
   plain-browser, pre-granted, partial-grant, wholesale-reject, both
   missing-save shapes, and the bare-value shape.
4. Layout: run at a phone viewport with `mockBridgeSource({ chrome: true })`,
   which publishes the capsule rect + safe insets on both channels the player
   uses. Without it the browser sets none of them and a HUD pinned at
   `top: 8px` passes locally, then lands under the capsule on device.
   Screenshot it — the asserts prove the geometry is published, only your eyes
   prove nothing readable or tappable sits under it.

Acceptance: plain browser plays with no errors; deleting `window.paean.leaderboard`
in the mock doesn't crash; in a real `8x.gg` shell the first score submit
triggers sign-in + consent, then submit/get and the rank render; no token, API
key, or backend URL anywhere in the code.

## Then publish

Use the **paean-publish** skill. Publishing serves the app at `*.clide.app`,
where the platform swaps in the canonical `paean-sdk.js`, and the host bridge
activates inside the Paean app / `8x.gg` shell.
