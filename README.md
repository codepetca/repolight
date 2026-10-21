# Repocat

Repocat is a small standalone Next.js app for classroom-shaped public GitHub repository contribution analysis. The deterministic analyzer lives in `src/lib/engine`, while Repocat Classroom adds classes, student repo mappings, assignment dashboards, and analysis handoff for tools such as Pika.

## Public-repository recovery and report contract

The current revival phase uses public repositories and preserves the existing app and v1 API. GitHub App setup is deferred. See [recovery status](docs/RECOVERY.md), [development commands](docs/DEVELOPMENT.md), [report contract v2](docs/REPORT-CONTRACT.md) and [revival plan](docs/REVIVAL-PLAN.md).

```sh
npm ci
npm test
npm run typecheck
npm run report:sample --silent
```

The sample emits a fictional report with deterministic commit count, density, scheduled-day coverage, busiest-day share, timeline and file heatmap evidence. No database, token, GitHub App or AI provider is required. The schema reserves evidence-linked interpretation/feedback but does not generate it yet. The legacy grading scores described below remain v1 behavior and are not included in the new report contract. Existing deployment blockers are documented in the recovery status.

## Existing stack

- Next.js App Router
- Neon Postgres
- Drizzle ORM and SQL migrations
- Cookie-session auth with email/password
- Deterministic TypeScript engine, no AI in v1 grading

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `DATABASE_URL` to a Neon Postgres connection string.
3. Set `SESSION_SECRET` to a random value with at least 32 characters.
4. Optionally set `GITHUB_TOKEN` to raise public GitHub API rate limits.
5. Optionally set GitHub App env vars to enable classroom repo provisioning:
   - `GITHUB_APP_ID`
   - `GITHUB_APP_INSTALLATION_ID`
   - `GITHUB_APP_PRIVATE_KEY`
6. Optionally set `GITHUB_WEBHOOK_SECRET` to enable signed GitHub webhook ingestion at `/api/github/webhooks`.
7. Optionally set `REPOCAT_API_KEY` to enable server-to-server access under `/api/v1`.
8. Install dependencies and migrate:

```bash
npm install
npm run db:migrate
npm run dev
```

## CSV Fields

Required:

- `repo_url`
- `contributor_name`
- At least one of `github_login` or `commit_emails`

Optional:

- `contributor_id`
- `default_branch`
- `group`
- `notes`

`commit_emails` may contain comma- or semicolon-separated addresses.

## Repocat Classroom MVP

The Classroom layer is intentionally small:

- Create a class with an optional GitHub org and default repo prefix.
- Create an assignment from a CSV of one repository per student.
- Track per-student repository status fields such as invite state, activity state, successful pushes, and first/last push timestamps.
- Create a normal Repocat analysis run from the classroom assignment mapping.

Classroom assignment CSV fields:

Required:

- `student_name` or `contributor_name`
- `repo_url`
- At least one of `github_login` or `commit_emails`

Optional:

- `student_id` or `contributor_id`
- `email`
- `default_branch`
- `group`
- `notes`

GitHub App repo provisioning can create each mapped student repo from the assignment template and invite the student with `push` access. The current workflow still keeps manual CSV import as the fallback path: each row supplies the intended repo URL/name, and the provisioning step creates that repo from the configured template.

The GitHub App needs repository administration access for org repo creation and collaborator management. Signed webhooks can update invite acceptance, successful pushes, branch creation, and opened PR activity.

## Server API

The `/api/v1` endpoints are for private server-to-server integrations such as Pika. They require:

```txt
Authorization: Bearer <REPOCAT_API_KEY>
```

Create a Pika-shaped run:

```http
POST /api/v1/runs
```

```json
{
  "external_assignment_id": "assignment-123",
  "external_classroom_id": "class-123",
  "assignment_title": "Dodge It Solo",
  "start_at": "2026-04-01T00:00:00-04:00",
  "end_at": "2026-04-27T23:59:59-04:00",
  "timezone": "America/Toronto",
  "students": [
    {
      "external_student_id": "student-123",
      "name": "Alex Lee",
      "github_login": "alex",
      "commit_emails": ["alex@example.com"],
      "repo_url": "https://github.com/org/repo"
    }
  ]
}
```

Then process and read results:

```http
GET  /api/v1/runs/:id
POST /api/v1/runs/:id/process
GET  /api/v1/runs/:id/results
GET  /api/v1/runs/:id/summary
GET  /api/v1/runs/:id/charts
GET  /api/v1/runs/:id/export.csv
```

Results use Repocat's canonical normalized analysis shape. Component scores are decimals from `0` to `1`; consuming apps decide how to map them into their own grading scale.

```json
{
  "contributors": [
    {
      "contributor": {
        "id": "student-123",
        "name": "Alex Lee",
        "github_login": "alex"
      },
      "activity": {
        "commit_count": 7,
        "active_days": 4,
        "session_count": 4,
        "burst_ratio": 0.1
      },
      "contribution": {
        "weighted_contribution": 9,
        "relative_contribution_share": 1,
        "semantic_breakdown": {}
      },
      "component_scores": {
        "impact": 0.9,
        "workflow": 0.7,
        "quality": 0.82,
        "collaboration": 0
      },
      "grade_suggestion": {
        "raw_score": 0.82,
        "cohort_relative_score": 1,
        "percent": 91,
        "letter": "A"
      },
      "confidence": {
        "value": 0.8,
        "warnings": []
      },
      "achievement": "Iteration Pro",
      "feedback": "Deterministic evidence-based feedback.",
      "evidence": []
    }
  ]
}
```

`/summary` returns the same normalized signals with a simplified feedback comment for each contributor:

```json
{
  "contributors": [
    {
      "contributor": {
        "id": "student-123",
        "name": "Alex Lee",
        "github_login": "alex"
      },
      "achievement": "Iteration Pro",
      "component_scores": {
        "impact": 0.9,
        "workflow": 0.7,
        "quality": 0.82,
        "collaboration": 0
      },
      "strengths": ["meaningful project impact", "visible iteration and refinement"],
      "next_step": "Add commits that clearly show debugging, testing, cleanup, or refinement.",
      "feedback_comment": "Repocat found 7 matching commit(s) across 4 active day(s) and 4 work session(s). Strongest evidence: meaningful project impact, visible iteration and refinement. Achievement: Iteration Pro. Next step: Add commits that clearly show debugging, testing, cleanup, or refinement. Confidence: 80%."
    }
  ]
}
```

`/charts` returns chart-ready data for common views:

- `impact_workflow_scatter`
- `component_comparison`
- `semantic_breakdown_stacked`
- `timelines`
- `cohort_benchmarks`

For Pika, the recommended mapping is:

```ts
score_completion = Math.round(component_scores.impact * 10)
score_thinking = Math.round(component_scores.quality * 10)
score_workflow = Math.round(component_scores.workflow * 10)
```
