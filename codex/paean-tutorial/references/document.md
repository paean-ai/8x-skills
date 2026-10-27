# Freeform tutorial document

Only the metadata envelope is structured. The body can be any HTML or Markdown document; headings, prompts, comparisons, tables, images and narrative are the author's choice.

```json
{
  "title": "From a creative brief to an Agent-built world",
  "summary": "The prompts, iterations and trade-offs behind this project.",
  "language": "en",
  "format": "markdown",
  "content": "# The creative direction\n\nI gave the Agent this brief…\n\n> Use the supplied visual references to propose three directions.\n\nThe first result looked polished but missed the intended atmosphere. Here is the feedback that changed it…",
  "previewContent": "An optional, separately written public excerpt.",
  "priceCredits": 100
}
```

`format` is `html` or `markdown`. Title ≤200 characters, summary ≤1000, content ≤400000, previewContent ≤80000, entire JSON document ≤500 KB UTF-8. Language uses a BCP47-style tag. Price is 0 (free) or integer 1–100000 credits. Publishing requires a title and nonempty content, not a summary, curriculum or rubric.

Title, summary, language, format, price and presence of a preview are public metadata. The full content is never included there. `tutorialRead action=content` returns `{format,content,version,isPreview}` after access enforcement. `previewOnly:true` returns only the separate previewContent (possibly empty); it never automatically truncates or reveals the paid document.

`tutorialWrite action=create` takes the game hashKey and JSON document in payload. `save` takes the tutorial hashKey, expectedVersion=draftVersion and document payload. `publish` takes the current draftVersion. Publishing increments draftVersion and creates an immutable published version.

`tutorialPurchase` takes hashKey, expectedPriceCredits, expectedVersion (quoted published version) and requestKey. The server checks the actual price/version and deduplicates access.

Optional reading state:

- `tutorialWrite action=learn` starts/resumes a pinned document version without creating a workspace.
- `tutorialRead action=progress` returns version, updateVersion, position and notes. Position is any personal location hint; notes are freeform and private to that learner.
- `tutorialWrite action=notes`, payload `{"expectedVersion":1,"position":"Visual direction comparison","notes":"Try the second prompt with my own references."}`. position ≤500 characters, notes ≤10000. expectedVersion is progress.updateVersion.
- `learn` with payload `{"useLatest":true,"expectedVersion":2}` switches to the latest document, preserving notes and clearing the old location hint.

HTML is retained as authored in storage, then sanitized and sandboxed for Web display; scripts/forms/active embeds cannot execute. It is a document, not a runnable game. Paid content must stay out of public game packages, source exports and shared skills.
