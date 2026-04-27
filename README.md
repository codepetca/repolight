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
5. Install dependencies and migrate:

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
