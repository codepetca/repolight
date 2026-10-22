# Local public-repository reports

Open `/reports` on the loopback development server. The form accepts one public GitHub repository, explicit student GitHub login aliases, an inclusive calendar-date period/timezone, and optional scheduled project dates. The synthetic Sky Hop fixture remains available to tests and the offline `report:sample` command; it is not offered as a product demo. No AI service, database, GitHub App or sign-in is required. Reports are held in page memory; refreshing loses edits unless copied/downloaded.

The compact form shows the repository URL and “Student GitHub username.” The username is suggested from the repository owner and stays editable for organization/shared repositories; an explicit edit is preserved when the URL changes. This is a suggestion for commit attribution, not a verified identity. The UI defaults to branch `main` and the last 60 local calendar dates including today. Browser timezone detection falls back to `America/Toronto` (with daylight saving). “Options” contains branch, timezone, dates, project schedule and exclusions. These dates filter commit history; they do not configure cron or other scheduled work. A short default-period label remains beside Analyze, and the actual period is shown in the report. UI defaults do not change the API's explicit-period requirements or omitted-branch behavior.

Each completed report opens on a concise summary: the four core metrics, observed active days, generic-message share, up to three workflow findings, material limitations and an editable feedback draft. The configuration form is hidden after analysis; “Analyze another repository” reopens it with entered values intact. “View evidence” reveals source/collection metadata, the full timeline, file heatmap, commits and all rule observations. “Back to summary” preserves feedback edits. Each new analysis returns to the summary. Missing evidence stays unavailable/partial in both views; generic-message share is a rule count, not an AI-authorship score. JSON export always includes the full evidence, original rule feedback and separate teacher edits regardless of the visible view.

Branding uses the shared `Brand` component across login, report and authenticated headers, with no tagline. The login form keeps its accessible name and action button without a separate large mode heading.

## Collection and reuse

`analyzePublicRepository` reuses repository normalization, existing `GitHubClient` transport, normalized engine events, and the v2 report builder. The new `collectPublicReportEvidence` method verifies public visibility (even with an optional existing server token), resolves the default/selected branch, freezes its head SHA and lists history from that SHA. It does not use date filtering on GitHub: author-date membership is applied by the builder after collection, avoiding confusion with committer timestamps. Branch movement during collection cannot change the chosen snapshot.

The bounded scan includes at most 250 history entries, including merges. Merges with multiple parents are omitted to avoid duplicate accounting; merge-resolution-only changes are not separately analyzed. When merges are omitted, their scanned count and this limitation persist in `coverage.notes`, visible in the UI and JSON. Complete coverage then refers to the declared non-merge scope, not all changes in merge resolutions. No early stop is based on date ordering. Hitting limits, repeated pagination entries, missing parent/date metadata and incomplete detail pages remain explicit limitations. This means large or old repositories can produce partial history even for a short requested period.

Details use six workers, up to 30 file pages/3000 files per commit, a 600-request collection budget, a two-minute deadline for starting requests and a 15-second per-request timeout. Detail failures retain the commit but mark file evidence partial; history failures abort instead of returning fabricated zeros. Redirects are rejected and upstream response bodies are not exposed. Collection does not execute repository code or fetch arbitrary URLs. The optional existing `GITHUB_TOKEN`/legacy aliases can raise the GitHub budget; no token is created or required. Anonymous requests can exhaust GitHub's shared-IP limit before these local caps.

This phase has no persistent evidence cache, durable jobs, cancellation/resume or push observations. Re-running recollects evidence. The legacy v1 collector remains separate; the shared transport now has timeouts, redirect rejection and sanitized failures.

## Metrics and graphs

The [v2 contract](REPORT-CONTRACT.md) defines commit count, density, scheduled-day coverage and busiest-day share. Timeline bars use local author dates; file heatmap cells aggregate observed additions + deletions by local date and path, with graduated intensity and numeric values. To bound browser rendering, the heatmap shows up to 50 matching file paths with a search filter; all evidence remains in JSON. Tables expose the evidence without depending on color or SVG. Incomplete evidence uses partial/unknown labels; missing cells never become verified zeros. Changed-line counts can include formatting, repeated edits and non-code files and do not measure value or effort.

