# Creation-session API and recovery

Contract checked against `zero-api/src/modules/session-assets/{routes,service,jsonl,releases}.ts`
on 2026-10-15. Source implementation does not prove that a deployment has enabled the feature.
Use `GET /sessions/config` with the existing Paean JWT; do not enable server flags or provision
buckets as part of this skill. `PAEAN_API_BASE` is an explicit override; otherwise the helper uses
the Paean API and ignores non-Paean LLM gateways in Zero environment variables.

| Step | Endpoint | Result |
|---|---|---|
| Capability | `GET /sessions/config` | `data.enabled`, `maxBytes`; disabled means pending |
| Intent | `POST /sessions/uploads` | `{sourceKey, filename, digest, bytes}` → `data.asset`, `uploadUrl` |
| Bytes | `PUT <uploadUrl>` | Prepared bytes, `Content-Type: application/x-ndjson`, exact `Content-Length`; **no JWT** |
| Complete | `POST /sessions/uploads/:id/complete` | Server rehashes, validates, redacts and marks the immutable revision ready |
| Inspect | `GET /sessions/assets/:id` | Owner-only asset state |
| Link | `POST /sessions/assets/:id/app-evidence` | `{appHash}` → assurance and `release_id` |
| Verify | `GET /session-evidence/:appHash` | Public label for the current listed release; no transcript |

Responses wrap results in `{data: ...}`. The helper uses no redirects, sends the JWT only to the
API, and accepts staging URLs only on HTTPS Cloudflare R2 (same-origin localhost is allowed for
tests). Signed upload URLs expire after ten minutes. Do not log or persist them in public files.
Repeated intent creation with the same source key and prepared digest returns the ready asset
or renews staging. Completion and binding are idempotent.

The client caps both compressed and expanded inputs at 20 MiB and honors a lower server cap.
Inputs must be UTF-8, 1–50,000 object records, at most 1 MiB per record and 40 nesting levels.
Digests cover the prepared uploaded bytes. Private backup is a sanitized snapshot, not a byte-for-byte
archive of the original; keep the local original. No script executes transcript text.

| Failure | Recovery |
|---|---|
| Missing real JSONL | Obtain this task's actual export; never synthesize “proof”. Publishing may finish with `workflowComplete: false`. |
| Feature disabled / HTTP 404 or 503 | Keep the local prepared record, report pending; do not switch servers or enable infrastructure. |
| HTTP 401/403 | Resolve the current account with `paean-zero-setup`; do not request pasted credentials. |
| Upload expired, timeout, staging failure | Repeat `submit` with the same prepared bytes/source key. Do not rerun the public publish just to retry backup. |
| Backup ready, link failed | Keep `assetId`; check ownership and call `bind` for the exact app. |
| Bind HTTP 409 | Inspect the app's release: apps predating this feature need an authorized republish to record a release. A newer app version also needs rebinding. |
| Public evidence is `none` or a different release | Do not claim a visible label; verify listed status/current release and bind again when appropriate. |

Private backup and platform contributions are separate. This helper never calls
`/share-offer` or `/contributions` and never sets `accepted: true`. Sharing with Paean for research,
evaluation or service improvement requires the user to review the exact stored file and the
server's current consent text/offer and explicitly opt in. Model training requires separate consent.
Standard sharing credits and discretionary administrator rewards are not traffic guarantees and
are not awarded merely by uploading/linking. The session endpoint reports `linked` assurance. Originality certification and traffic support
are handled by independent systems consuming the same data source, as specified by the platform
owner; their absence from Zero API is expected. Submission supplies those workflows, but this
helper cannot confirm their final review or allocation results from the linkage response.
