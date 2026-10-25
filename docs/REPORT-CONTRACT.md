# Repository report contract v2

Status: implemented schema, pure builder and fictional fixtures. Version `2.0`, metrics version `2.0.0`.

## Scope and reusable parts

The canonical runtime schema and TypeScript type are in `src/lib/report/contract.ts`. `buildRepositoryReport` in `src/lib/report/build.ts` accepts normalized `AnalysisEvent` records from the existing engine. It reuses repository normalization, identity normalization, timezone formatting and rounding helpers. It performs no network, database, AI or account operations.

This is a report contract, not an exposed v2 API. Existing v1 endpoints, grading, auth, collector and classroom behavior remain unchanged. The report schema contains no grade suggestion, cohort ranking or AI-authorship percentage. Strict parsing rejects unknown top-level fields.

## Trusted-evidence boundary

`reportBuildInputSchema` validates collected inputs; it is not a customer-authentication or repository-visibility check. The future collector/service must authorize requests, verify the repository is public, pin the requested branch to a real head SHA, enforce snapshot reachability, establish baseline/exclusion evidence and report collection coverage. Calling the builder with asserted metadata does not prove those checks happened.

The old GitHub collector can supply normalized events, but its 250-commit cap, commit-detail pagination, branch reads and merge filtering do not establish complete v2 evidence. Do not feed legacy results into this builder with `history: complete` or an asserted snapshot without adding collection guarantees. Its current API dates are also inclusive, while this report's author-date membership uses `[startAt, endAt)`.

## Input

One input describes one repository, one student mapping and one report snapshot:

- Opaque `reportRef` and `studentRef`; display names/rosters belong to the consumer.
- Plain HTTPS GitHub repository URL and branch. Credentials, query parameters, fragments and alternate hosts are rejected. The existing normalizer creates the canonical repo key.
- `snapshot`: full head SHA, capture instant and `analysis_time` or `submission_time`. A link submitted earlier must not be described as a submission-time snapshot unless actually captured then.
- `period`: explicit offset/UTC start and end instants with `startAt < endAt`, and a valid timezone.
- `scheduledProjectDates`: valid local calendar dates, or null when unavailable. Duplicate dates are deduplicated; dates outside the local period bounds are rejected. Empty schedules produce unavailable density/coverage rather than division by zero.
- `identity`: explicit GitHub logins and optional commit-email aliases for matching. No identity means unavailable student metrics, not repository totals mislabeled student work. Email aliases never appear in the generated report.
- `baseline`: applied/not_supplied/unavailable and a reference. Applied means the caller has established the baseline policy; the pure builder does not compare template source itself.
- `exclusions`: known supplied commit SHAs, bot logins and exact directory/file prefixes. These are retained in the output. An excluded path does not imply every change to a supplied source file should be removed.
- `coverage`: separate history/file complete/partial/unavailable states and preserved notes.
- `events`: existing normalized engine events. Commit records require full SHAs; unrelated reviews/PRs do not count as commits. Conflicting duplicate commit evidence is rejected. Events from another repo/branch are rejected.

No new repository privileges are needed for this phase. Inputs using synthetic fixtures must be labeled synthetic by their consumer.

## Eligibility and metric definitions

The builder counts each included commit SHA once, filters known excluded commits/bots and dated records outside the half-open period, matches the declared student identity and removes excluded file changes. A generated-only commit is excluded only when its file list is known complete. If a partial list shows only excluded files, retain the commit with partial status because omitted files could contain eligible changes. A mixed commit retains its included source changes. Changes to supplied files remain unless the caller's explicit baseline policy excludes that specific evidence.

Missing author dates cannot prove period membership. Observed undated commits remain visible, with partial metric status and a note; they do not acquire invented timeline dates. No effort, time-worked or attendance inference follows from these counts.

| Field | Value and denominator |
| --- | --- |
| `metrics.studentCommits` | Number of included, attributable commit SHAs |
| `metrics.commitDensity` | Included commit count / supplied scheduled project dates |
| `metrics.scheduledDayCoverage` | Scheduled dates with at least one included dated commit / supplied scheduled dates |
| `metrics.busiestDayShare` | Largest local-day included commit count / included commit count |

Each metric contains `value`, `numerator`, `denominator`, `status` and `reason`. Coverage and busiest-day shares use 0–1 units; density uses commits per project day and may exceed one. Measured ratios require positive denominators and numerator/denominator consistency; commit counts must be whole counts. Values are rounded to four decimals; the UI can display 1.3 or 67%. A metric with status `unavailable` has a null value. Partial values describe incomplete evidence or uncertain exclusions and require an explanation; they are not exact totals, guaranteed lower bounds or confidence probabilities. When commits exist but every author date is missing, day coverage and busiest-day share are unavailable rather than zero.

Commits outside the schedule but inside the period still contribute to total count, density and busiest-day share; `activity.outsideScheduleCommitCount` identifies them. Scheduled-day coverage only counts supplied dates. A verified empty, fully collected period has count/density/coverage zero and undefined busiest-day share. Unknown collection or identity does not produce a false zero count. A missing baseline marks observed counts partial because supplied history may remain.

