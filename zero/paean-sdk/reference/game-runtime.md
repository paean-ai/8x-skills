# Game runtime v1

This is a renderer-independent lifecycle/quality helper, separate from account SDK readiness.
The current canonical account SDK inspected for this integration is 1.11.1. Do not replace it,
change its transport, or wait for account readiness before declaring a preview scene playable.

Copy paean-runtime.js into the release and load it before application scripts. Add
<meta name="paean-runtime" content="1"> inside the head (after the copyright comment).
Keep the game's framework and renderer. Integrate these callbacks; copying the helper alone
does not optimize a game.

1. Create one runtime at boot with canvas/opaque/keepAwake only when they are true.
2. Implement onState: stop local simulation, clear held controls, pause Worker simulation and
   nonessential timers when paused. Reset simulation clocks on resume. A multiplayer server
   is not paused: preserve its connection and resynchronize on return.
3. Implement onQuality: adjust the renderer's drawing buffer, shadows, particles, LOD and
   postprocessing. runtime.pixelRatio(cssWidth, cssHeight) respects the host's pixel budget;
   keep CSS layout, pointer coordinates and HUD unchanged. CPU bottlenecks need logic fixes.
4. Call runtime.ready() after essential resources/checkpoint restoration and the first submitted
   usable frame, with input connected. The helper's ready is idempotent. It is not proof the
   screen has physically displayed the frame.
5. Use runtime.startLoop(callback) or call runtime.frame(timestamp) only after actual render
   submission in your own loop. Do not count rAF callbacks as rendered frames. The helper emits
   aggregate samples every two seconds, never a native message per frame.
6. Implement getSave/applySave, saveSchema and an application-specific saveKey. Validate data
   before applying it; migrate known schema versions explicitly. Call checkpoint after important
   progress. Periodic/local saves are a fallback, not a replacement for consent-aware cloud
   saves. Use an account-specific userScope for account-specific progress; do not save private
   account data in a shared guest namespace. onCheckpoint can call the existing platform
   adapter's markDirty; it must never prompt at boot, preview, or suspension.
7. Use watchCanvas for WebGL context restoration; recreate graphics resources in its callback.
   For WebGPU use watchDevice and attach the newly created device again after recovery.
8. Plain browsers and older hosts must still work. Handle audio-route changes and user audio
   preferences; no auto-unmute after headphone removal. Dispose on teardown.

## Packaging and offline

Run paean-game-create/scripts/package-runtime.mjs RELEASE after integration and after every
asset edit, then validate-game.mjs RELEASE --require-runtime. The packager hashes all bundled
assets, embeds a content version, and generates a scoped service worker. It never adds gameplay
behavior on the author's behalf. The resulting manifest is also checked by the validator.

After the game is playable, call runtime.verifyOffline() and handle false normally. Do not
display offline-ready before verification. Installation checks SHA-256 and byte length for every
asset and removes partial caches on failure. Existing players stay on their complete old version
until the old worker can retire. Root queries added by native hosts do not bypass offline entry
lookup. Cache eviction can still make a previously verified package unavailable; test and recover.
The worker never caches account/API responses or cross-origin requests.

Use relative asset URLs. Clide's opt-in publish path places the game in a content-addressed
release directory and changes the root entry only after every release asset is uploaded. The
manifest describes the actual deployed bytes. If the hosting platform substitutes a canonical
SDK or other mutable resource, a mismatch must fail verification; update the bundled dependency
or use its versioned artifact rather than skipping integrity checks.

## Required evidence

Include: delayed ready, pause during a host modal, background/resume without time jumps,
Worker pause, simultaneous touch input, checkpoint reload, rejected/corrupt save, graphics
context loss, low quality mode, missing cached asset and version replacement. Check that a
payment/authorization request remains alive while simulation is paused.

Save device model, OS, host/runtime build, content version and game scene with results. Use a
15-minute real-device session for sustained performance claims; browser/Simulator samples are
functional evidence only. Target 60 FPS or an explicit stable 30 FPS profile, and record p95,
long frames, thermal state, start time and process recovery. Send concrete findings back to the
AI repair step; never claim a static marker or an empty scene proves native game quality.

## Repeatable diagnostics

Export PaeanGameDiagnostics through the host's onGameDiagnostic callback during a diagnostic
session (the bounded in-memory ring is not a 15-minute recorder). The iOS IOSAudit target has
`-runtimeBenchmark` and `-runtime2d` fixtures; these are functional/load fixtures, not production
game acceptance. Replay a representative production scene at a pinned content version for the
release decision. Keep device/scene/power/network metadata alongside the JSON.

Run `node paean-game-create/scripts/analyze-runtime.mjs diagnostics.json metadata.json`.
Metadata should include `kind: "physical-device"`, an actual `device` model, scene and conditions.
The analyzer separates content versions and 30/60 FPS profiles, detects interruptions, reports
max window p95 and long-frame ratios, and emits actionable profiling/replay instructions for
AI repair. It refuses a 15-minute pass on short, interrupted, incomplete, unversioned or desktop
runs. A frame-gate pass does not certify input latency, thermal/energy quality or overall gameplay.
The 30 FPS floor is retained for a player session: good 30 FPS pacing alone does not demonstrate
60 FPS headroom. Re-enter or explicitly restart the player to evaluate a fresh budget.

Run `node --test tests/game-runtime.test.mjs tests/game-runtime-browser.test.mjs` in 8x-skills
with Playwright installed. Browser tests cover real Canvas2D/WebGL2 rendering, modal pause,
checkpoint replay, context loss, separate release caches, offline reload and asset eviction.
They do not generate a mobile performance score.

### WKWebView offline capability boundary

Feature-detect Service Workers; the helper returns false when unavailable. The current iOS
hosts do not opt into App-Bound Domains. The app-hosted iOS 27 Simulator probe reported a secure
context and Cache Storage, but no navigator.serviceWorker. Therefore this implementation does
not claim verified offline play in those hosts yet; online immutable caching still works.
Do not silently add WKAppBoundDomains: it changes script-injection behavior for every WebView,
including previews, ads and other embedded content. A dedicated domain-policy rollout and
compatibility test are required before enabling that route. References:
https://webkit.org/blog/10882/app-bound-domains/
https://bugs.webkit.org/show_bug.cgi?id=206741

Clide publishing pins the canonical platform account SDK into the immutable release before
hashing. A missing SDK prevents publishing; existing releases never silently receive new SDK
bytes. Local offline testing requires all dependencies bundled, including the account SDK if
used. Account/cloud features still require network connectivity and authorization.
