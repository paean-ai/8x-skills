# AI: runtime intelligence

Use for a specific player benefit such as an NPC conversation, a contextual hint, player-created content, or voice interaction. Distinguish runtime SDK AI from development-time ImageGen used to produce bundled game art or banners.

- Choose the smallest surface matching the interaction: `ai.chat/vision/image/tts/asr`; use `agent.run/ask` only when its tool-enabled workflow is needed. Inspect current SDK docs for signatures, model availability, scopes, streaming, and usage limits.
- Keep model choice/configuration centralized. Do not assume a model named in an older skill is still available or accessible on every account tier. Handle quota/credit exhaustion and unavailable models with a tested fallback.
- Put calls behind intentional use and explain the interaction's cost where relevant. Bound input/context, output length, concurrency, and retry count. Avoid automatic paid retries or calls in attract mode.
- Show progress and allow abandonment; invalidate late results after a scene changes. Stream displayed text where supported. A failed request should preserve user input and offer authored content, a local hint, or a clear retry state appropriate to the feature.
- Treat model output as content. Validate structured results before applying them; never execute generated JavaScript or let generated text directly award purchases, currency, or ranked scores.
- Send only context needed for the feature, keep secrets out of prompts, and route visible UI through the game's locale system. Generated media also needs loading, size, and lifecycle handling.

Acceptance: granted/denied scope, missing capability, quota failure, malformed output, partial stream/error, slow response, repeated input, and scene changes. Mock responses prove wiring only; assess output quality, latency, and cost separately on the real host when that testing is authorized.

