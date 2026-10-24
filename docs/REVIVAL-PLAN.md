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
| 1. Contributor-aware report | Locally verified at cab3a37 | Optional username; scope-aware repo overview and per-contributor metrics/evidence/feedback from one collection; explicit unmatched fallback; unlinked authors/bots/aliases handled honestly; edits isolated per view; JSON includes the complete bundle; no regressions to v1/v2. Verify identity, schedule/date, exclusions, partial history/files and fallback with tests and browser checks. |
| 2. Secure persistent service | Locally accepted at53c0cc5 | Reuse Next/Neon/Drizzle unless evidence requires a change. Customer-scoped authentication and report/job access, immutable stored facts and separate edits, durable atomic job claiming with leases/retries/idempotency, bounded concurrency and collection budgets. Resolve existing dependency/session/service-user hosting blockers. Demonstrate two-customer isolation, retry/restart recovery and duplicate-request safety using a disposable local database. Supply deployable configuration and operator documentation; distinguish this from actual hosted deployment. |
| 3. Pika integration | Starting | Reuse Pika submission and external-service patterns. Send repo, optional username, assignment dates/schedule and opaque scoped references through one versioned create/status/result contract. Teacher Analyze/status/report and feedback import work end-to-end; reruns/late results never overwrite edited or returned feedback. Pika alone controls Return/student visibility. Verify teacher/student boundaries, failure/partial states, retries and duplicate/stale results. Follow Pika's startup, UI reference, migration and PR rules. |
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

## Accepted Pika integration findings

Static discovery at Pika main `c7ff0f1f0a94e6e7600f22d0c2324abbf4e8412b` found structured `repo_link` submission artifacts and saved `user_github_identities`. `resolveAssignmentRepoTarget` currently assumes a username/owner fallback; the new integration must distinguish a supplied student login from inferred repository ownership. Existing GitHub account validation proves account existence, not ownership.

The old `artifact-repo/run` route is synchronous and grading-shaped. Its completion path writes score suggestions even when `markGraded=false`; do not reuse that completion RPC for report-only jobs. Current teacher inspector has no Repo/Analyze action and explicitly tests that it is hidden. Add a deliberate report-only action using current approved Pika UI patterns rather than treating stale repo-inspector documentation as implementation evidence.

Reuse server-only Gradex client validation/idempotency/poll binding, grading-run leases/retries, and Bara authenticated transport/replay protection where appropriate. Initial authenticated polling is simpler than introducing callbacks. Persist report lifecycle separately from grades/comments and protect teacher edits and Return. New storage must participate in archive/student-purge/remote-copy/decommission boundaries, not just generic RLS.

Pika will require report-only lifecycle storage/RPC changes and generated database types. Applying a migration requires one-time approval naming the exact migration and target under Pika's schema-rollout rules; source and tests must be concrete before requesting that approval. No Pika database or credential was accessed during discovery.

## Explicitly deferred

GitHub App setup, private repositories, historical push reconstruction, billing/payments, paid launch, recruiting external teachers, similarity checking, AI-authorship percentages, automatic misconduct verdicts, automatic grades, cohort ranking, repository code execution, other Git providers and LMS integrations beyond Pika. These are not necessary to complete the active goal. Existing legacy classroom/API behavior is preserved rather than expanded speculatively.

## Execution and orchestration

One coordinator owns the goal, shared contract, integration, verification and milestone acceptance. One writer per component. Workers return bounded evidence and do not recursively delegate. Use the smallest effective team, with model/effort chosen for concrete ambiguity and verifiability. Review implementation independently under the `pr-review` skill's risk-based limits; do not mistake self-review or a worker's completion claim for acceptance.

Current branch/worktree: `codex/contributor-reports` at `/Users/stew/.codex/worktrees/repolight/contributor-reports`, based on main `5410909`. Keep `/Users/stew/Repos/repolight` on main. Do not alter active Pika checkouts; use a separate authorized worktree when implementation there becomes ready.

| Assignment | Model/effort | State | Ownership/evidence |
| --- | --- | --- | --- |
| Contributor bundle backend | GPT-6.1 Sol/high | Delivered | Design accepted; owns scope-neutral calculations, versioned bundle contract/build/analyze, collector metadata and shared local route gate, backend tests. |
| Pika integration map | GPT-6.1 Sol/high | Accepted | Read-only discovery at Pika main c7ff0f1f; existing submission/repo identity and Gradex/Bara patterns mapped. No edits/data/credentials/migrations. |
| Contributor report UI | GPT-6.1 Sol/medium | Delivered | Owns existing report component/CSS/component tests against frozen bundle contract; no backend or shared-contract edits. |
| Plan, shared decisions and setup | Coordinator | Running | This roadmap, CURRENT, scope decisions and clean worktree setup. |

