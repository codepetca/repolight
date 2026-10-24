# RepoLight

Read `.ai/CURRENT.md`, `docs/REPORT-CONTRACT.md` and `docs/DEVELOPMENT.md` before implementation. `docs/REVIVAL-PLAN.md` is the roadmap; current user instructions override its assumptions.

- Current authorized goal: contributor-aware public reports, secure persistent service readiness, Pika integration and separately optional AI interpretation. Work phase by phase through docs/REVIVAL-PLAN.md; do not claim later readiness from scaffolding. GitHub App setup, private repos and billing are deferred.
- Preserve the existing analyzer and `/api/v1` behavior while adding the report-first v2 module. Facts are deterministic; interpretation and teacher edits are separate.
- Never infer push times from commit dates, student effort from activity counts, or AI authorship from repository history.
- Coverage and exclusions are part of the report. Missing data is not zero; inherited starter code is not automatically student contribution.
- Prefer tests first for report calculations, parsing and cross-module behavior. Reuse the current Vitest harness and pinned dependencies.
- Keep the hub on main; use a dedicated branch/worktree and one writer per component. See `docs/DEVELOPMENT.md`.
- Keep credentials, real student data, generated reports and verification logs out of Git.
- Implementation permission does not authorize push, publication, deployment, GitHub account/App changes or hosted database migrations. Confirm authority for those actions separately.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
