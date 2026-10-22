# Repocat

Read `.ai/CURRENT.md`, `docs/REPORT-CONTRACT.md` and `docs/DEVELOPMENT.md` before implementation. `docs/REVIVAL-PLAN.md` is the roadmap; current user instructions override its assumptions.

- Current scope: public-repository collection, deterministic metrics/graphs and rule-based feedback in a local database-free report flow. GitHub App setup, private-repo support, live AI generation, hosted SaaS access and Pika UI integration are later work.
- Preserve the existing analyzer and `/api/v1` behavior while adding the report-first v2 module. Facts are deterministic; interpretation and teacher edits are separate.
- Never infer push times from commit dates, student effort from activity counts, or AI authorship from repository history.
- Coverage and exclusions are part of the report. Missing data is not zero; inherited starter code is not automatically student contribution.
- Prefer tests first for report calculations, parsing and cross-module behavior. Reuse the current Vitest harness and pinned dependencies.
- Keep the hub on main; use a dedicated branch/worktree and one writer per component. See `docs/DEVELOPMENT.md`.
- Keep credentials, real student data, generated reports and verification logs out of Git.
- Implementation permission does not authorize push, publication, deployment, GitHub account/App changes or hosted database migrations. Confirm authority for those actions separately.
