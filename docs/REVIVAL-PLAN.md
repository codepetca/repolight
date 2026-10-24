# RepoLight delivery plan

Updated 2026-10-24 · Goal active · Public repositories only

## Outcome

A student submits a public repository and optionally a GitHub username. RepoLight collects one immutable snapshot, produces a repository overview and separate contributor reports, and lets a teacher inspect evidence and edit feedback. A matching username opens that contributor; no username opens all contributors; an unmatched username opens the overview with a clear notice. Missing or unlinked identity is visible, never silently treated as no student work.

The complete goal includes a securely authenticated, persistent background-analysis service; Pika submission/status/report/feedback-review integration; and optional evidence-cited AI interpretation. Deterministic facts remain usable with AI disabled or unavailable. Pika controls grades, feedback edits, Return and student visibility.

Implementation and verification are authorized. Publication, merge, deployment, credential changes, paid-provider activation and hosted migrations still require applicable explicit authority. The earlier PR/merge authorization applied to the completed recovery PR #7; it is not standing authority for new releases. Prepare concrete reviewable work before asking for any missing external authority.

## Delivered baseline

- Recovery/public-report flow and RepoLight branding merged as PR #7, main `54109097dc5ba7b20f5f9ff4f0e49806dde60f9f`.
- Public collector with pinned SHA, bounded requests/concurrency and explicit partial coverage.
- v2 student report, deterministic metrics, rule-based feedback, timeline/file heatmap, concise summary/evidence views and separate teacher edits.
- Final baseline verification: 111 tests across 19 files, typecheck, lint, production build and local production smoke; independent reviews and one remediation batch passed.
- GitHub repository and local hub renamed to `codepetca/repolight` and `/Users/stew/Repos/repolight`.
- Current limitations: local analysis route requires a username; no all-contributor bundle; no saved report/durable v2 job/hosted customer boundary/Pika UI; AI not requested. Legacy v1 remains compatible but is not the SaaS customer-isolation boundary.

## Milestones and exit criteria

| Milestone | State | Delivery and acceptance |
| --- | --- | --- |
| 1. Contributor-aware report | In progress | Optional username; scope-aware repo overview and per-contributor metrics/evidence/feedback from one collection; explicit unmatched fallback; unlinked authors/bots/aliases handled honestly; edits isolated per view; JSON includes the complete bundle; no regressions to v1/v2. Verify identity, schedule/date, exclusions, partial history/files and fallback with tests and browser checks. |
| 2. Secure persistent service | Planned after 1 | Reuse Next/Neon/Drizzle unless evidence requires a change. Customer-scoped authentication and report/job access, immutable stored facts and separate edits, durable atomic job claiming with leases/retries/idempotency, bounded concurrency and collection budgets. Resolve existing dependency/session/service-user hosting blockers. Demonstrate two-customer isolation, retry/restart recovery and duplicate-request safety using a disposable local database. Supply deployable configuration and operator documentation; distinguish this from actual hosted deployment. |
| 3. Pika integration | Planned after 2 | Reuse Pika submission and external-service patterns. Send repo, optional username, assignment dates/schedule and opaque scoped references through one versioned create/status/result contract. Teacher Analyze/status/report and feedback import work end-to-end; reruns/late results never overwrite edited or returned feedback. Pika alone controls Return/student visibility. Verify teacher/student boundaries, failure/partial states, retries and duplicate/stale results. Follow Pika's startup, UI reference, migration and PR rules. |
| 4. Optional AI interpretation | Planned after facts/service contract | AI is explicitly optional and separate from deterministic facts. Bounded evidence/context, no repository-code execution, untrusted repo text treated as data, structured cited observations, generator provenance and output validation. Failure leaves facts and original/edited rule feedback available. Test disabled/success/failure/invalid citation/prompt-injection cases without paid calls; verify a configured provider only with authorized access. |
| 5. End-to-end readiness | Planned | Verify repository-only and focused-user flows, unknown authors, empty/partial history, saved results/job restart, Pika submit→analyze→review feedback, optional AI failure, supported mobile/desktop/accessibility paths, and risk-matched independent reviews. Record what is local/tested versus externally pending. Complete required checks before requesting any release/deployment approval. |

