# Saved reports service

The authenticated `/workspace/reports` screen and `/api/v2/analyses` use the same contributor bundle as the local preview. A report is an immutable collection of facts and generated rule feedback. Teacher edits are separate revisioned records. No AI provider or GitHub App is required.

## Runtime and storage

The Vercel pilot configuration and exact prepared resource/migration boundary are
documented in [VERCEL.md](VERCEL.md). Hosted activation remains separate from a
successful local build.

The Vercel configuration uses the private on-demand worker described in
[VERCEL.md](VERCEL.md), which also records its activation status. For local or
self-managed hosting, use Node 22.23.4, `npm ci`, `npm run build` and
`npm run build:worker`. Run the web application and a separate
`npm run service:worker -- --poll` process. `--once` processes at most one eligible
job. An idle poll waits five seconds; SIGTERM/SIGINT abort collection and fenced
leases permit recovery. Worker output is a generic outcome, never repository
content or credentials.

The web process needs `DATABASE_URL`, a randomly generated `SESSION_SECRET` with at least 32 non-padding characters, and production `APP_ORIGIN` set to the exact external origin. Terminate HTTPS at the hosting platform. The worker needs `DATABASE_URL`. For authenticated public collection, set `REPOLIGHT_GITHUB_APP_ID`, `REPOLIGHT_GITHUB_APP_INSTALLATION_ID` and `REPOLIGHT_GITHUB_APP_PRIVATE_KEY` together on the worker; the private key may use literal `\n` escapes. The worker obtains a fresh installation token for each attempt. Partial or invalid App configuration fails closed rather than silently using anonymous requests. With no App settings, the existing optional `GITHUB_TOKEN` (and legacy aliases) remains supported; App settings take precedence. Collection still verifies that each repository is public. Use a minimally scoped App, protect its private key as a runtime secret, and rotate it if exposed. Never use the legacy shared v1 service user/key as a v2 customer identity. Builds require no database or session credentials.

`Dockerfile` supplies independent non-root `web` and `worker` targets using Node 22.23.4. `compose.yaml` wires both processes with runtime configuration and loopback web publishing; it does not supply HTTPS or apply migrations. Build with `docker build --target web -t repolight-web:local .` and the corresponding worker target, then start configured services with `docker compose up`. Docker context is default-deny and excludes environment files, `.verification`, logs and generated artifacts. Both Linux images were built and their non-root/context exclusion checks passed locally; web sign-in and unauthenticated API behavior were smoke-tested. Production Neon execution by the Linux worker and hosted deployment remain unverified.

Apply migrations 0000–0005 only to an explicitly intended, authorized database. The additive `0003_service_reports.sql` creates five `rl_*` tables, constraints, immutable-fact triggers and atomic queue/edit functions. RLS is enabled without public policies and function execution is revoked from PUBLIC; the trusted server database role owns these operations. Browser clients must never receive a database credential. Tenant predicates and authenticated principals are enforced by server code, not by trusting a client workspace ID. A separate least-privilege deployment role requires explicit grants and deployment validation; these files do not create or rotate external accounts.

Local verification can use a deliberately disposable PostgreSQL fixture through the explicit development-only Neon HTTP proxy. `REPOLIGHT_LOCAL_NEON_HTTP_URL` is rejected in production, accepts only literal loopback `/sql`, and requires the exact disposable database target enforced in `src/db/neon-transport.ts`. `scripts/dev-neon-proxy.ts` additionally requires the matching private `REPOLIGHT_LOCAL_NEON_DATABASE_URL`. Do not put either setting in deployment configuration. No proxy or worker command automatically migrates a database.

## Authentication and contract 1.0

All JSON envelopes use `schemaVersion: "1.0"`; executable schemas live in `src/lib/service/contract.ts`. Requests/responses are bounded and errors expose `{error:{code}}`. Responses use `Cache-Control: no-store`. Cookie mutations require the configured same origin; keys use Bearer authentication and never a session cookie at the same time.

| Operation | Behavior |
| --- | --- |
| `GET /api/v2/workspace` | Current session owner's workspace; no implicit write. |
| `POST /api/v2/workspace` with `{}` | Explicitly initialize the owner's workspace. |
| `POST /api/v2/analyses` | Body `{schemaVersion:"1.0",request,clientBinding?}` plus `Idempotency-Key`; returns 202 with `AnalysisStatus`. |
| `GET /api/v2/analyses` | Latest 50 authorized statuses in `{analyses}`. |
| `GET /api/v2/analyses/{id}` | Status, fingerprint, optional client binding, attempt count and safe error code. |
| `GET /api/v2/analyses/{id}/result` | Completed immutable `AnalysisResult`; pending returns 409. |
| `GET /api/v2/analyses/{id}/edits` | Session-owned `{edits}`. |
| `PUT /api/v2/analyses/{id}/edits` | `{scopeKey,expectedRevision,text}`; optimistic conflict returns 409 and preserves local edits. `null` restores generated feedback. |
| `GET/POST /api/v2/workspace/keys` | Session-only metadata/list or issue a key; secret returned only at creation. |
| `DELETE /api/v2/workspace/keys/{id}` with `{}` | Session-only revocation. |

