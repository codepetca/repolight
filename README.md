# Repocat

Repocat is a small standalone Next.js app for CSV-driven public GitHub repository contribution analysis. It ports the deterministic Pika repo-review engine into an isolated `src/lib/engine` module and stores raw normalized events so rubric changes can recalculate grades without fetching GitHub again.

## Stack

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
5. Optionally set `REPOCAT_API_KEY` to enable server-to-server access under `/api/v1`.
6. Install dependencies and migrate:

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
GET  /api/v1/runs/:id/export.csv
```

Results include Pika-friendly `score_completion`, `score_thinking`, `score_workflow`, `percent`, `letter`, `achievement`, deterministic `feedback`, confidence, evidence, warnings, and the full Repocat metrics.
