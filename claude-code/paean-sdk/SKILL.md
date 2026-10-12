---
name: paean-sdk
description: Add Paean platform capabilities to a static app/game published to Paean Apps Square (*.clide.app / 8x.gg) via the Paean Web SDK — cloud save, shared leaderboards, shared app data, paid apps and durable products (access.*), in-app purchases and tips (pay.*), rewarded ads, online rooms, AI, share — plus the offline mock library that proves the integration before publishing. Use when the user wants to add cloud save, sync progress across devices, a global/online leaderboard, "接入积分/存档/排行榜", make an app paid / sell it / add a paywall or season pass, add in-app purchases, tips, rewarded ads, multiplayer rooms, or test the SDK integration locally. Not for publishing (see paean-publish).
---

# Paean SDK — platform capabilities for Square apps

Give a published Paean app the platform's account-bound capabilities through
the Paean Web SDK (`paean-sdk.js`, currently **1.10.0**). The app never sees a
token or a backend URL: every call goes through a host bridge (`window.paean`,
wrapped by the friendly `PaeanSDK` helper) that the Paean app / `8x.gg` web
shell proxies for the signed-in user, isolated per **(app × user)**. In a plain
browser there is no host, so everything must degrade to `localStorage` and the
app must stay fully usable (or, for a paid app, stay in its demo).

This skill integrates platform services into an existing app. For creating or
broadly polishing the game itself use `paean-game-create`; for publishing (and
declaring a price) use `paean-publish`.

## Files (`reference/`)

- **`paean-platform.js`** — framework-agnostic integration module: detection,
  consent, throttled cloud save with cross-device merge, leaderboard
  submit/query with an offline queue, paid-app gate (`requireAccess`), host
  chrome helpers, full `localStorage` fallback. Copy next to `paean-sdk.js`.
- **`paean-mock.js`** — the **offline mock host**: a complete fake
  `window.paean` (every SDK 1.10 namespace) that reproduces the host-shape
  variations only real devices show (partial grants, wholesale rejection, both
  missing-save shapes, bare-value `storage.get`, feed preview, paid app /
  declined purchase, host chrome, old hosts missing a namespace) and, in
  `strict` mode, records consent-discipline violations (a scope asked with no
  user gesture, a prompt during preview, a spend without an idempotency key).
  Use it from Playwright (`mockBridgeSource(opts)`) or load it in a plain
  `<script>` before `paean-sdk.js` and add `?mock=1&…` to the URL while
  developing. `mock-bridge.js` is a shim that re-exports it.
- **`test-example.mjs`** — a runnable Playwright test driving the mock through
  each case. Adapt `APP_URL` and the asserts to your UI.

## Prerequisite: ship `paean-sdk.js`

```html
<script src="paean-sdk.js"></script>
```

Bundle a copy as a top-level file (copy it from any published app:
`https://<any-handle>.clide.app/paean-sdk.js`). Once published, the clide
platform serves the canonical latest SDK for any request ending in
`/paean-sdk.js`. The SDK exposes the global `PaeanSDK` and never overwrites
`window.paean`; the raw bridge is `PaeanSDK.host`.

## The surface (SDK 1.10.0)

Everything below lives on the `PaeanSDK` helper; `PaeanSDK.host` is the raw
bridge for power users. Scopes are in `PaeanSDK.SCOPES`.

| Area | Calls | Scope |
| --- | --- | --- |
| Detection | `ready()`, `detect()`, `isAvailable()` | — |
| Consent | `auth.ensure(scopes)`, `auth.has(scope)`, `auth.onChange(cb)` | — |
| Cloud save | `storage.get/put/delete/list` (values normalized) | `storage.kv` |
| Leaderboards | `leaderboard.submitScore/get/getMyRank/deleteMyEntry/stats` | `storage.leaderboard` (`stats`: `storage.stats`) |
| Shared app data | `shared.get/put/delete/list` (versioned, CAS) | `storage.shared.read` / `.write` |
| App stats | `app.stats()` | `storage.stats` |
| Profile | `account.profile()` → `{ displayName, userKey }` | `account.profile` |
| **Paid app / products** | `access.status()`, `access.require({ sku })`, `access.owned(sku)`, `access.onChange(cb)`, `access.openShell()` | **none** (host owns the sheet) |
| In-app purchase | `pay.quote()`, `pay.spend()`, `pay.receipt()` | `pay.spend` |
| Tip | `pay.tip()` | none |
| Rewarded ads | `ads.preloadRewarded()`, `ads.isRewardedAvailable()`, `ads.showRewarded()` | `ads.rewarded` |
| Online rooms | `room.join/send/leave/peek/list`, `room.state.set/get/onChange`, `room.onMessage/onMember/onClosed/onResync/onError` | `net.room` |
| AI | `ai.chat()`, `ai.vision()`, `ai.image()`, `ai.tts()`, `ai.asr()` | `ai.chat` / `ai.image` / `ai.tts` / `ai.asr` |
| Agent | `agent.run()`, `agent.ask()` | `agent.chat` |
| Share | `share({ title, text, url })` | none |
| Usage | `usage.current()`, `usage.onUpdate(cb)` | none |

