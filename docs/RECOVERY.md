# Repocat recovery — 2026-10-21

## Scope

Recovered the existing project locally and added the report contract. User requested public repositories only; GitHub App work is deferred. No hosted database, deployment, Pika change, live AI call or external write was performed. The existing v1 behavior is preserved.

Source baseline: `626d7e9da7702bcd791ebb59f947937293907b0a`.

## Reuse and repairs

- Reused the current Next.js App Router UI/API, Neon/Drizzle persistence design, normalized TypeScript engine events, public GitHub collector and existing tests.
- `npm ci` initially failed under npm 10 and npm 11 because the committed lockfile omitted optional `@emnapi` core/runtime entries and contained an incompatible wasi-threads entry. Repaired lock metadata and retained the original resolved direct versions.
- Pinned direct dependency declarations to the existing lock resolutions, including previous `latest` declarations; this is not a dependency upgrade.
- Added `typecheck` and offline `report:sample` commands.
- Added the strict v2 schema/builder with synthetic report tests. It does not call the legacy grade calculation.

The baseline worker verified npm ci, all 43 original tests across 12 files, lint, TypeScript and a production build on macOS, Node 22.21.1. Its focused follow-up verified the pinned manifest against the same lock resolutions and clean-install consistency. The combined change has 56 passing tests across 13 files, plus lint, typecheck and production-build verification. The offline sample emits the expected metrics and schema-valid evidence. A production server bound only to 127.0.0.1 returned HTTP 200 for the existing login page using an ephemeral random session secret; this does not verify database-backed sign-in.

A read-only live smoke test of the existing collector fetched five non-merge commits and file evidence from the public `codepetca/zero-drawing-pad` repo for October 1–22. It used no GitHub App or new token. This checks live public transport, not complete pagination/snapshot guarantees for the new report.

## Existing issues before public hosting

1. Dependency audit reports 21 affected packages at recovery time: one critical, twelve high, seven moderate and one low. The direct Next 14.2.35 package is critical; runtime and development dependency advisories need a scoped upgrade pass and regression verification before exposure. Counts may change as advisories change; re-run the audit before release. Do not run an automatic force/major upgrade as a substitute for compatibility work.
2. `src/lib/auth/session.ts` uses a fixed fallback password when SESSION_SECRET is absent/short, including production. Production must fail closed with valid secret configuration before hosting. Local smoke processes should use a fresh random secret.
3. API credentials currently resolve to a shared service user; they are not a multi-customer isolation boundary.
4. Legacy collection is capped, can omit file-detail pages, reads a branch rather than freezing a report snapshot, and uses broad merge filtering. The new contract must not turn those limits into a false completeness claim.
5. Legacy webhook push timing is based on head-commit metadata. The v2 contract avoids using it; corrected observed-event semantics are later work.

## Untested or unavailable

No DATABASE_URL/.env.local was configured. Registration, authenticated saved-run CRUD, migrations, DB-backed e2e, deployed status and backup/restore were not verified. The build does not need a database because the client initializes lazily on data access. No claims are made about Windows/Linux or novice classroom trials.

## GitHub App decision

A GitHub App is unnecessary for this phase's public-repository history analysis. Anonymous GitHub REST requests allow public reads with a low shared-IP budget; the existing optional server token can raise the budget without changing the report contract. No token was configured or reused for the smoke test.

Beyond private repositories, an App can supply centralized forward-looking push webhooks, selected-repo permissions, installation-scoped short-lived credentials and rate limits that scale with installations. These are useful for later SaaS operation and push-cadence observations, not prerequisites for the current metrics. A manually configured webhook is another way to collect future push observations; neither approach recreates past pushes.

Primary references checked 2026-10-21:

- [GitHub App versus other options](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app)
- [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## Coordination receipt

One GPT-6.1 Sol/medium worker handled baseline installation/checks and a focused pinning follow-up, owning package/config files. Coordinator owned the report module, fixtures/tests and docs. The coordinator independently exercised the sample and live public transport. Effective model telemetry, per-worker tokens and attributable cost are unknown; no package/source ownership conflicts occurred. Independent behavioral review and final combined checks are recorded with their actual outcomes before handoff.

Ignored local evidence: `.verification/recovery/baseline.json`, dependency audit summary and clean-install receipts. Generated reports and logs belong there rather than in Git.
