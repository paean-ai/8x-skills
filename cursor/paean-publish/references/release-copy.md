# Release titles, descriptions, tags, and README

Apply this standard to the work's public release copy for creation, remix, publishing, and updates.
It governs the published work's README, not this skills repository's developer documentation.

## Language and identity

- Write the title, summary/description, tags, and README in **English by default**. Use a different
  language only when the user explicitly requests that language for the release or relevant text.
  A Chinese conversation, a non-English source game or UI, or a platform's audience does not by
  itself change this default. Apply an explicit exception to its requested scope.
- Give the work a distinctive name tied to its fantasy or activity. Replace inherited remix names,
  directory slugs, package names, and placeholders with the reviewed release title. Preserve proper
  names and required attribution accurately.

## Describe the experience with tags and design details

Descriptions must use specific keywords across every applicable dimension below. Include them
naturally in the prose and supply matching discovery tags in `clide.json.tags` for Square.
Do not substitute a tag list for an explanation of what the player actually does.

| Dimension | Information to convey | Example tags |
| --- | --- | --- |
| Gameplay / activity | Genre, core actions, objective, and central mechanic | `puzzle`, `tile-matching`, `drift-racing`, `deck-building` |
| Play style / mood | Pace, challenge, session feel, or social format | `cozy`, `fast-paced`, `tactical`, `score-attack`, `co-op` |
| Art style | Visible visual language, palette, and presentation | `pixel-art`, `watercolor`, `chibi`, `neon-noir`, `isometric` |
| Theme | The fantasy or subject that gives the work its identity | `fantasy`, `space-exploration`, `cooking`, `mystery` |
| Setting / background | Place, era, world, or story premise | `enchanted-forest`, `cyberpunk-city`, `underwater-ruins` |
| Distinctive design | Specific choices, interactions, progression, or visual details | `branching-routes`, `chain-reactions`, `evolving-companions` |

Cover all dimensions supported by the actual work; never invent a setting, story, feature, mode,
or visual treatment just to fill a row. For tools, describe the real activity, use case, visual
style, and signature interactions instead of inventing game mechanics. Prefer precise tags over
generic `game`, `fun`, or `cool`; avoid repeated synonyms and keyword stuffing. Short fields may
highlight the strongest hook, with remaining detail in the full description and README.

Lead the description with the player's role, actions, and goal. Connect the visual world and mood
to concrete design features that distinguish this work. Mention real controls and progression when
they explain the appeal. Check every claim against the playable version and its visuals.

Keep technical language out of descriptions, discovery tags, and the README: no programming languages,
frameworks, engines, APIs/SDKs, rendering pipelines, build/deployment details, file structure,
benchmarks, or claims such as "HTML5 game", "WebGL-powered", "single-file", or "AI-generated".
Describe an implementation's visible benefit only when verified: "a new maze each run" instead
of "procedural generation", or "fluid hand-painted characters" instead of naming a rigging system.
Preserve required legal credits or disclosures in their appropriate attribution section.

Example for a game that actually has these features:

- **Title:** Lanternwood Trails
- **Description:** Guide a fox courier through an enchanted forest in a cozy route-planning puzzle
  adventure. Link lanterns, choose branching paths, and deliver letters before nightfall.
  Watercolor groves, soft autumn colors, and trails that bloom with each delivery turn every
  completed route into a small celebration.
- **Tags:** `puzzle`, `route-planning`, `cozy`, `watercolor`, `autumn`, `fantasy`,
  `enchanted-forest`, `branching-paths`, `blooming-trails`.

## The work's README

Write a player-facing README using the same language, title, description, and tag vocabulary as
the release. Include the premise, core actions and goal, actual controls, distinctive design
features, visual style and setting, plus factual creator/source credits where applicable.
Keep it readable prose with a concise tag line; avoid a bare keyword list or generic sales claims.

Put commands, architecture, API integration, debugging, validation evidence, and recording or
ad-conversion entry points in a separate developer document such as `DEVELOPING.md`. Keep required
license notices intact. Do not turn the README or listing summary into an implementation report.

Before publishing, compare the resolved metadata and README with the finished work: verify the
default language or explicit exception, accurate tags across applicable dimensions, concrete design
features, and absence of technical promotional copy. The dry-run exposes metadata; it does not
judge its language, truthfulness, or editorial quality.
