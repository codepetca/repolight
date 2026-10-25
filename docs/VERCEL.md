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
Actual hosted daemon startup remains a required production smoke check. The
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

Read-only inspection verified no application tables or migration ledger exist in
the new target. No hosted migration or deployment has occurred at this checkpoint.

## Activation sequence

1. Obtain exact-target approval for the unchanged committed Drizzle migrations
   `0000_curly_hellion.sql`, `0001_external-run-identifiers.sql`,
   `0002_living_forge.sql`, `0003_service_reports.sql`,
   `0004_subject_erasures.sql` and `0005_optional_interpretation.sql` on the
   dedicated database above. Verify the frozen SHA-256 manifest before execution.
   Never migrate during application/container builds or point this run at Pika.
2. Apply through the existing Drizzle journal; verify all six entries and the
   resulting table/function/permission contracts. Optional AI remains disabled.
3. Deploy the reviewed web application and daemon to the prepared Vercel project.
   Verify sign-in, public-repository analysis, saved reports across worker restart,
   installation-scoped authentication and erasure using synthetic pilot records.
4. Keep Pika's production gate off until its separate exact-target migration 293,
   reviewed feedback-import fix, scoped credential binding and authenticated
   hosted integration checks are complete.

The worker currently polls PostgreSQL every five seconds while idle. This keeps
Neon compute active, so the Free database allowance should not be treated as a
guarantee of free continuous operation. Vercel daemon compute/memory usage also
depends on the team's plan. Monitor the pilot and stop its worker when not in use;
an event-driven worker can be evaluated before broader rollout.
