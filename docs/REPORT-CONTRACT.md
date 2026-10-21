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

The builder counts each included commit SHA once, filters known excluded commits/bots and dated records outside the half-open period, matches the declared student identity and removes excluded file changes. A known generated-only commit is excluded. A mixed commit retains its included source changes. Changes to supplied files remain unless the caller's explicit baseline policy excludes that specific evidence.

Missing author dates cannot prove period membership. Observed undated commits remain visible, with partial metric status and a note; they do not acquire invented timeline dates. No effort, time-worked or attendance inference follows from these counts.

| Field | Value and denominator |
| --- | --- |
| `metrics.studentCommits` | Number of included, attributable commit SHAs |
| `metrics.commitDensity` | Included commit count / supplied scheduled project dates |
| `metrics.scheduledDayCoverage` | Scheduled dates with at least one included dated commit / supplied scheduled dates |
| `metrics.busiestDayShare` | Largest local-day included commit count / included commit count |

Each metric contains `value`, `numerator`, `denominator`, `status` and `reason`. Fractions use 0–1 units; density uses commits per project day. Values are rounded to four decimals; the UI can display 1.3 or 67%. A metric with status `unavailable` has a null value. Partial values describe the observed subset and require an explanation; they are not exact totals or confidence probabilities.

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

The next integration step is a snapshot-pinned, coverage-aware public collector feeding this contract. A v2 HTTP API should follow tenant-scoped authentication and durable job work, rather than exposing the existing shared-service-user auth as a SaaS boundary.
