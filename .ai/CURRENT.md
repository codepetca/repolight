# RepoLight — 2026-10-22

Recovered from main `626d7e9da7702bcd791ebb59f947937293907b0a`.

User authorized recovery/contract work, followed by public repo analysis with metrics, graphs and rule-based feedback. Public repos only; GitHub App setup and AI remain deferred. Durable jobs, hosted tenant isolation, saved reports and Pika integration remain later phases.

Current work reuses Next.js/Neon/Drizzle and existing v1 normalized events/API. The pure `src/lib/report` module provides the v2 report schema/builder and fictional Sky Hop fixture. `/reports` adds the standalone form, timeline, heatmap, commit evidence, editable rule feedback and JSON export. `/api/reports/analyze` is deliberately development/loopback-only, requires same-origin JSON, bounds input and permits one in-flight collection per process. It needs no database. It is not the proposed tenant-scoped v2 SaaS API. See `docs/PUBLIC-REPORTS.md` for the request/response contract and limits.

Reports now open on a concise summary with core/observed metrics, workflow findings, limitations and editable feedback. Detailed graphs, commits and metadata are behind “View evidence”; switching views preserves edits and JSON still exports the complete report. This is a presentation change; collection, metrics and feedback rules remain unchanged.

The entry form is compact: public repo URL and editable student username suggested from the owner. Options holds dates/timezone/branch/schedule/exclusions. UI defaults to main, last 60 local calendar dates and browser timezone with Toronto fallback; dates are analysis filters, not scheduling. API defaults remain unchanged.

The existing GitHubClient now has a separate snapshot-pinned public collection method with bounded pagination/concurrency and explicit partial coverage; legacy v1 collection behavior remains separate. Rule feedback is a versioned sidecar to measured facts; AI interpretation remains not_requested. No database migration, AI call, push, deployment or account change is part of this phase.

Read `docs/RECOVERY.md` for verified checks, existing deployment blockers and runtime limits. `docs/REPORT-CONTRACT.md` defines metric semantics and the trusted-evidence boundary; the legacy collector does not yet establish every v2 coverage/snapshot guarantee.

Important existing limits: Next 14 dependency advisories; fixed fallback session secret; shared API service user; no configured local database; collector caps and unpinned branch reads; webhook timestamps derived from head commit metadata. Do not deploy this recovered baseline as a multi-customer SaaS.

Hub: `/Users/stew/Repos/repocat` on main. Active recovery worktree: `/Users/stew/.codex/worktrees/repocat/recover-report-contract`, branch `codex/recover-report-contract`. No push/publication authorized. Local receipts are ignored under `.verification/recovery`.

Branding uses the shared Brand component across login, reports and authenticated headers, with the tagline “See how code takes shape.” The product demo button and client fixture imports are removed; synthetic fixtures remain in tests/CLI. Sign-in retains its accessible form name and action button without a large mode heading.

Product renamed to RepoLight. Shared branding uses three connected Git-style nodes, one bright amber, with no glow or rays, also used as the browser icon. UI, metadata, feedback and download filenames use RepoLight; legacy API helper names, REPOCAT_* configuration, session cookies, stored integration source IDs and checkout paths retain compatibility. The shared tagline is “See how code takes shape.”
