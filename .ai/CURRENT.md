# RepoLight — 2026-10-24

Active user goal: complete contributor-aware public-repository reports, secure persistent service readiness, Pika submission/status/report/feedback-review integration, and optional evidence-cited AI interpretation. The tool-backed coordinator goal is active. See the single delivery plan and assignment ledger in `docs/REVIVAL-PLAN.md`.

Baseline: recovery/report UI/branding merged in PR #7 as main `54109097dc5ba7b20f5f9ff4f0e49806dde60f9f`; 111 tests, typecheck/lint/build, production smoke and independent review passed. GitHub repo is `codepetca/repolight`; hub `/Users/stew/Repos/repolight` on main. Old `repocat` environment/cookie/v1 identifiers are compatibility names, not product branding.

Current milestone: optional username plus repository overview and per-contributor metrics/evidence/feedback from a single immutable collection. Preserve the v2 student contract, legacy v1 compatibility and honest unknown/partial identity/history/date/file coverage. Do not synthesize student identity to represent repository totals. Missing or unmatched username defaults to the overview with an explicit notice. Unlinked authors and bots remain visible; private emails stay out of exports. Keep per-view teacher edits separate.

Active worktree: `/Users/stew/.codex/worktrees/repolight/contributor-reports`, branch `codex/contributor-reports`, based on main `5410909`. Sol/high backend work and Sol/medium UI work are delivered; Pika discovery accepted. Coordinator owns integration, browser checks and independent review; see roadmap ledger. See roadmap before assigning files.

Reuse Next.js, Neon/Drizzle, existing collector and deterministic report calculations. The local `/api/reports/analyze` remains development/loopback-only; it is not the future customer-scoped API. The new bundle API and report UI now support an optional username; full tests/build pass and milestone1 awaits browser verification and independent review. Default UI period is last60 local calendar dates, branch main, browser timezone/Toronto fallback. Current tagline “Code revealed.” and approved chip/light artwork stay unchanged.

Implementation and local verification are authorized. The prior PR/merge permission covered completed recovery PR #7, not all future publication. Deployment, credential changes, paid-provider activation and hosted migrations require applicable explicit authority. Prepare concrete reviewable work before requesting missing authority. GitHub App/private repos/billing are deferred. Pika changes must follow its own startup, worktree, UI, tests, migration and publication guidance.

Existing hosting blockers are documented in `docs/RECOVERY.md`: dependency advisories, production fallback session secret and shared v1 API service user. Legacy collector coverage/push metadata limitations must not leak into v2 completeness claims. No hosted service, Pika feature or live AI provider readiness is established by the baseline.
