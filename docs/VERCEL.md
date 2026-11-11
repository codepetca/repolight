# Vercel hosting

The on-demand analysis worker is prepared in source. Production activation and
hosted acceptance are separate. The Vercel configuration replaces the analysis
Daemon with private Node.js Functions in `iad1`. The local CLI and Docker/Compose
worker remain available. The collector, database admission, job ordering, fenced
leases, retries, snapshot pinning and erasure contracts are unchanged. This
worker change adds no database migration or AI dependency.

## On-demand execution

1. An authenticated create commits a new job in PostgreSQL and returns 202. A
   Next.js `after()` callback publishes a wake to the deployment's
   `repolight-analysis-wake-v1` queue after the response. An exact replay returns
   the existing job status. Scheduled recovery picks up the committed job if
   the publish fails. Wakes contain only `{"version":1}`.
   Their short time buckets coalesce deliveries and contain no job or customer data.
2. Each private queue invocation runs at most one attempt through the existing
   database claim. Job ordering and one-per-workspace/two-global limits are
   still enforced in the database. With pending work, the invocation publishes
   another wake from the earliest stored retry or lease expiry; if the claim
   found nothing ready, it waits at least 15 seconds before the next wake. An
   empty queue stops the chain. Delivery failures are retried by Vercel; they do
   not alter the database attempt limit.
3. The private hourly `repolight-analysis-recovery` Schedule invokes a worker
   directly on the active deployment, repairing missed publishes, expired
   leases and wakes lost with an older deployment. If the queue itself is
   unavailable, that run can still process one attempt. The next scheduled run
   can recover further work. On Hobby, the usual recovery window is up to
   about 75 minutes, allowing for scheduling jitter; outages or skipped runs
   may take longer. The existing 24-hour job deadline still applies.

