import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api'
import { normalizeCommitEmails, normalizeGitHubLogin, makeRepositoryTarget } from '@/lib/engine/repo'
import type { ParsedRunCsv } from '@/lib/engine/csv'
import type { CreateRunFromParsedInput } from '@/lib/runs/service'

const studentSchema = z.object({
  external_student_id: z.string().trim().optional(),
  student_id: z.string().trim().optional(),
  contributor_id: z.string().trim().optional(),
  name: z.string().trim().optional(),
  contributor_name: z.string().trim().optional(),
  github_login: z.string().trim().nullable().optional(),
  commit_emails: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  email: z.string().trim().nullable().optional(),
  repo_url: z.string().trim().min(1, 'Each student must include repo_url.'),
  default_branch: z.string().trim().nullable().optional(),
  group: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
})

export const pikaCreateRunSchema = z.object({
  external_system: z.string().trim().optional(),
  external_assignment_id: z.string().trim().optional(),
  external_classroom_id: z.string().trim().optional(),
  external_run_key: z.string().trim().optional(),
  idempotency_key: z.string().trim().optional(),
  assignment_title: z.string().trim().optional(),
  name: z.string().trim().optional(),
  start_at: z.string().trim().optional(),
  startAt: z.string().trim().optional(),
  end_at: z.string().trim().optional(),
  endAt: z.string().trim().optional(),
  timezone: z.string().trim().default('America/Toronto'),
  rubric: z.any().optional(),
  external_metadata: z.record(z.string(), z.unknown()).optional(),
  students: z.array(studentSchema).min(1, 'At least one student is required.').max(250),
}).refine((value) => value.start_at || value.startAt, {
  message: 'start_at is required.',
}).refine((value) => value.end_at || value.endAt, {
  message: 'end_at is required.',
})

export type PikaCreateRunPayload = z.infer<typeof pikaCreateRunSchema>

export function buildPikaCreateRunInput(payload: PikaCreateRunPayload): CreateRunFromParsedInput {
  const parsed = parsePikaStudents(payload.students)
  const startAt = payload.start_at || payload.startAt || ''
  const endAt = payload.end_at || payload.endAt || ''
  const externalSystem = payload.external_system || 'pika'
  const externalRunKey = payload.external_run_key || payload.idempotency_key || buildIdempotencyKey({
    externalSystem,
    externalAssignmentId: payload.external_assignment_id,
    assignmentTitle: payload.assignment_title,
    startAt,
    endAt,
    parsed,
  })

  return {
    name: payload.name || payload.assignment_title || `Pika import ${new Date().toISOString().slice(0, 10)}`,
    startAt,
    endAt,
    timezone: payload.timezone || 'America/Toronto',
    rubric: payload.rubric,
    parsed,
    externalSystem,
    externalRunKey,
    externalAssignmentId: payload.external_assignment_id || null,
    externalClassroomId: payload.external_classroom_id || null,
    externalMetadata: {
      ...(payload.external_metadata || {}),
      assignmentTitle: payload.assignment_title || null,
      source: 'api-v1',
    },
  }
}

function parsePikaStudents(students: PikaCreateRunPayload['students']): ParsedRunCsv {
  const contributors = new Map<string, ParsedRunCsv['contributors'][number]>()
  const repositories = new Map<string, ParsedRunCsv['repositories'][number]>()

  for (const [index, student] of students.entries()) {
    const rowNumber = index + 1
    const name = student.name || student.contributor_name
    if (!name) throw new ApiError(`Student ${rowNumber} must include name.`, 400)

    const githubLogin = normalizeGitHubLogin(student.github_login || '')
    const commitEmails = normalizeCommitEmails([
      ...listFromValue(student.commit_emails),
      ...(student.email ? [student.email] : []),
    ])
    if (!githubLogin && commitEmails.length === 0) {
      throw new ApiError(`Student ${rowNumber} must include github_login or commit_emails.`, 400)
    }

    const repository = makeRepositoryTarget(student.repo_url, student.default_branch || 'main')
    if (!repository) throw new ApiError(`Student ${rowNumber} has an invalid GitHub repo URL.`, 400)
    repositories.set(repository.key, repository)

    const contributorId = slugify(student.external_student_id || student.student_id || student.contributor_id || githubLogin || commitEmails[0] || name)
    const existing = contributors.get(contributorId)
    if (existing) {
      existing.repositoryKeys = [...new Set([...existing.repositoryKeys, repository.key])]
      existing.commitEmails = normalizeCommitEmails([...existing.commitEmails, ...commitEmails])
      existing.githubLogin = existing.githubLogin || githubLogin
    } else {
      contributors.set(contributorId, {
        contributorId,
        name,
        githubLogin,
        commitEmails,
        repositoryKeys: [repository.key],
        groupName: student.group || null,
        notes: student.notes || null,
      })
    }
  }

  if (contributors.size > 100 || repositories.size > 100) {
    throw new ApiError('V1 supports up to 100 contributors and 100 repositories per run.', 400)
  }

  return {
    contributors: [...contributors.values()],
    repositories: [...repositories.values()],
    warnings: [],
  }
}

function buildIdempotencyKey(input: {
  externalSystem: string
  externalAssignmentId?: string
  assignmentTitle?: string
  startAt: string
  endAt: string
  parsed: ParsedRunCsv
}): string {
  const assignmentKey = input.externalAssignmentId || slugify(input.assignmentTitle || 'assignment')
  const studentsKey = input.parsed.contributors
    .map((contributor) => `${contributor.contributorId}:${[...contributor.repositoryKeys].sort().join('+')}`)
    .sort()
    .join('|')
  const digest = createHash('sha256')
    .update(`${input.externalSystem}:${assignmentKey}:${input.startAt}:${input.endAt}:${studentsKey}`)
    .digest('hex')
    .slice(0, 32)
  return `${input.externalSystem}:${assignmentKey}:${digest}`
}

function listFromValue(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value
  return (value || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean)
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'student'
}
