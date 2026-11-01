# AI: runtime intelligence

Use for a specific player benefit such as an NPC conversation, a contextual hint, player-created content, or voice interaction. Distinguish runtime SDK AI from development-time ImageGen used to produce bundled game art or banners, and from Paean TTS used to produce fixed speech assets.

- Choose the smallest surface matching the interaction: `ai.chat/vision/image/tts/asr`; use `agent.run/ask` only when its tool-enabled workflow is needed. Inspect current SDK docs for signatures, model availability, scopes, streaming, and usage limits.
- Keep model choice/configuration centralized. Do not assume a model named in an older skill is still available or accessible on every account tier. Handle quota/credit exhaustion and unavailable models with a tested fallback.
- Put calls behind intentional use and explain the interaction's cost where relevant. Bound input/context, output length, concurrency, and retry count. Avoid automatic paid retries or calls in attract mode.
- Show progress and allow abandonment; invalidate late results after a scene changes. Stream displayed text where supported. A failed request should preserve user input and offer authored content, a local hint, or a clear retry state appropriate to the feature.
- Treat model output as content. Validate structured results before applying them; never execute generated JavaScript or let generated text directly award purchases, currency, or ranked scores.
- Send only context needed for the feature, keep secrets out of prompts, and route visible UI through the game's locale system. Generated media also needs loading, size, and lifecycle handling.

Acceptance: granted/denied scope, missing capability, quota failure, malformed output, partial stream/error, slow response, repeated input, and scene changes. Mock responses prove wiring only; assess output quality, latency, and cost separately on the real host when that testing is authorized.

## Speech with Paean TTS

- **Fixed script during creation:** use [paean-tts](../../paean-tts/SKILL.md) for character lines,
  narrated tutorials, pronunciation samples, and promotional voiceovers. Its local CLI calls
  Paean's `/dashscope/tts`, saves the returned audio, and reuses completed segments. No upstream
  DashScope key is needed. Keep the creator's credentials and production scripts out of the app.
- **Dynamic speech during play:** use `PaeanSDK.ai.tts()` with the `ai.tts` scope after an
  intentional player action. Inspect the shipped SDK and real host for the exact arguments,
  available voices, and return/playback shape; the REST response `{ data: { audioUrl } }` is not
  evidence of the SDK return type. Do not bypass a missing host capability with a hard-coded JWT.
- **Credential boundary:** the creator's Paean JWT is an account secret used only by the local
  production helper. Runtime TTS uses the player's host-managed session; never ask the player to
  paste a JWT or read/store it in app code. Never put credentials in frontend environment variables,
  bundled JS/JSON, browser storage, source maps, logs, or distributable archives. Inspect the final
  build/archive before delivery; encoding or obfuscation does not make a frontend token secret.
- Check readiness and capability, request scope at the speaking feature's entry point, and handle
  denied scope, quota exhaustion, unsupported hosts, offline use, and autoplay rejection. Show
  the text throughout and let the player retry playback without automatically regenerating it.
- Debounce repeated taps and reuse audio for unchanged text/voice within the appropriate session.
  Keep private text out of cross-user caches. Bound text length and pending speech; stop playback
  or discard a late result when the scene changes. Respect mute, pause, and hidden-page state.
- Bundle fixed speech only when the delivery target permits audio files. RedNote mini-tools have
  no runtime network and their current whitelist excludes WAV/MP3; keep TTS in the separate 8x
  version or the standalone promo-video workflow.

Speech acceptance: real-host synthesis and playback, first-gesture unlock, repeated clicks,
expired/unavailable media, mute during loading/playback, scene changes, offline text fallback,
and pronunciation/timing. A mock TTS response or readable WAV header does not prove voice quality.
