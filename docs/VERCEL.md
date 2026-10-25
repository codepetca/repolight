# Vercel hosted pilot

Vercel serves the Next.js application and runs the existing analysis worker as a
Daemon. The collector, database queue, admission limits, fenced leases, retries,
snapshot pinning and erasure contracts are unchanged. No cron or AI is required.

`vercel.json` declares one 1 GiB worker in `iad1`. Its dedicated
`Dockerfile.vercel-worker` builds the existing bundled worker for Linux amd64 and
runs it as the non-root `node` user. The original Dockerfile/Compose targets are
unchanged. The default-deny Docker context excludes private files and credentials.

Daemons are currently a Vercel public beta and run only in production deployments;
preview deployment success does not prove worker operation. They can stop during
rollouts. The existing SIGTERM handler aborts collection, and database fencing and
expiry recovery protect interrupted work. Local `vercel dev` does not run daemons.
See the [daemon guide](https://vercel.com/docs/daemons),
[configuration](https://vercel.com/docs/daemons/config-reference) and
[limits](https://vercel.com/docs/daemons/limits).

Use the task-pinned Vercel CLI 65.2.0 for builds and deployment. The older installed
CLI 54.17.2 omitted daemon output; 65.2.0 successfully builds the Next.js app and
emits `daemons.analysis-worker` plus its `.vc-config.json` in the Build Output API
artifact. The daemon image was built for Linux amd64 and uploaded to this Vercel
team's container registry during build. Building does not start worker instances.
Hosted startup and smoke checks below verify the runtime. The
explicit `npm ci` install preserves the pinned lockfile.

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

## Next integration boundary

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

The worker currently polls PostgreSQL every five seconds while idle. This keeps
Neon compute active, so the Free database allowance should not be treated as a
guarantee of free continuous operation. Vercel daemon compute/memory usage also
depends on the team's plan. Monitor the pilot and stop its worker when not in use;
an event-driven worker can be evaluated before broader rollout.
