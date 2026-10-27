# Tutorial document and tool contract

Create/save accept this complete document. Use stable chapter IDs when editing; deleting a chapter from a new revision does not delete older published revisions.

```json
{
  "title": "Build the jump mechanic",
  "summary": "Create input, gravity and reliable landing.",
  "language": "en",
  "level": "beginner",
  "objectives": "Implement and verify a jump loop.",
  "prerequisites": "Basic JavaScript",
  "sourceNotes": "A reconstruction based on the game's current version.",
  "priceCredits": 100,
  "chapters": [
    {
      "id": "jump",
      "title": "A first jump",
      "objective": "Apply velocity and gravity once per frame.",
      "body": "Markdown explanation, code blocks, and the reason for each step.",
      "exercise": "Implement jump input with a grounded check.",
      "checkpoint": "One press produces one jump; the player lands without sinking.",
      "preview": false
    }
  ]
}
```

Limits: 1–40 chapters, unique IDs matching `[a-zA-Z0-9_-]{1,64}`, total document ≤500 KB. Title ≤200 characters, summary ≤1000, objectives/prerequisites/sourceNotes ≤3000 each; chapter title ≤160, objective ≤1000, body ≤40000, exercise ≤6000, checkpoint ≤2000. Price: 0 (free) or 1–100000 credits. Language uses a BCP47-style tag, and level is beginner/intermediate/advanced.

Publishing requires a summary and learning objectives, plus nonempty body/objective/checkpoint for every chapter. A paid tutorial needs a non-preview chapter. The title, summary, learning objectives, prerequisites, sourceNotes, price and chapter titles/preview flags are public. Never put paid lesson text there. For chapters, public metadata exposes only ID, title and preview flag; `chapter` reads return full authorized content separately.

MCP examples:

```json
{"action":"save","hashKey":"tutorial-id","expectedVersion":2,"payload":"<JSON document above>"}
```

`expectedVersion` for save/publish is the current `draftVersion`. Publication increments it. `tutorialWrite action=learn` creates or resumes one learning session per user/tutorial. Save a checkpoint with `tutorialWrite action=checkpoint` and this JSON in `payload` (or a file for the CLI):

```json
{"expectedVersion":1,"chapterId":"jump","completed":true,"evidence":"Observed one jump per press in the local browser.","method":"runtime_check"}
```

Here expectedVersion is `progress.updateVersion`. Methods: self_reported, agent_assisted, static_check, runtime_check. They record the caller's evidence; never claim checks were independently certified by the server.

`tutorialPurchase` takes hashKey, expectedPriceCredits, expectedVersion (published quote version), and requestKey. Prices and content versions are checked again in the purchase transaction; the request body cannot set the actual price.

To explicitly restart learning on the latest revision, use `tutorialWrite` action `learn` with payload `{"restartLatest":true,"expectedVersion":<progress.updateVersion>}`. This resets checkpoints; obtain the learner's intent first. Plain `learn` always resumes without resetting.