## Timeline, heatmap and evidence

- `commits` includes SHA, message, canonical commit URL, UTC-normalized author timestamp, public GitHub login, included file changes and observed addition/deletion totals. It omits commit emails. Commit order is chronological; unknown dates remain explicit.
- `timeline` groups dated included commit SHAs by local day in the supplied timezone.
- `heatmap` provides file identifiers and sparse commit/file cells. A complete report permits absent cells to mean no included change. Partial/unavailable file evidence never permits missing cells to be treated as verified zeros.
- `coverage` and `baseline` travel with the report. Consumers must display material limitations near related metrics/claims, not bury them in metadata.
- `pushActivity` is explicitly unavailable with reason `push_events_not_collected` in this phase. Commit time is not push time. Future observations need their own versioned collection/deduplication semantics; a GitHub App is deferred.

## Interpretation and editable feedback

The builder returns `interpretation.status: not_requested`, no generator and empty observations/feedback. Live model generation is not implemented or required to verify metrics.

The schema reserves a separate interpretation object:

- State: not_requested, available or failed.
- Generator provenance for an available interpretation: provider, model identifier and prompt version.
- Observations: stable ID, strength/improvement/review_question/limitation, text and supporting commit/file references.
- Every non-limitation observation needs at least one evidence reference. References must resolve to commits/files in this report; duplicates and dangling references are rejected.
- A feedback draft contains text and supporting observation IDs, validated against the observation list.
- Failed/unrequested interpretation cannot contain generated observations or feedback.

Reference validation does not establish that a model's prose is true. Future generation must evaluate support, respect partial coverage, treat repo text as untrusted input and leave review with the teacher. Consumer edits/published feedback should be stored separately from the immutable generated original. Pika owns that review/Return behavior for its integrated flow.

## Executable example and verification

```sh
npm run report:sample --silent
npm test -- tests/report/report.test.ts
```

The fictional `fixtures/reports/sky-hop.ts` reproduces 12 commits, density 1.3333, scheduled coverage 6/9 (0.6667), busiest-day share 3/12 (0.25), six timeline days and seven heatmap files. Push observations remain unavailable even though the visual concept used invented pushes.

Tests additionally cover duplicates, unrelated authors, reviews, period-end exclusion, timezone/weekend attribution, unknown schedules, zero activity, baseline/bot/path exclusions, edits to supplied files, partial/unknown evidence, conflicting records, private-email omission, chronological ordering across offsets and interpretation reference validation.

The local public-report flow now feeds this contract through a separate snapshot-pinned, coverage-aware method on the existing collector. Rule feedback is a versioned sidecar and does not populate the reserved AI interpretation field. See [PUBLIC-REPORTS.md](PUBLIC-REPORTS.md) for the executable HTTP/UI flow and limits. A hosted v2 HTTP API still requires tenant-scoped authentication and durable jobs, rather than exposing the existing shared-service-user auth as a SaaS boundary.


## Contributor bundle contract 1.0

The existing student-specific v2 report remains supported unchanged. A separate bundle (`schemaVersion: 1.0`) exposes scope-neutral repository and contributor reports without relabeling repository totals as student work. Its executable schemas/types are in `src/lib/report/bundle-contract.ts`.

A bundle contains shared `context` (repository, snapshot, period, schedule, baseline, exclusions and metrics version), `collectionCoverage`, requested-user `selection`, a repository `overview`, and every included `contributors` entry. Each scope has `facts` and scope-specific rule feedback (`rulesVersion: 1.1.0`). Scope metrics use `commits`, not `studentCommits`. Timeline, heatmap, coverage, unavailable push timing and optional interpretation retain their evidence semantics.

The public repository request uses one optional `githubUsername`. Missing/blank input chooses the overview. A normalized linked-account match chooses that contributor; malformed input or no included match chooses the overview with an explicit notice. A missing match describes collected evidence within the period/exclusion policy, not whether an account exists. The owner of a repository is never implicitly selected as the student. Shared dates/timezone, baseline and exclusion limits remain enforced.

Collection runs once per analysis. Eligible evidence is partitioned: each included commit belongs to exactly one contributor and the overview reconciles with their disjoint union. Linked commits group by normalized GitHub login; distinct logins never merge because their email/name strings match. Unlinked commits group internally by known normalized email and use public opaque bucket refs; missing login and email form an explicitly uncertain unknown-author bucket that may represent several people. Email values and raw identity keys are never exported. Unlinked bucket refs are stable for the same collected snapshot, not promises of persistent person identity across changing history. The old v2 input retains its explicit email-alias matching; the new whole-repository bundle does not infer account ownership or silently attach unlinked authors to linked accounts.

GitHub account type metadata labels users/bots when available; this does not verify who operated the account. Bots are visible and included unless an explicit exclusion removes them; repository totals must not be described as human/student-only work. Missing/conflicting account metadata remains unknown.

Teacher edits are a consumer-owned map keyed by scope. Switching scope, summary or evidence preserves them; explicit restore changes only that scope; a new analysis gets a new edit map. JSON export retains the complete bundle and keyed edits regardless of visible scope. No AI generation is required for this contract.