The starter-history checkbox records a teacher-reviewed exclusion policy, not an automatic starter comparison. Without it the baseline is not established and metric claims remain partial. Explicit supplied commit SHAs, bot logins and file/directory prefixes travel with the report. The collector currently omits merges; student modifications to supplied source are otherwise retained unless explicitly excluded.

## Rule feedback v1.0.0

`buildRuleFeedback(report)` produces a separate `ruleFeedback` object. The AI `report.interpretation` remains `not_requested`. No model/provider credentials or calls are involved.

| Rule | Trigger and meaning |
| --- | --- |
| Activity | Observed included commits and dated days; records checkpoints, not time worked |
| Generic messages | At least 25% of included messages match an exact generic-label pattern such as update/fix/wip/polish; asks for specific descriptions, not grammar or message/diff agreement |
| Scheduled gap | At least 3 consecutive configured project dates without a dated commit, only with complete dated history; asks how work was recorded |
| Concentration | At least 4 included commits and at least 50% on one local day; asks about changes recorded together |
| Large change | One commit has at least 200 added/deleted lines and at least 50% of all included churn, only with available heatmap evidence; asks for a walkthrough and small modification |
| Limitations | Missing evidence/baseline, no matching commits and unavailable push timing |

Thresholds and exact generic labels live in `src/lib/report/rules.ts`. Rules are inspectable prompts, not validated measures of learning or misconduct. Large commits, gaps, polished code or regular commits cannot establish whether AI created most of a project. The report cannot observe uncommitted work, verify who operated the account or establish time spent.

`ruleFeedback` has `rulesVersion`, `observations` (ID, rule ID, kind, text, up to five supporting commit references), `summary` (observed active days, generic-message/message counts, longest scheduled gap or null), and `feedbackDraft`. Evidence links resolve to included commits. Missing-day questions rely additionally on the configured schedule/history coverage. The UI keeps teacher edits separate and exports `{report, ruleFeedback, teacherFeedback}`; copying feedback does not publish it or send it to a student.

## Local HTTP contract

`POST /api/reports/analyze` accepts JSON and returns `{report, ruleFeedback}`. Input:

```json
{
  "repositoryUrl": "https://github.com/owner/project",
  "githubLogins": ["student-login"],
  "period": {"startAt": "2026-10-05T04:00:00Z", "endAt": "2026-10-17T04:00:00Z", "timezone": "America/Toronto"},
  "scheduledProjectDates": ["2026-10-05", "2026-10-06"],
  "exclusions": {"commitShas": [], "pathPrefixes": [], "botLogins": []},
  "baselineReviewed": false
}
```

Optional `branch` defaults to GitHub's declared default branch. Optional `commitEmails` is an explicit matching aid available under the form's advanced settings, defaults to empty and is omitted from report output. Use known aliases when GitHub does not associate a commit with an account; missing GitHub logins are never assigned automatically to the repo owner. Period bounds are explicit instants and half-open. `periodFromDates` converts inclusive local dates, including DST, and rejects invalid/nonexistent midnight boundaries. No roster names are needed. Input is validated before networking: at most 366 elapsed days, 366 schedule entries, 20 login/email aliases, 250 excluded SHAs and 100 path/bot exclusions.

The route accepts only development loopback URLs and rejects production/nonlocal requests (403), cross-origin browser requests (403), non-JSON content (415), malformed/invalid input (400), bodies over 64 KiB (413) and overlapping collections in the same process (429). Collection failures return a sanitized error (502). Responses use `Cache-Control: no-store`. These are local-preview bounds, not authentication, multi-process quotas or tenant isolation. The page still renders in production, but live collection is deliberately disabled there. Do not expose a development server to make this a hosted API.

Existing dependency/authentication blockers in [RECOVERY.md](RECOVERY.md) remain. Hosted access, saved reports, Pika authentication/feedback import and optional AI generation are separate work.
