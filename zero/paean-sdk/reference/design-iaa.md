# IAA: rewarded advertising

Use when an optional reward fits a natural pause: a revive after defeat, a bonus after a round, or a clearly described optional hint. The documented SDK surface is rewarded ads; do not infer banner or interstitial APIs from the IAA label.

- Design the placement, reward, eligibility, and frequency before wiring ads. Preserve a useful decline path and keep ads out of loading, attract mode, and uninterrupted action.
- On the user's reward action, request `ads.rewarded`. Use `ads.isRewardedAvailable()` and the current host capability contract; preload is preparation, not a capability probe.
- Call `ads.showRewarded()` and grant only when `result.rewarded === true`. Cancellation, no inventory, and errors grant nothing and leave the game recoverable.
- Freeze the eligible run/reward context while an ad is pending, prevent parallel presentations, and apply a successful reward once. Ignore stale completion callbacks after scene/run disposal.
- Resume input/audio correctly after presentation. For a revive, specify the restored state and short protection window where the game needs one.

Acceptance: success, dismissed ad, no inventory, denied scope, unavailable namespace, background/return, repeated taps, and a stale callback after restart. Use strict mock checks plus local test doubles for outcomes not exposed by mock options.