The request contains the public repository URL, optional username, branch, explicit period/timezone, optional schedule, baseline and exclusions defined by the bundle contract. Blank/unmatched/malformed usernames retain repository-wide evidence and a selection notice. RepoLight never substitutes repository ownership as student identity.

`AnalysisResult` includes `analysisId`, `requestFingerprint`, `clientBinding`, `reportRef`, canonical SHA256 `reportDigest` and `bundle`; all three report references must agree. A client must validate the returned fingerprint, binding and references against its stored request before accepting a result. `clientBinding` consists only of opaque `installationRef`, `subjectRef` and `sourceRevisionRef`. It is not permission to select a customer workspace.

Integration keys have `analyses:create` and/or `analyses:read` scope. New keys may explicitly opt into `analyses:erase` for Pika cleanup, requiring an installation binding; existing keys keep their permissions. Their workspace is fixed at issuance. An optional installation binding is also fixed: create must match it, and reads/lists reveal only that installation's jobs. Keys cannot edit feedback or manage credentials. Raw keys are never stored; only their SHA256 secret hashes are persisted and comparisons use constant-time verification. The UI reveals a new key temporarily and hides it on close. Keep the copied credential in the consuming service's server secret store.

## Queue and evidence guarantees

Default limits are 20 admissions per workspace per UTC day, five queued jobs per workspace, one running job per workspace, two running globally, three attempts and a 24-hour job lifetime. Replaying the same workspace idempotency key and canonical request returns the original job; changing its request returns conflict. These limits are enforced atomically in PostgreSQL, including concurrent requests/claims.

Claims carry a token, generation and expiry. Every worker mutation is fenced; heartbeat failure aborts collection. Expired claims recover within attempt/deadline limits. Revoked/expired creation keys prevent new claims and completion. A worker pins the first public branch SHA before fetching history and reuses it on retry, preserving snapshot provenance even if the branch advances. Collection has request/byte/time budgets and safe upstream error codes. Reports exceeding 8,000,000 serialized bytes fail rather than returning a truncated valid-looking result.

Metrics describe collected commit evidence, not push times, time spent, learning, account ownership or AI authorship. Missing baseline/history/files/identity remain explicit limitations. Bot and unknown-author labels are retained. GitHub permissions or transient upstream failure can yield failure or disclosed partial coverage according to collector policy; they never establish zero work.

## Operating boundaries

Jobs, snapshots, reports and edits persist across web/worker restarts. Back up the configured database and establish an explicit retention/deletion policy before public hosting. Deleting an owner cascades the new workspace records; this is not an exposed account-deletion feature. Key revocation does not delete historical reports. Do not log credentials, private commit emails, full source or teacher feedback. Monitor safe job states/error codes and worker availability.

Pika integration, optional AI and actual hosting are separate milestones. This service does not change Pika grades, comments or Return and does not imply that any deployment or hosted migration has occurred.


## Pika connection and erasure extension

The additive migration `0004_subject_erasures.sql` adds a sixth, private-by-default `rl_subject_erasures` table and expands allowed key scopes without modifying existing credentials. `GET /api/v2/connection` authenticates the current session or key and returns exactly `{schemaVersion:"1.0",workspaceRef,installationRef,scopes}`. `workspaceRef` is the opaque customer reference, never an owner identifier. Consumers must verify this reference, installation and required permissions against their saved server configuration before sending or accepting report data.

`POST /api/v2/erasures` accepts exactly `{schemaVersion:"1.0",operationRef,installationRef,subjectRef}`. The operation reference is a UUID; the other refs are bounded opaque strings. Cookie owners require same-origin authorization. Integration keys require `analyses:erase` and an exact installation match; their workspace comes only from the credential. The key screen offers this permission as an explicit, default-off Pika cleanup option. Keys cannot edit teacher feedback.

