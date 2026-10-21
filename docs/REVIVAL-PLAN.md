# Repocat SaaS revival plan

Date: 2026-10-21 · Status: Phase 0/1 authorized; later phases proposed

Current instruction: recover the existing project and define the report contract using public repos. GitHub App/private-repo work is deferred. See [recovery status](RECOVERY.md) and [implemented contract](REPORT-CONTRACT.md) for current delivery and limits.

## Product direction

Revive Repocat as a standalone service that helps teachers understand how a coding project developed and give specific, evidence-linked feedback. Pika is the first integration; teachers can also use Repocat directly.

The first release combines the report designed in this conversation with reliable repository collection, customer isolation and background processing. Git-derived measurements are calculated in code. AI interprets evidence and drafts comments. Teachers control assessment and feedback publication.

Planning assumptions: invite-only pilot before a paid public launch; GitHub repositories first; Java/Zero examples first; one student-owned repository per submission as the primary flow. Other text-based projects can receive generic history metrics, with the supported scope stated. Retain the existing Next.js, Neon and Drizzle foundation unless the recovery audit identifies a concrete reason to change it. Identity, job hosting, model provider and payment-provider choices are implementation decisions to resolve before their respective phases.

## Existing foundation and evidence

Repocat main was inspected at commit `626d7e9da7702bcd791ebb59f947937293907b0a` on 2026-10-21. This is a source review, not a successful build, deployment or production-readiness assessment.

| Area | Existing foundation | Revival work |
| --- | --- | --- |
| Engine | Commit/file statistics, contributor matching, activity metrics, category heuristics | Explicit metric definitions, scheduled-day context, starter-code exclusions, coverage reporting and snapshot reproducibility |
| API | Pika-shaped run creation, status, processing, results, summary, charts and CSV routes | Tenant-scoped versioned contract, asynchronous jobs, result delivery and idempotency tied to request identity |
| GitHub | Public-repository collection, optional token, App provisioning and signed webhook handling | Read-only access to owner-authorized private repos; per-installation scope; accurate push observations |
| UI | Run workspace and classroom/assignment surfaces | The new report, feedback review and report versions |
| Auth | Cookie sessions; API credentials resolve to a shared configured service user | Per-customer authorization, membership rules, credential rotation and isolation tests |
| Scoring | Rule-based component scores, grade suggestions and cohort-relative calculations | Measurements and qualitative feedback are the default product; automatic grading and cohort ranking are outside the first release |

Known corrections: the current spread denominator enumerates calendar days; current burst ratio measures weighted contribution in the final 48 hours. Neither is the same as the sample report's scheduled-day coverage or busiest-day share. Current push handling assigns `head_commit.timestamp` to push timing; preserve commit time separately and record when a signed push event is first observed instead. Current processing is driven through explicit request calls; it needs durable background execution.

Sources:

