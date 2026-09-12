# Rank: scoring, leaderboards, and progress

Use for replayable games with comparable outcomes. Decide what skill the score measures before exposing a global ranking. A narrative app may benefit from cloud save without any leaderboard.

- Define score direction/meaning, tie behavior supported by the current API, eligibility, board names, and ruleset/season boundaries. Separate incomparable modes or versions. Do not invent server sorting/reset capabilities.
- Submit completed eligible real runs, never attract runs or partial demo scores. Keep local personal best useful offline and reuse paean-platform's queue and cloud-save merge where appropriate.
- Give the player a result-screen entry and their own rank context. Empty, loading, offline, and failed boards need concise states. Use player identity keys rather than display names to identify self.
- Request only the scopes used: `storage.leaderboard`, optional `account.profile`, `storage.kv` for saves, and `storage.stats` for stats. A denied ranking scope must not disable saves.
- Define merge rules per save field; a maximum suits a best score, not consumable balances or arbitrary progress. Wait for the initial cloud read before writing.
- Document ranking trust: client score submission is not proof of fair play. Paid boosts, ad revives, and AI assistance need an explicit eligibility rule.

Acceptance: empty/populated boards, self rank, local fallback, partial grants, failed submission/retry, reload, multiple device save conflicts, and ruleset separation. Verify ordering and tie semantics against the current host contract before promising them.