Feature-detect optional surfaces on `PaeanSDK.host` (`host.shared`,
`host.pay`, `host.room`, `host.room.state`, `host.access`): hosts ship on
different schedules. Calling a surface the host lacks rejects with
`PaeanUnsupportedError` (`e.code === 'sdk-too-old'`), never a TypeError.

```js
// Readiness (handles the injection race). Rejects with PaeanUnsupportedError
// in a plain browser; stays PENDING in a feed preview and resolves on tap-in.
const p = await PaeanSDK.ready();

// Consent (first time shows the host's consent UI; the web shell may sign in first)
await p.auth.ensure(['storage.kv', 'storage.leaderboard', 'account.profile']);
p.auth.has('storage.kv');

// Cloud save + leaderboard
await p.storage.put('save', { best: 240, level: 7 });
const save = await p.storage.get('save');          // value or null
await p.leaderboard.submitScore('main', score, { metadata: { level } });
const { entries, me } = await p.leaderboard.get('main', { limit: 20 });
```

## Paid apps and durable products (`access.*`)

A Square app can be sold like a Steam game: everybody watches the demo; entering
the real thing needs a purchase. The publisher declares it at publish time
(`paean-publish --price 100`, written to `clide.json` `access`). The app makes
**one call, on the first intentional tap** — never at boot, never during the
demo:

```js
const r = await PaeanSDK.access.require();          // { unlocked, reason, receipt, status }
if (r.unlocked) startRun();
else if (r.status && r.status.shellUrl && !r.status.hosted) offerOpenOn8x(() => PaeanSDK.access.openShell());
else stayInDemo();                                  // the user closed the sheet — normal
```

- **Free apps and the publisher resolve `unlocked: true` with no UI**, so gate
  unconditionally and let the platform decide. Write the gate for every app.
- **You never name a price and need no scope.** The host reads the price from
  the listing and confirms it in its own UI (same trust model as `pay.tip`).
- `unlocked: false` is a normal outcome: keep the demo, keep the entry point.
- Durable products (a season pass, an expansion) use the same call with a
  `sku` declared in `clide.json` `access.products`; read ownership back with
  `access.owned(sku)` / `access.status()` — it is a **server record**, do not
  cache it in `localStorage` as truth.
- Until the app is owned, every account-bound call (storage, leaderboards,
  shared, `app.stats`, `pay.spend`, rooms) rejects with `e.code === 'APP_NOT_OWNED'`.
  Treat it like a declined scope: local fallback, no crash.
- Standalone `*.clide.app` visits follow the publisher's `standalone` policy
  (`allow` / `demo` / `shell`); the SDK reads it from `/paean-app.json` and
  reports it in `access.status()` (`hosted: false`). `?__paean_raw=1` bypasses
  a `shell` redirect while testing.
- Remixes of a paid app are paid (the platform enforces it), and a paid app
  cannot be switched back to free. Plan the price before publishing.

The reference module wraps this as `platform.requireAccess(sku)`,
`platform.openShell()` and `state().access`.

## In-app purchases, tips, ads, rooms, AI

Documented in full in the SDK's own README (`paean-sdk.js` header + the
`README.md` next to it in the canonical repo). The rules that matter:

- **`pay.spend`** is real money at an amount the app names, confirmed natively.
  Grant goods only when `granted === true`; pass a STABLE `idempotencyKey` per
  purchase intent; read `quote().limits`, never hardcode minimums; prefer
  `credits` (iOS refuses the USD lane). For anything durable prefer
  `access.products` — the server remembers it, `pay.spend` does not.
- **`pay.tip()`** needs no scope; the host owns the sheet.
- **Ads**: request `ads.rewarded` on the user's tap, then `showRewarded()`;
  grant only when `result.rewarded === true`. Never use preload as a
  capability probe.
- **Rooms**: request `net.room` on the user's tap; single-player must keep
  working without it. Prefer `room.state` (server-authoritative) over
  broadcasting the world.
- **AI**: request the scope on first real use; default to `deepseek-v4-flash`
  for text and `gemini-3.1-flash-lite` for vision; stream when the UI shows text.

## Integration recipe