## Report and identity decisions

- Repository totals are explicitly repository-wide; do not relabel them as student work or invent a matching login to reuse a student builder.
- Preserve the existing v2 schema/builder/legacy v1 consumers. Introduce a versioned scope-aware bundle and share scope-neutral calculations where practical.
- Group linked commits by normalized GitHub login. Do not guess that repository ownership proves contribution. Do not merge distinct logins solely because email strings coincide.
- Unlinked commits remain separately identified using a stable opaque author reference; private email aliases are for matching only and never exported. If no reliable identity exists, expose an unknown-author bucket instead of claiming it is one person.
- Detect bots only from explicit metadata or inspectable bot identity rules; label them distinctly. Exclusions and inherited starter history remain visible, and human contribution totals must not silently include known bot work.
- Requested username resolution means matching eligible collected evidence in the declared period, not proof that a GitHub account does not exist. An unmatched result must say what evidence was searched and preserve partial-collection caveats.
- Density uses supplied scheduled project dates. Unknown schedule/history/file evidence is unavailable/partial, not zero. Commit time is not push time, effort, attendance or AI authorship.
- Teacher edits are stored by report/contributor scope and kept separate from generated originals and future AI output.

## Shared integration boundary

RepoLight owns public repository collection, snapshot provenance, deterministic facts, coverage, contributor resolution, generated feedback originals, analysis jobs and results. Pika owns student/roster/assignment/submission identity, assignment context, teacher grading and visibility. Send opaque installation/submission/student/request references and only identity/context necessary for analysis.

Proposed service namespace remains create/status/result under `/api/v2/analyses`, with explicit schema versions. Use tenant-scoped idempotency keys, immutable snapshot/result revisions, authenticated polling/reconciliation, and signed notifications only if the existing integration pattern requires them. Arbitrary request-supplied callback fetch destinations are prohibited. Standalone and Pika use the same pipeline and metric semantics.

## Explicitly deferred

GitHub App setup, private repositories, historical push reconstruction, billing/payments, paid launch, recruiting external teachers, similarity checking, AI-authorship percentages, automatic misconduct verdicts, automatic grades, cohort ranking, repository code execution, other Git providers and LMS integrations beyond Pika. These are not necessary to complete the active goal. Existing legacy classroom/API behavior is preserved rather than expanded speculatively.

## Execution and orchestration

One coordinator owns the goal, shared contract, integration, verification and milestone acceptance. One writer per component. Workers return bounded evidence and do not recursively delegate. Use the smallest effective team, with model/effort chosen for concrete ambiguity and verifiability. Review implementation independently under the `pr-review` skill's risk-based limits; do not mistake self-review or a worker's completion claim for acceptance.

Current branch/worktree: `codex/contributor-reports` at `/Users/stew/.codex/worktrees/repolight/contributor-reports`, based on main `5410909`. Keep `/Users/stew/Repos/repolight` on main. Do not alter active Pika checkouts; use a separate authorized worktree when implementation there becomes ready.

| Assignment | Model/effort | State | Ownership/evidence |
| --- | --- | --- | --- |
| Contributor bundle design | GPT-6.1 Sol/high | Running | Read-only report/collector/UI contract analysis; coordinator owns decision. |
| Pika integration map | GPT-6.1 Sol/high | Running | Read-only Pika startup/source discovery; no data, credentials, migrations or edits. |
| Plan, shared decisions and setup | Coordinator | Running | This roadmap, CURRENT, scope decisions and clean worktree setup. |

Initial resource receipt: Codex weekly allowance 47% used / 53% remaining (account-wide, not attributable task cost); storage healthy with approximately 258GB available. Automatic DeepSeek is explicitly paused through 2026-12-31. Effective worker model telemetry and per-turn token/time deltas are unknown unless subsequently exposed. Record deliveries, checks, rework and accepted revisions here as the work proceeds.
