# On-demand hosted analysis — prepared 2026-11-11

The branch replaces the Vercel analysis daemon with private queue and scheduled
functions. The PostgreSQL job contract and migrations are unchanged. Local
Vercel Build Output and all 297 tests (including disposable PostgreSQL) passed.
No hosted environment, credentials, provider controls, or deployment changed.
See [VERCEL.md](../docs/VERCEL.md) for explicit activation, isolated hosted
acceptance and rollback steps.

# Historical checkpoint — 2026-10-25 (America/Toronto)

RepoLight is live at https://repolight.vercel.app. Human approval on 2026-10-25
covered the frozen migrations 0000–0005 on dedicated Neon `repolight-db` /
`long-boat-34609339` / `neondb`; all six ledger hashes match. Vercel production
`dpl_FaaepPvXtb9sSguYiCDzoAQdH6ys` serves reviewed `a08cce3581c22a4aff68899add3bfecd2459abdf`
from `codex/vercel-pilot`. Hosting [PR#10](https://github.com/codepetca/repolight/pull/10)
merged at `1156fc87d847e35ee8af8d9284012990d24c7e1b`; the hub is synchronized.
Vercel rejected Git connection because Hobby does not support private organization
repositories. Deployment remains manual; no billing or visibility change was made. Web and one 1 GiB analysis daemon in iad1
are ready. Real hosted auth, public collection, fallback, saved feedback, scoped
key restrictions, stop/start queue recovery, erasure and revocation passed.
Synthetic reports were erased and temporary keys revoked. [VERCEL.md](../docs/VERCEL.md)
records target, deployment and remaining rollout boundaries. No paid AI calls.

Pika [PR#1687](https://github.com/codepetca/pika/pull/1687) is live at reviewed production
`dbd1f62c12b3be8f359d6c35fde77a27d7f77987`; Vercel reported READY on that exact SHA.
Separate human approval covered one production293 application and the coordinated
release. [Run40226843818](https://github.com/codepetca/pika/actions/runs/40226843818)
verified only293/history001–293 and the approved source/digest. Catalog/RLS/ACL,
routine preservation, trigger and archive checks passed; CI40222687057 passed all
ten jobs. Existing cohort/provider controls were preserved and the maintenance
window is closed. Shared local was untouched. Pika [receipt#1689](https://github.com/codepetca/pika/pull/1689)
records the verified state; its main-only documentation merge does not deploy.

Analyze and optional RepoLight AI remain OFF. Teacher/workspace/installation key
binding and an authenticated hosted Pika → RepoLight pilot are next. Earlier local
and standalone hosted evidence do not establish that integration acceptance.
The standalone Pika archive-inventory diagnostic has a tracked post293 resource
family limitation; runtime V2 graphs are additive-aware. Local pilot proof remains
at `~/.codex/verification-archives/repolight-local-pilot-2026-10-25/` and versioned
production receipts at `~/.codex/verification-archives/repolight-hosted-pilot-2026-10-25/`.
Earlier checkpoints below are history, not current hosted-readiness claims.

## Historical pre-activation checkpoint

The RepoLight public-repository workflow is implemented, locally verified and published. Contributor-aware reports, the durable authenticated service, Pika report/feedback review and separately optional AI interpretation are delivered. The single milestone, review and evidence ledger is [REVIVAL-PLAN.md](../docs/REVIVAL-PLAN.md); dated earlier checkpoints are history.

RepoLight feature [PR#8](https://github.com/codepetca/repolight/pull/8) merged at `f21f6a70364cc1a9b21a9156a8a734bee9961da7`. This handoff changes documentation only; application source remains identical to that merge. The canonical hub is `/Users/stew/Repos/repolight` on main.

Pika [PR#1681](https://github.com/codepetca/pika/pull/1681) squash-merged at `1b9ef0c490dd5a8ed895565b176a89f8cd6cbbfa`. [CI40194727168](https://github.com/codepetca/pika/actions/runs/40194727168) passed all ten jobs on reviewed `55f5306b396bdea6a524b873730b95eddefc471b`, based on main `19b5abab9`. Eleven actual independent Pika reviewer turns are recorded; all accepted blockers are resolved. The clean Pika hub is synchronized. Upstream Assignment owner-read/Return refresh fixes and current production/cohort/provider receipts were preserved; this task performed no production promotion.

Verification: RepoLight278tests including8native cases, types/lint/build and accepted independent reviews remain applicable to unchanged application source. Final Pika focused5,968tests/one skip, types/lint/architecture/UI/design and complete CI pass. Owned293 replays cover archive lifecycle/compaction/races/legacy compatibility, warning-free functions, Home recovery/contention and generated types. Actual pinnedCLI2.103.0 member-list nine SDK cases plus both forced-cleanup modes passed on `0c159847e`; verified unchanged SDK/SQL sources retain that evidence, and final CI reran the current source. HTTP and component-browser report/feedback/erasure evidence are separate from an authenticated RepoLight-integration browser end-to-end run, which remains unverified.

Activation is a separate phase. Pika Analyze and optional paid AI remain OFF. Shared local and production Pika293 is unapplied; current source SHA-256 is `b03d4dccd88ecbbf06d103b57c0cee97fccd6b07f13dfc2b0a4ed438fd68d052`. Choose a hosting/runtime target, obtain exact-target migration authority, configure private installation/workspace/scoped-key bindings and perform a hosted smoke check before enabling Analyze. Real hosted/Linux-worker/Neon operation, provider compatibility/quality/retention and live paid calls are unverified. No deployment, real credential provisioning or paid activation occurred. See [SERVICE.md](../docs/SERVICE.md), [AI-INTERPRETATION.md](../docs/AI-INTERPRETATION.md) and the Pika integration guide.

Preserve public-repo-only scope, existing collector and `/api/v1` behavior, v2/Pika contracts, coverage/exclusions and teacher edits. Matching optional GitHub accounts focus that contributor; omitted/malformed/unmatched values show all contributors with a notice. Unlinked authors, aliases and bots stay explicit; no owner-login inference. Default main/last60localdates/browser timezone or Toronto. Commit history cannot establish push timing, effort, understanding, attendance or AI authorship. Facts, rules and edits remain separate. Tagline “Code revealed.” and the approved chip/light logo remain. GitHub App/private repos and billing are deferred.

Pika task worktrees are retired. Verified history bundles,645 copied proof files and retirement receipts are private under `$HOME/.codex/verification-archives/repolight-01a15c49-e31b-7060-8c2b-a7d1bc347706/`; the shared environment target was untouched and its symlink preserved without following it. Task-owned disposable Pika services were cleaned up with canonical fingerprints unchanged. Earlier RepoLight fixture PostgreSQL55487/proxy/dev3047/3049 were retained for local follow-up and predate the final AI branch; they do not prove the current source is running.

The human's task-scoped workflow-budget/low-usage waiver was used to finish this coordinator goal with cumulative counters retained. It grants no standing waiver to another task and no deployment, migration, credential or paid-provider authority. The separately paused DeepSeek pilot remains paused through2026-12-31. No supported worker-runtime shutdown control is exposed; completed agents are not claimed released. No Zero changes belong to this work.