1. Copy `reference/paean-platform.js` next to `paean-sdk.js`, load both.
2. Create the platform and wire four callbacks to your game state:
   ```js
   const platform = createPaeanPlatform({
     storageNamespace: 'mygame', saveKey: 'save', board: 'main',
     getLocalSave: () => ({ best, unlocks }),
     applySave:   (s) => { best = Math.max(best, s.best||0); },
     mergeSave:   (cloud, local) => ({ best: Math.max(cloud.best||0, local.best||0) }),
     onState:     (st) => renderCloudUI(st),
   });
   platform.init();
   ```
3. On the first intentional tap: `platform.requireAccess().then(r => r.unlocked && startRun())`.
4. On every change to savable state call `platform.markDirty()`.
5. At game over call `platform.submitScore(score, meta, rank => showRank(rank))`
   (the first call triggers consent). Render `platform.getLeaderboard(20, cb)`.
6. Drive connect/retry from a visible **Sync** control with `platform.connect()`.

## Graceful degradation (required)

`state().mode` is `local` (plain browser), `preview` (feed preview: do NOT call
authorized APIs or show consent UI — `ready()` stays pending), or `paean`. A
denied grant degrades to `local` with a retry entry point; a failed submit
queues the score. **Never block play** — except behind the paid-app gate, which
keeps the demo running instead.

## Feed preview and host chrome (every Square app)

- In the immersive feed the page boots as a **preview**: `window.__paeanPreview
  === true`, no touches, no `window.paean`. Run the attract/demo mode; the host
  dispatches `paean:interactive` and injects the bridge on tap-in. `detect()`
  reports `reason: 'preview'`.
- Native hosts run the page full screen and float a capsule over the top-right
  corner. Ship `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`.
  They publish `--paean-chrome-*` / `--paean-safe-*` CSS variables,
  `window.paean.chromeRect()` / `safeArea()` and `paeanchromechange`. This is
  a **host** contract (not in `paean-sdk.js`); always give the CSS variables a
  `0px` fallback. `paeanChrome()` / `onPaeanChromeChange(fn)` in the reference
  module read them.

```css
:root{
  --hud-top-right: calc(var(--paean-chrome-inset-top, var(--paean-safe-top, 0px)) + 8px);
  --hud-bottom:    calc(var(--paean-safe-bottom, 0px) + 8px);
}
```

## Gotchas the reference module handles

- Capabilities vary per host; grants are per-scope, not all-or-nothing; a host
  may reject an unknown scope wholesale (retry with `['storage.kv']`).
- `storage.get` may resolve the bare value or `{ value }` on old hosts; the
  helper normalizes. "No save yet" may reject ("key not found") or resolve
  `null`. Never push a save before the first read settles.
- Some native hosts inject `window.paean` late: keep polling `isAvailable()`.
- Quotas are enforced server-side; keep saves small.
- `platform.dispose()` stops timers/listeners (hot reload, tests).

## Testing with the mock host (required before publishing)

`reference/paean-mock.js` is the offline host. Two ways to use it:

1. **Playwright** (what `test-example.mjs` does): `page.addInitScript(mockBridgeSource(opts))`
   before `goto`. Cases to keep: plain browser; pre-granted; iOS-like partial
   grant; wholesale rejection; both missing-save shapes; bare-value shape;
   `{ preview: true }` (no prompt until `window.__mock.enterInteractive()`);
   `{ access: { model: 'paid', price: 100 } }` (boot stays in demo,
   `access.require()` on the tap unlocks) and `{ …, decline: true }` (stays in
   demo, no throw); `{ chrome: true }` at a phone viewport (screenshot it).
2. **Plain `<script>` while developing**: put
   `<script>eval(mockBridgeSource({ grant: ['storage.kv'] }))</script>` (or the
   serialized string) before your scripts in a local-only HTML, and inspect
   `window.__mock.requests` / `.accessRequests` / `.store` / `.rows` /
   `.shares` in the console. Remove it before publishing.

Acceptance: plain browser plays with no errors; no consent or purchase prompt
at boot or in preview; the paid gate sits on the first intentional tap; a
declined purchase keeps the demo; deleting `window.paean.leaderboard` in the
mock does not crash; no token, API key, or backend URL anywhere in the code.

## Security rules

- Never ask the user for an account, password, or token.
- Send nothing to any third-party server; the only I/O is `PaeanSDK` / `window.paean`.
- Never modify or fake `window.paean`, `PaeanSDK.host`, or the SDK's
  transport globals in shipped code (the mock is for local tests only).

## Then publish

Use **paean-publish** (`--price` for a paid app). Publishing serves the app at
`*.clide.app`, the platform swaps in the canonical `paean-sdk.js`, and the host
bridge activates inside the Paean app / `8x.gg` shell.