Initial resource receipt: Codex weekly allowance 47% used / 53% remaining (account-wide, not attributable task cost); storage healthy with approximately 258GB available. Automatic DeepSeek is explicitly paused through 2026-12-31. Effective worker model telemetry and per-turn token/time deltas are unknown unless subsequently exposed. Record deliveries, checks, rework and accepted revisions here as the work proceeds.

Milestone1 integration receipt: 138 tests across21 files, typecheck, lint, diff check and production build passed. Backend/UI file ownership stayed separate; coordinator requested process-global route locking and scope-aware fallback notice behavior, both verified by regression tests. Browser/live checks and independent review are pending; code delivery is not hosted-service readiness.

Milestone1 acceptance: independent Sol/high review completed at5c3165c, no blockers; two accepted P3s fixed together atcab3a37 and targeted review clean (2 review turns,1initial+1targetedwave,1fixbatch). Live public repo withoutusername produced5eligiblecommits/oneunlinkedbucket; scope switching preserved separatefeedback; invalidusernamefallback and evidenceview passed; responsive check had no horizontaloverflow at effective520CSSpx. Screenshots under ignored output/playwright/contributor-*.png. Full138tests/build reused with31targetedpost-fix tests/type/lint; no source ownershipconflicts. Not pushed/merged.

Phase2 ready: Pika mapworker reused as Sol/high read-only service-contract/store design. Coordinator checks isolated localPostgres availability. Hosted operations and realcredentials remain outside this investigation.


Milestone2 implementation receipt: Sol/high data worker delivered five additive service tables and atomic queue/edit functions; Sol/high API worker delivered customer/installation auth, versioned create/status/result, pinned retry collection and fenced worker; Sol/medium UI worker delivered authenticated saved reports, polling, reopening, CAS edits and temporary key controls. Sol/high runtime worker upgraded Next16.4.3/React19.3.1, fail-closed production sessions, patched task-local Node22.23.4, a guarded development Neon proxy and separate non-root web/worker packaging. Worker source ownership remained separate; one build-discovered session-prerender ordering fix was integrated before review. Coordinator inspected source/configuration and wrote SERVICE.md. No external credentials, hosted migrations or Pika database touched.

Integration evidence before independent review: full218tests/30files (including disposablePostgres), typecheck/lint/diff passed; credential-free standalone production build passed after cookie-read ordering fix;10targeted session tests pass including production rejection/prerender deferral. Whole and production npm audits report0vulnerabilities. Worker bundle/isolated execution and Compose validation passed; Linux image execution remains pending. Local target127.0.0.1:55487/repolight_service is task-created/disposable and exact-target guarded. Browser/authenticated flow verification in progress. Runtime packaging took approximately5worker minutes plus coordinator verification; exact tokens/effective-model telemetry unknown. Latest weekly allowance49%used/51%remaining, account-wide.

Milestone2 independent-review budget opened: high risk, two independent Sol/high reviewers planned for security/auth and storage/architecture/compatibility; max7launches,1initialwave,4targetedwaves/fixbatches,60elapsedminutes. No reviewer launched yet. Root retains integration and publication decisions.


Milestone2 accepted locally at53c0cc5: full220tests/30files pass including13realPostgres store tests and Neon protocol test; typecheck/lint/diff/standalonebuild passed, with25affectedtests after remediation. Independent Sol/high security and storage reviews completed e05fed0; one duplicateP2 accepted (installationfilterafterlimit). Coordinator fixed query-before-limit and Date precision in one batch53c0cc5, targeted security review clean. Budget consumed3reviewerturns,1initialwave,1targetedwave,1fixbatch; elapsed approximately7minutes, perturntokensunknown. Unchanged initial coverage retained; no additional cumulativewave needed for this isolated correction.

Browser on real localDB: syntheticonly teacher registered, explicitworkspaceinit, queuedpubliccodepetca/zero-drawing-pad, bundledworkercompleted, storedsnapshot+5commitreport loaded, fullreload/reopen preserved teacheredit, contributorfeedback remainedseparate, summary/evidence passed, consoleerror/warnnone. Ignored screenshots output/playwright/saved-report-feedback.png and saved-report-evidence.png. DockerLinuxweb/worker builds andnonroot/context-exclusionchecks passed; localproductionweb/login200,unauthservice401/no-store. Task-owned smokecontainer stopped; localdevweb/proxy/fixtureDB retained forintegration. LinuxworkerproductionNeonexecution andhosteddeployment remainunverified. NoPikaDB accessorhostedmigration.

Milestone3 next: create isolated Pika worktree oncurrentmainc7ff0f1f; complete startup/routed guidance. Fixedservicecontract is docs/SERVICE.md and src/lib/service/contract.ts. Prepare report-only lifecycle/client/teacherUI and rollback-onlyephemeralcontracts; requestexacttarget/exactmigrationauthority only onceconcretesourceandtestsready. Existing grades/Return stay Pika-owned. OptionalAI stillafterintegrationcontract, providerdisabledbydefault.
