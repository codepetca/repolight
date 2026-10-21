# Repocat — 2026-10-21

Recovered from main `626d7e9da7702bcd791ebb59f947937293907b0a`.

User authorized recovery and report-contract definition; public repos only. GitHub App setup is deferred. Standalone report UI, live AI, durable jobs, SaaS tenant isolation and the Pika integration are subsequent phases in `docs/REVIVAL-PLAN.md`.

Current work reuses Next.js/Neon/Drizzle and existing v1 normalized events/API. A lockfile repair restores missing optional native dependencies; direct versions are pinned to the existing lock resolutions. The new pure `src/lib/report` module provides a strict v2 report schema and deterministic builder, plus a fictional Sky Hop fixture and offline `npm run report:sample` command. No v2 HTTP route or database migration is introduced.

Read `docs/RECOVERY.md` for verified checks, existing deployment blockers and runtime limits. `docs/REPORT-CONTRACT.md` defines metric semantics and the trusted-evidence boundary; the legacy collector does not yet establish every v2 coverage/snapshot guarantee.

Important existing limits: Next 14 dependency advisories; fixed fallback session secret; shared API service user; no configured local database; collector caps and unpinned branch reads; webhook timestamps derived from head commit metadata. Do not deploy this recovered baseline as a multi-customer SaaS.

Hub: `/Users/stew/Repos/repocat` on main. Active recovery worktree: `/Users/stew/.codex/worktrees/repocat/recover-report-contract`, branch `codex/recover-report-contract`. No push/publication authorized. Local receipts are ignored under `.verification/recovery`.