- [Repocat README](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/README.md)
- [Metrics](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/src/lib/engine/metrics.ts)
- [GitHub collector](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/src/lib/engine/github.ts)
- [API authentication](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/src/lib/auth/api-key.ts)
- [Webhook handling](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/src/lib/classroom/webhooks.ts)
- [Run processing](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/src/lib/runs/service.ts)
- [Existing Pika payload](https://github.com/codepetca/repocat/blob/626d7e9da7702bcd791ebb59f947937293907b0a/src/lib/integrations/pika.ts)
- [Pika–Bara boundary reference](https://github.com/codepetca/pika/blob/main/docs/integrations/bara-attendance-v1.md)
- The fictional report designed in the planning conversation is specified in [REPORT-CONTRACT.md](REPORT-CONTRACT.md) and the synthetic Sky Hop fixture; it is not an implemented Pika feature.

## First-release scope

Include standalone teacher accounts/workspaces, a repo submission form, selected private-repo authorization, single and batch analysis, the agreed report, editable feedback, saved report versions, usage limits and a Pika connection.

The report contains:

1. Student commit count, commit density, days with commits and busiest-day share.
2. Commit timeline with messages, change sizes and commit/file drill-down.
3. File-by-commit heatmap with readable values and the same selection as the timeline.
4. Workflow summary covering progression, checkpoint focus and message clarity.
5. Recorded contributor attribution and explicit unmatched/ambiguous identity notes.
6. Editable student-feedback draft, preserved separately from the generated original.
7. Teacher-only review questions about understanding or code origins, grounded in specific evidence.
8. Snapshot, period, baseline, exclusions and collection-coverage details.

Show push observations only when records exist, including the observation-coverage period. A newly connected repo can receive a useful historical commit report without historical push observations.

Exclude AI-authorship percentages and automatic misconduct verdicts based on repository history. Defer cross-student similarity comparison, automatic grades, cohort ranking, code execution/build testing, automatic repository creation, other Git providers, organization-wide administration and LMS integrations beyond Pika. Keep student repositories under their owners' control. Existing standalone classroom features can remain where useful without requiring Pika to synchronize a second complete roster.

## Product and ownership boundaries

| Pika owns | Repocat owns |
| --- | --- |
| Student identity, roster, assignment and submission records | Authorized repository connection and collected evidence |
| Classroom dates, timezone, expected workflow and taught concepts | Deterministic metrics and snapshot/version provenance |
| Teacher grades, feedback edits, Return and student visibility | Generated observations, review questions and feedback originals |
| Mapping opaque external references to local records | Tenant-scoped jobs, reports, delivery events and usage |

For an integrated analysis, send opaque tenant/installation, submission, student and request references. Send only the GitHub identity information needed for attribution and the assignment context needed for interpretation. Keep names, contact details and internal Pika identifiers in Pika where possible. Adjust the existing Repocat payload's required name field rather than transmitting a full roster for convenience.

Repocat can have richer local records for standalone users. Integrated records remain distinguishable and scoped to their connection. GitHub repository access always comes from an authorized repository owner/installation; a submitted URL grants no private access.

## Measurement contract

Freeze a report period, timezone, repository/branch, analyzed head SHA, starter baseline, author mapping and inclusion policy. Use explicit UTC bounds with a documented half-open interval `[start_at, end_at)`; interpret class-day dates in the supplied timezone.

An eligible commit is a unique qualifying commit SHA within the declared period and analyzed history. Remove inherited starter history, known bot activity and duplicate merge-only accounting according to an inspectable policy. Preserve genuine merge-resolution changes as evidence rather than silently discarding them. Identify which counts are repository-wide and which match the selected student; unmatched authorship is shown separately.

| Metric | Definition | Missing-data behavior |
| --- | --- | --- |
| Student commits | Eligible commits matched to the student's declared GitHub identities | Unknown identity coverage is disclosed; repository totals are not silently relabeled student totals |
| Commit density | Eligible student commits in the period / scheduled project dates in that period | Unavailable when no schedule is supplied or the denominator is zero |
| Days with commits | Scheduled project dates containing at least one eligible student commit / scheduled project dates | Display both numerator/denominator and percentage; this is not attendance |
| Busiest-day share | Largest eligible student commit count on one local calendar date / total eligible student commits | Undefined with zero commits; report “No commits” rather than an invented percentage |
| Source change size | Added and deleted student-source lines, with docs/assets distinguished | Excluded paths and incomplete diffs are visible |
| File heatmap | Added plus deleted lines per included file and commit | Missing/truncated data is not zero |
| Push activity | Distinct validated push observations with delivery deduplication | Show “Not available” outside observed coverage; never substitute commit dates |
| Message clarity | AI/rule-assisted qualitative observation with message and diff references | No grammar score or unsupported claim about message/diff agreement |

Commit density includes home/weekend commits in the period; scheduled-day coverage only counts supplied project dates. Show outside-schedule activity separately so these measures remain understandable. Optional excused dates must be supplied explicitly; never infer them from missing commits. Commit dates remain Git metadata, not proof of time spent working.

Baseline exclusions must distinguish unchanged supplied code from student modifications to that code. A template ancestor SHA is preferable when available; imported ZIP/template projects need an explicit file-content baseline. Renames and formatting should not masquerade as new substantive work.

Every report declares complete, partial or unavailable collection coverage. Pagination limits, missing branches, missing author mappings and unavailable source content must survive into the report and AI context.

## Analysis pipeline

`Accept request → authorize tenant/repo → pin snapshot → collect evidence → compute metrics → generate AI interpretation → validate citations/output → persist report → notify consumer`

Use one pipeline for standalone UI and Pika. Standalone settings supply the same project context as the integration. Persist an immutable report/facts snapshot, with separate teacher edits and published-feedback records.

Record repository identity and SHA, collection/observation times, baseline revision, input-policy digest, metrics version, prompt version, provider/model identifier and generation settings. Reprocessing the same evidence must retain identical numeric metrics. Deliberate new analyses create new versions; transport retries reuse the same job and must not produce duplicate charges or reports.

Submission-time history and analysis-time history must be labeled accurately. Where only a link was submitted, pin the authorized head when analysis starts and label it an analysis-time snapshot. A future submission snapshot can be captured through the same service; do not retroactively call the later head the submitted version.

For the first release, use bounded static collection and source/patch reading. Treat repository text as untrusted input, never as instructions for the service. Exclude credential/config secrets from model input, limit file sizes and context, validate structured model output, and reject citations that do not resolve to the analyzed snapshot. If AI fails, preserve the available measurements and allow a separate retry of interpretation.

## Phased delivery

### Phase 0 — Recover and establish the baseline

Work: obtain a dedicated Repocat checkout, inventory existing deployments and data without assuming they are active, establish project guidance, reproduce the current tests/build with fixture data and an isolated test database, and inspect lockfile/dependency health. Verify existing API and collector behavior. Identify any real consumers before changing v1. Preserve existing data; plan tenant ownership backfill explicitly.

Choose concrete hosting/job, identity and model-provider approaches based on the recovered deployment, operational needs and measured prototype cost. Reuse the current stack where practical. Agree on source retention/deletion defaults and provider data handling before an external pilot.

Acceptance: documented reproducible baseline, known failures and reuse inventory; no unexplained schema/data migration; stack and deployment decisions sufficient for Phase 2. No claim of production readiness based on source inspection alone.

### Phase 1 — Define and prove the report contract

Work: introduce the report-first v2 schema, metric definitions, starter baseline policy, coverage states, snapshot/version rules and synthetic fixtures. Preserve v1 consumers if any exist; otherwise retire obsolete grade/curve behavior deliberately. Specify standalone and Pika inputs against the same schema.

Acceptance: the sample's 12 commits, 1.3 density, 6/9 scheduled-day coverage and 25% busiest-day share are reproduced from fixture evidence. Additional fixtures cover no commits, missing schedule, home-only work, unmatched authors, imported starter code, renamed files and partial history. Reviewers can distinguish measured facts, AI observations and unknowns.

### Phase 2 — Make the service safe to operate for separate customers

Work: customer/workspace membership and authorization, tenant-scoped credentials, selected-repo read access, revocation handling, durable jobs, atomic job claiming, bounded retries, cancellation, restart recovery, collection limits and usage accounting. Replace the shared service-user API assumption. Correct and deduplicate push observations. New customers start with explicit history/observation coverage.

Acceptance: two customers cannot read, alter or receive each other's jobs/reports; duplicate requests and callbacks do not duplicate work/accounting; a worker restart is recoverable; revoked access produces a clear scoped failure; public and authorized private repo paths both work. The service requires no repository-administration permission for the report workflow.

### Phase 3 — Deliver the standalone report and AI feedback

Work: implement the designed report using the stable contract, shared timeline/heatmap selection, linked evidence and saved versions. Add project context and template settings, constrained AI generation, editable feedback, original/edit separation and clear collection states. Generic repository metrics remain available when Java-specific interpretation is unsupported.

Acceptance: a teacher can connect an authorized repo, supply context, receive the complete report and edit/export feedback without Pika. Verify light/dark, keyboard and narrow-screen use. Every material AI observation resolves to evidence or is labeled a question/limitation. An AI outage leaves the collected facts usable. Teacher edits survive regeneration.

### Phase 4 — Integrate Pika through a dedicated versioned contract

Work: implement create/status/result routes, signed completion events, tenant/installation mapping and authenticated polling/reconciliation. Add Analyze and class-batch analysis in Pika, status/failure states, report display and feedback import into Pika's existing teacher-review/Return flow. Follow Pika's repository and UI guidance during implementation.

Acceptance: a Pika submission can be analyzed and its feedback reviewed/returned end to end. Private-access failure, partial class completion, duplicate delivery, delayed older results, credential rotation and unavailable Repocat are handled. Reruns do not silently overwrite edited or returned feedback. Pika remains the authority for student visibility and grades.

### Phase 5 — Run an invite-only teaching pilot

Work: start with the owner's real workflow, then recruit a small number of external teachers with permission. Use the service for actual project reviews. Capture baseline manual-review time, report usefulness, correction effort, unsupported observations, identity/coverage failures, completion latency and per-analysis processing/model cost. Do not assume a market or a price from the existence of working software.

Acceptance: numeric fixture checks and tenant-isolation checks pass; pilot report issues are resolved or explicitly scoped out; teachers can understand and use the report without developer assistance; batch completion and support procedures are demonstrated. Agree on usefulness, latency and cost targets after initial measurements and before a paid launch. Keep severe unsupported authorship claims out of shipped feedback.

### Phase 6 — Launch the paid SaaS

Work: self-service onboarding, plan entitlements, usage visibility and hard budget limits, payment lifecycle handling, workspace/account deletion, retention controls, operator diagnostics, support/recovery instructions and clear product/privacy documentation. Validate pricing with pilot teachers and measured cost. A teacher subscription with included analyses is the starting hypothesis; exact prices and school licensing remain open.

Acceptance: onboarding, selected-repo authorization, payment/entitlement changes, exhausted budgets, duplicate requests, account closure and recovery paths are verified. Both standalone and Pika jobs honor the same entitlement/accounting rules. Backup/recovery and deletion procedures are exercised before general availability.

## Proposed Pika API contract

Use a new analysis namespace rather than copying attendance-specific messages or assuming the current v1 result format fits. Suggested interface, subject to Phase 1:

- `POST /api/v2/analyses` → `202 Accepted` with `analysis_ref` and status location.
- `GET /api/v2/analyses/:ref` → authenticated job state and coverage.
- `GET /api/v2/analyses/:ref/report` → versioned structured report and feedback original.
- Signed `analysis.completed`, `analysis.partial` or `analysis.failed` event → Pika's registered endpoint, followed by an authenticated result fetch.
- Authenticated status polling/reconciliation → recovery when an event is delayed or missed.

Request inputs: opaque installation/submission/student/request references; repo and branch or requested SHA; resolved UTC period; timezone and explicit scheduled project dates; attribution mapping; starter baseline; bounded assignment/taught-concept/reuse expectations; and analysis-policy version. Return the actual analyzed SHA and capture time in the result.

Use stable idempotency keys scoped to the installation and logical request. The same key with different inputs is a conflict. Deliberate reruns receive a new request reference. Deduplicate event IDs and apply result revisions monotonically. Separate retryable transport/provider failures from invalid requests or revoked authorization. Register callback destinations per integration rather than accepting arbitrary fetch destinations in job input.

Mirror the useful Bara concepts: scoped identities, signed messages, replay protection, idempotency, explicit ownership and reconciliation. Keep Repocat's own schemas and lifecycle. Tenant authentication and GitHub App installation access are separate authorizations, and both are checked.

## Verification and pilot evidence

Keep an inspectable set of fixtures for gradual development, one late bulk upload, clear/vague/misleading messages, starter-heavy repos, multiple authors, missing identities, changed branches, incomplete collection, absent push observations, duplicate callbacks and repo text attempting to instruct the analyzer. Add real-project examples only with the appropriate permission and retention rules.

For every phase, record implementation revision, checks run, interactive evidence and known limits. Verify report calculations against raw fixtures; verify AI factual statements/citations separately from stylistic usefulness. Measure teacher editing burden and usefulness rather than optimizing commit counts or an unvalidated AI-detection score. Match repository review requirements before shipping code.

## Decisions to resolve during implementation

1. Confirm the recovered hosting/auth/database situation and whether any v1 consumers/data require migration support.
2. Select concrete durable-job, sign-in and AI providers; set run limits and budgets from measurements.
3. Decide private-repo onboarding for student-owned accounts and school-managed organizations, including who grants access.
4. Finalize retention/deletion policy and how long source snippets are necessary after report generation.
5. Decide whether a Pika integration uses a teacher-owned Repocat subscription or a Pika-managed commercial arrangement; preserve tenant isolation either way.
6. Validate price and included-analysis allowance with pilot users; schedule broader language support and similarity analysis only after the core report is useful.

These decisions do not block writing the contract and reproducing the current baseline. They must be settled before the dependent phase ships.

## Immediate next milestone

Complete Phase 0 and Phase 1 before feature expansion: a reproducible Repocat baseline, a versioned report/analysis contract, verified metric fixtures and a short decision record for the required platform choices. The first working vertical slice is then one authorized repository producing the complete standalone report through a tenant-scoped durable job. Pika uses that same path after the standalone slice works.

This document authorizes no implementation, publication, deployment, paid-provider activation, credential changes or external communication by itself. Those actions follow the user's execution instructions and the applicable project workflow.