A successful 200 response echoes those references with `status:"erased"` and `absenceVerified:true`. It confirms that all matching queued/running/failed/completed jobs and their reports/edits were deleted in one serialized transaction. A permanent subject tombstone rejects future create requests with 410 `subject_erased`; deleted worker leases cannot recreate state. Persist the subject and operation before the first create request so cleanup also covers an uncertain create response with no known analysis ID. Exact erasure retries return the same receipt. Reusing an operation for another target, or another operation for the same erased subject, returns conflict. A timeout, 404 or 202 is not absence proof. Each new enrollment/submission generation needs a fresh subject reference.

Only task-created synthetic local records were erased during verification. This endpoint does not erase database backups, other installations, an entire user account or arbitrary public GitHub history. Pika must retain its cleanup binding until it validates and records the exact receipt. Key rotation can preserve cleanup only with a valid credential for the same workspace and installation. Never discard the last cleanup credential while live subjects remain.

## Optional interpretation

A separately stored owner-session-only interpretation layer is described in [AI-INTERPRETATION.md](AI-INTERPRETATION.md). It is disabled by default and does not change the v2 bundle, service-key scopes, original rule feedback or Pika contract. Apply its additive migration only through the approved target-specific procedure. Existing reports remain usable without provider configuration.

## Installation-managed provisioning (local implementation)

A separately authenticated control endpoint creates an ownerless workspace and one key per opaque Pika teacher tenant, without a RepoLight login. This requires additive migration `0006_managed_provisioning.sql`; migration and deployment need explicit target-specific authorization. Provisioning does not configure or enable AI, which remains owner-session-only and separately controlled.

Configure `REPOLIGHT_CONTROL_INSTALLATION_REF` as a 1–128 character opaque reference using letters, digits, `.`, `_`, `~`, or `-`. Configure `REPOLIGHT_CONTROL_SECRET` as an independent, randomly generated 32-byte base64url secret (43 characters). This credential grants provisioning for that entire installation: keep it server-side, distinct from session and analysis keys, and use HTTPS. The service currently supports one configured installation per deployment. Missing or malformed configuration fails closed; requests with cookies are rejected.

`POST /api/v2/managed/provision` requires `Authorization: Bearer <control secret>` and JSON `{ "schemaVersion": "1.0", "tenantRef": "<opaque>", "operationRef": "<uuid>", "keyId": "<uuid>", "secretHash": "<sha256 hex>" }`. References use the character constraints above; UUIDs are canonical lowercase, and the digest is 64 lowercase hex characters. Before calling, Pika generates and durably stores both a UUID key ID and a random 32-byte base64url analysis secret, then supplies the SHA-256 digest of the secret's UTF-8 text. Never send the plaintext analysis secret to this endpoint. The resulting analysis bearer token is `rl_v2_<keyId>.<secret>`. Requests cannot choose scopes: the key has create, read and erase, bound to the configured installation.

Creation returns 201 and an exact retry returns 200, each with `{ "schemaVersion": "1.0", "workspaceRef": "<opaque>", "installationRef": "<configured ref>", "keyId": "<uuid>" }`. A changed request for an existing tenant, reused operation within an installation, or reused key ID returns 409 `operation_conflict`. Retry every field exactly after timeouts; the transaction serializes competing requests. Different installation/tenant pairs get separate workspaces. A replay does not revive a revoked key. Tenant deletion is not implemented by this endpoint.

The provision row retains the opaque tenant binding, operation, key ID and hash and restricts deletion of its key and workspace to prevent silent recreation or broken retries. Subject erasure continues to use the existing API. A future explicit tenant retirement procedure must coordinate key revocation, queued work, data erasure and provision-record retention/removal; do not delete managed rows ad hoc. The installation credential can be rotated through configuration without changing existing workspaces, but changing the installation reference creates a different namespace. Local tests do not establish hosted readiness.

`POST /api/v2/managed/rotate` uses the same control authentication and body, plus `expectedKeyId` (canonical lowercase UUID). Generate and persist the new key ID, secret, hash and operation before calling. The transaction checks the expected current key, revokes it and issues the replacement in the same workspace with the same scopes and installation binding. Existing reports and subject-erasure receipts remain accessible through the replacement. Work queued or running under the revoked key can fail; recovery must handle that outcome. A 409 means a stale current key or conflicting/reused operation or key. Exact retries return the original receipt; a replay never revives a key and can describe an already-superseded rotation. Before activating a recovered credential, call `/api/v2/connection` with it and verify workspace, installation and scopes. The Pika client must serialize rotations and retain each prior recovery/cleanup reference; this API does not enforce Pika teacher entitlement or cleanup-only access.

The migration revokes PUBLIC privileges from both managed tables and functions, and both functions use a fixed catalog-only search path. The runtime database role needs explicitly granted table and function privileges if it is not the object owner and must have an appropriate RLS policy or bypass as required by the service deployment. Do not grant these privileges to untrusted database roles.
