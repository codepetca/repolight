# Local development

## Checkout and dependencies

Use the pinned Node 22-compatible dependency set and npm lockfile. Recovery was verified on macOS with Node 22.21.1 and npm 10.9.4. `packageManager` records the original npm 11.6.2 preference; both npm 10 and npm 11 exposed the original lockfile defect before repair.

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run report:sample --silent
```

`report:sample` emits a fictional, schema-validated v2 report to stdout. It requires no database, GitHub token, GitHub App or AI provider. Store generated reports under ignored `.verification/` if saving them.

The Next app builds without database credentials. Database-backed registration, sign-in and saved-run operations require a deliberately configured `DATABASE_URL` and the existing migrations. No database was provisioned/migrated during recovery. Never point development or tests at an unknown hosted database.

For an app smoke check, run `npm run dev -- --hostname 127.0.0.1 --port 3047` with a randomly generated `SESSION_SECRET` in the process environment. Keep local secrets outside Git. Login-page rendering does not establish that authentication/database workflows work.

The standalone `/reports` page and its fictional demo work without a database. Live public collection uses the development/loopback-only `POST /api/reports/analyze` route. Production builds display the report UI/demo but reject live collection. See `PUBLIC-REPORTS.md`; do not relax this gate as a substitute for hosted authentication, usage controls and the existing deployment blockers.

## Branch ownership

Keep the hub `/Users/stew/Repos/repocat` on main. New implementation branches use a worktree under `/Users/stew/.codex/worktrees/repocat/<branch-slug>`, based on the intended remote revision. Inspect existing worktrees and preserve active/uncommitted work before creating or retiring one. Do not switch another writer's checkout or share staging/commit operations concurrently.

There is no canonical shared Repocat environment file configured. Create a private worktree-local `.env.local` only when needed and with a known local/test target; never copy credentials from an unrelated project. Install dependencies in each worktree rather than symlinking node_modules.

Before handoff: run checks appropriate to the change, `git diff --check`, inspect the intended diff and report untested flows. Independent review should inspect a stable local revision for behavioral/contract changes. Publication and merge require user authorization; this repository has no standing deployment or hosted-migration authority.

## Test strategy

- Existing `tests/engine`, `tests/classroom` and component tests protect v1 behavior.
- `tests/report` covers v2 measured facts, missing data, identity/exclusion boundaries and interpretation citations.
- `fixtures/reports/sky-hop.ts` is synthetic. Keep real student identities/source out of fixtures.
- `e2e/run-flow.spec.ts` needs a configured disposable database and credentials; it was not run during recovery. Review its fixed-port/reuseExistingServer settings before use so it cannot attach to an unrelated local app.
- The production build and dependency audit are separate checks; a passing build does not establish safe public hosting. See `RECOVERY.md`.