The two routes require Vercel system variables and
`REPOLIGHT_ON_DEMAND_WORKER_ENABLED=true`. Until those settings are available,
Vercel builds return `503 service_not_configured` for new submissions. An
authenticated exact retry can still recover an already accepted job.
Vercel's private function routing is
the authority boundary; never add public routes or rewrites to these functions.
Vercel Queues uses project-scoped OIDC and pins wake messages to their publisher
deployment. No new long-lived queue credential is needed. Function execution
is capped at 210 seconds to fit the 150-second worker attempt and 120-second
GitHub collection budgets. The 90-second database lease renews during collection.
The Queue SDK's visibility timeout is 240 seconds, distinct from database fencing.
See [Queues](https://vercel.com/docs/queues),
[Schedules](https://vercel.com/docs/schedules) and
[Fluid Functions limits](https://vercel.com/docs/functions/limitations).

## Release and acceptance

Use Node 22.23.4, pinned dependencies via `npm ci`, and Vercel CLI 65.14.0.
After `vercel build`, run `node scripts/verify-vercel-worker-build.mjs` to
check the two private triggers, function budgets, hourly schedule and absence
of any daemon or explicit public route to the worker functions.
Use an isolated Vercel preview with its own PostgreSQL and GitHub credentials.
Confirm Queues, Schedules, Fluid Compute and Vercel system variables/OIDC are
available and set `REPOLIGHT_ON_DEMAND_WORKER_ENABLED=true` on that preview.
Verify unauthenticated HTTP cannot invoke either internal function or its
emitted `.rsc` alias, including with forged event headers. Confirm a real
post-response wake, job completion, and erasure with synthetic data. This
exercises network access from the functions to Neon and GitHub.

Preview schedules start inactive. Run the preview schedule on demand to verify
recovery from a missed wake. If testing its cadence, enable it for a short
window and disable it at the end. Production schedules start active. Set the
worker flag and confirm the static recovery schedule is active on the
production candidate at cutover. Smoke test an authenticated new analysis after
promotion. Disable the schedule itself if taking recovery offline because a
schedule run counts toward quota even if the function declines to process it.
Leave AI and Pika provider/entitlement controls on their separate approval paths.

Inspect the current project's daemon state at cutover; keep any old instance at
zero. A rollback to an older daemon-based build can restore its daemon settings,
so verify the zero-instance state before serving that build. PostgreSQL retains
jobs across rollback and redeploy. Queues can still deliver unexpired wakes to
the deployment that published them. Its original flag and database access
remain in effect and its worker can claim shared jobs. When the goal is to stop
processing, disable the active schedule and verify old worker invocations have
ceased. If needed, run the existing one-attempt CLI against the approved target
as a bounded recovery action.

There is no five-second idle poll on Vercel. One hourly sweep yields at most 744
scheduled invocations in a 31-day month, within the documented
[Hobby Schedules allowance](https://vercel.com/docs/schedules/limits) in isolation.
It still wakes Neon once per sweep: at a five-minute autosuspend window that
would be about 62 active hours before report traffic, or about 15.5 CU-hours at
0.25 CU. Monitor actual Neon compute, Vercel Functions use, and
[Queue operations](https://vercel.com/docs/queues/pricing) after activation;
shared team usage and provider limits determine the actual cost and availability.

## Historical daemon pilot

The October pilot ran one 1 GiB Daemon in `iad1`. CLI 65.2.0 emitted its
Linux amd64 worker bundle; the older CLI 54.17.2 had omitted daemon output.
The live status and resource settings below describe that pilot at the recorded
date, not the new on-demand worker.

## Prepared resources — 2026-10-25

- Vercel team: `stewarts-projects-cc2722c4`; project `repolight`
  (`prj_O05gBFnJpL6s2JKcLGhqs8G2g81a`), Next.js and Node 22.x.
- Reserved application origin: `https://repolight.vercel.app`.
- Dedicated Neon Free resource `repolight-db` (`store_3qMDcoEZSY24urVr`),
  Neon project `long-boat-34609339`, region `iad1`, database `neondb`.
- Database connection is limited to this Vercel project's production environment.
  Neon Auth and Realtime are disabled; RepoLight keeps its existing authentication.
- `SESSION_SECRET` is stored as a sensitive production variable, `APP_ORIGIN`
  names the exact origin, and `REPOLIGHT_AI_ENABLED=false`. No provider key or
  GitHub App was configured. Do not copy these credentials into Git or previews.

## Activation verified — 2026-10-25

The human approved applying the six existing migrations to this exact dedicated
Neon target. Migrations `0000`–`0005` applied through the existing Drizzle journal;
all six ledger hashes match the frozen manifest. There are 19 application tables.
Service tables have RLS enabled, no public policies, and service functions expose
no PUBLIC execution grants. No Pika schema was changed.

Vercel production deployment `dpl_FaaepPvXtb9sSguYiCDzoAQdH6ys` is READY and aliased
to `https://repolight.vercel.app`. Its recorded Git SHA is reviewed
`a08cce3581c22a4aff68899add3bfecd2459abdf` on local branch `codex/vercel-pilot`.
Hosting [PR#10](https://github.com/codepetca/repolight/pull/10) merged at
`1156fc87d847e35ee8af8d9284012990d24c7e1b`. Its runtime files are identical to the
deployed source; later changes only record verification. Vercel rejected the Git
connection with 409 because its Hobby plan does not support private organization
repositories. The project remains unconnected and deployments remain manual. No
plan, billing or repository visibility change was made.

Actual hosted synthetic verification passed:

- Password sign-in, secure sessions, workspace initialization and installation-bound
  keys; unauthenticated access and key management/edit attempts are rejected.
- Public GitHub analysis completed on its first attempt. Malformed usernames show
  all contributors with a notice; a separate blank-username run did the same.
- The browser opened the saved report summary, metrics, limitations and feedback.
  Owner edits persisted separately; stale edit revisions were rejected.
- A worker restart was requested, then an explicit zero-instance stop and return
  to the configured one instance was observed. A new instance processed a job
  queued while stopped; the previous report and edited feedback were unchanged.
- Scoped erasure removed both synthetic reports; receipt replay was stable,
  recreation returned 410, and the temporary key was revoked and rejected.
- Zero AI admissions occurred. Paid AI remains off. The live worker is restored
  to the configured one instance with no scaling override.

Private checksummed evidence is retained by the coordinator. No credentials,
synthetic passwords, private cookies or generated report bundles belong in Git.

## October integration boundary (historical)

Pika's reviewed report/feedback code is now deployed through
[PR#1687](https://github.com/codepetca/pika/pull/1687) at
`dbd1f62c12b3be8f359d6c35fde77a27d7f77987`, with exact-SHA Vercel READY and all ten
CI40222687057 jobs passed. Separate human approval covered production migration
293 and its coordinated schema/app window. [Run40226843818](https://github.com/codepetca/pika/actions/runs/40226843818)
applied only293 and verified the approved digest/history001–293. Direct installed
catalog, RLS/ACL, function-preservation, trigger and archive checks passed. The
public sign-in page and anonymous API boundaries passed; existing cohort/provider
controls were unchanged. Shared local was untouched and the window is closed.

Analyze remains OFF in Pika's server configuration and database setting; optional
RepoLight AI remains OFF. Teacher/workspace/installation key binding and an
authenticated hosted Pika → RepoLight pilot remain required. The Pika integration
guide and receipt PR#1689 record the known standalone archive-inventory diagnostic
limitation; it was not reported passing. Preserve separate cohort/provider holds.
