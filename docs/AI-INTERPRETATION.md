# Optional AI interpretation

Status: implemented locally; disabled by default. Live provider behavior, paid activation and hosted deployment are not verified or authorized by this implementation.

Deterministic metrics, rule feedback, graphs and teacher edits work without AI. Interpretation is a separately persisted, read-only sidecar for one completed saved report and one repository/contributor scope. It does not replace facts, change the report digest, edit feedback or modify Pika's report/import contract. There is no AI-authorship score, automatic grade or misconduct verdict. A citation establishes which measured fact was supplied, not that generated prose is accurate.

## Operator configuration

Apply migration `drizzle/0005_optional_interpretation.sql` through the normal approved migration procedure before deploying this version. Do not apply it to an unknown or shared database without the relevant authority.

- `REPOLIGHT_AI_ENABLED=false` is the default. Only the exact string `true` enables generation.
- `REPOLIGHT_AI_MODEL` must be an explicit operator-selected Responses-compatible model supporting structured output; there is no default or fallback model.
- `REPOLIGHT_OPENAI_API_KEY` is a dedicated server-only key. The adapter does not reuse `OPENAI_API_KEY` or expose the key to clients.

Activation requires both usable configuration and an explicit owner-session request. Existing Pika service keys cannot request paid interpretation. Configuration must be set privately by an authorized operator; do not commit keys or enable paid calls for verification. Disabling generation keeps already saved interpretations readable.

## HTTP and UI behavior

`GET /api/v2/analyses/:id/interpretation?scopeKey=repository` reads the latest interpretation in the authenticated owner's workspace. It does no provider HTTP or database mutation. Contributor scopes use `contributor:<contributor-id>` and must exist in that saved report.

`POST` to the same route accepts only `{schemaVersion:"1.0", requestId:"<UUID>", scopeKey:"repository"}`. It requires an owner session and the service's same-origin mutation protection. The model/provider cannot be supplied by the caller. A UUID is an idempotency key within the workspace: once reserved, retrying it cannot invoke the provider again; changing its report or scope returns a conflict. Explicit regeneration uses a new UUID. Disabled/missing configuration creates no reservation and returns no request UUID.

The saved-report panel is collapsed and optional. When disabled with no saved result it is hidden. Generation requires an explicit button click; opening a report never generates interpretation. Uncertain network retries preserve their UUID. Pending reads use bounded backoff; changing report/scope aborts and ignores late responses. Generated text is rendered as escaped plain text with locally resolved citations and provenance. Existing feedback remains separately editable.

## Evidence and provider boundary

The provider receives only measured numbers, coverage/baseline enums and fixed citation labels: commit count, density, scheduled-day coverage, busiest-day share, active/undated dates, generic-message share and longest scheduled gap. Raw repository content, commit messages, file paths, repository URLs, usernames/emails, Pika/customer identifiers and private teacher edits are excluded. Numeric patterns can still be distinctive; this is data minimization rather than a guarantee of anonymity.

Requests use the fixed HTTPS OpenAI Responses endpoint, strict structured output via `text.format`, `store:false`, `background:false`, no tools and no automatic retry. Limits: 16KiB serialized request, 65,536-byte HTTP response, 32KiB stored sidecar, 1,500 output tokens and a hard 20-second deadline. Refusal, incomplete responses, unknown citations, invalid output or provider errors become a failed sidecar. No fallback changes deterministic results. Output is limited to five cited observations; local validation rejects obvious unsupported authorship, grading, effort, attendance and push-time claims. Teacher review remains necessary.

OpenAI's [structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs) describes the Responses format and refusal/incomplete handling. `store:false` is not a zero-retention guarantee: provider processing, abuse monitoring and other account controls have separate rules. Consult OpenAI's [data-control documentation](https://developers.openai.com/api/docs/guides/your-data) before activation. RepoLight erasure cannot itself erase provider-side records or promise their retention period.

## Admission, expiry and erasure

Atomic database admission limits each workspace to 10 new requests per rolling 24 hours and one live generation. Across the service, the limits are 100 per rolling 24 hours and two live generations. Failed requests count. These are request limits, not a financial budget; model pricing and per-request cost remain operator responsibilities. A request leases its row for 60 seconds; fenced completion prevents expired or erased work from being saved. GETs do not recover or renew leases. POST recovers only its own workspace's expired rows.

Subject/job erasure cascades pending, failed and completed sidecars. A late provider completion cannot recreate an erased report. The separate admission ledger contains only a random UUID, nullable workspace reference and timestamp. Deleting reports cannot reset quotas; deleting a workspace nulls that reference while preserving the global count. Entries older than 24 hours are pruned during a later admission, not by a scheduled expiry. This ledger carries no report, subject or request reference.

## Verification boundary

Unit/component tests cover disabled and failed paths, owner/key separation, tenancy, input minimization, malicious source exclusion, strict output/citations, hard timeout, idempotency, scope changes and draft preservation. Six native PostgreSQL cases verify concurrent reservations, workspace/global limits, expiry, cross-workspace denial, erasure fencing and completion/erasure serialization. Provider verification uses a private process-local HTTP mock; it does not establish live model compatibility, quality, latency, pricing or account retention configuration.
