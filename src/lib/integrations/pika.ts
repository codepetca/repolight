import { z } from 'zod'
import { ApiError } from '@/lib/api'
import { normalizeCommitEmails, normalizeGitHubLogin, makeRepositoryTarget } from '@/lib/engine/repo'
import type { ParsedRunCsv } from '@/lib/engine/csv'
import type { ContributorGrade, ContributorMetrics } from '@/lib/engine/types'
import type { CreateRunFromParsedInput, RunResults } from '@/lib/runs/service'

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

export interface PikaResult {
  external_student_id: string
  contributor_id: string
  contributor_name: string
  github_login: string | null
  score_completion: number
  score_thinking: number
  score_workflow: number
  percent: number
  letter: string
  achievement: string
  feedback: string
  confidence: number
  evidence_summary: string
  warnings: string[]
  metrics: ContributorMetrics
  grade: ContributorGrade
}

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

export function toPikaResults(results: RunResults): { run: RunResults['run']; results: PikaResult[] } {
  return {
    run: results.run,
    results: results.contributors.map(({ metrics, grade }) => toPikaResult(metrics, grade)),
  }
}

export function serializePikaResultsCsv(results: RunResults): string {
  const header = [
    'external_student_id',
    'contributor_name',
    'github_login',
    'score_completion',
    'score_thinking',
    'score_workflow',
    'percent',
    'letter',
    'achievement',
    'confidence',
    'evidence_summary',
    'warnings',
  ]

  const rows = toPikaResults(results).results.map((result) => [
    result.external_student_id,
    result.contributor_name,
    result.github_login || '',
    String(result.score_completion),
    String(result.score_thinking),
    String(result.score_workflow),
    String(result.percent),
    result.letter,
    result.achievement,
    String(result.confidence),
    result.evidence_summary,
    result.warnings.join('; '),
  ])

  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
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

function toPikaResult(metrics: ContributorMetrics, grade: ContributorGrade): PikaResult {
  return {
    external_student_id: metrics.contributorId,
    contributor_id: metrics.contributorId,
    contributor_name: metrics.name,
    github_login: metrics.githubLogin,
    score_completion: scorePercent(metrics.impactScore),
    score_thinking: scorePercent(metrics.qualityScore),
    score_workflow: scorePercent(metrics.workflowScore),
    percent: grade.absolutePercent,
    letter: grade.letterGrade,
    achievement: achievementFor(metrics),
    feedback: feedbackFor(metrics),
    confidence: metrics.confidence,
    evidence_summary: evidenceSummaryFor(metrics),
    warnings: metrics.warnings.map((warning) => warning.message),
    metrics,
    grade,
  }
}

function achievementFor(metrics: ContributorMetrics): string {
  if (metrics.commitCount === 0) return 'Ready to Start'
  if (metrics.qualityScore >= 0.75) return 'Iteration Pro'
  if (metrics.workflowScore >= 0.75) return 'Steady Builder'
  if (metrics.impactScore >= 0.85) return 'Strong Builder'
  if (metrics.sessionCount >= 4) return 'Persistent Builder'
  return 'Emerging Builder'
}

function feedbackFor(metrics: ContributorMetrics): string {
  if (metrics.commitCount === 0) {
    return 'No matching commits were found for this run. The next step is to commit work from the GitHub account or email connected to the assignment.'
  }

  const strength = strongestComponent(metrics)
  const nextStep = weakestComponent(metrics)
  return [
    `You have ${metrics.commitCount} matching commit(s) across ${metrics.activeDays} active day(s).`,
    strengthMessage(strength),
    nextStepMessage(nextStep),
  ].join(' ')
}

function strongestComponent(metrics: ContributorMetrics): 'impact' | 'workflow' | 'quality' {
  return componentEntries(metrics).sort((left, right) => right[1] - left[1])[0]?.[0] || 'impact'
}

function weakestComponent(metrics: ContributorMetrics): 'impact' | 'workflow' | 'quality' {
  return componentEntries(metrics).sort((left, right) => left[1] - right[1])[0]?.[0] || 'workflow'
}

function componentEntries(metrics: ContributorMetrics): Array<['impact' | 'workflow' | 'quality', number]> {
  return [
    ['impact', metrics.impactScore],
    ['workflow', metrics.workflowScore],
    ['quality', metrics.qualityScore],
  ]
}

function strengthMessage(component: 'impact' | 'workflow' | 'quality'): string {
  if (component === 'impact') return 'Your strongest evidence is the amount of meaningful project work you produced.'
  if (component === 'quality') return 'Your strongest evidence is iteration: debugging, refactoring, tests, or improvements.'
  return 'Your strongest evidence is workflow: spreading work across sessions instead of leaving everything to the end.'
}

function nextStepMessage(component: 'impact' | 'workflow' | 'quality'): string {
  if (component === 'impact') return 'Next time, aim for a few more meaningful feature or bug-fix commits.'
  if (component === 'quality') return 'Next time, add commits that show refinement, debugging, cleanup, or testing.'
  return 'Next time, commit progress over more days or work sessions so the process is easier to see.'
}

function evidenceSummaryFor(metrics: ContributorMetrics): string {
  if (metrics.evidence.length === 0) return 'No matched commit evidence.'
  return metrics.evidence
    .slice(0, 3)
    .map((item) => item.title)
    .join(' | ')
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
  return `${input.externalSystem}:${assignmentKey}:${input.startAt}:${input.endAt}:${studentsKey}`
}

function listFromValue(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value
  return (value || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean)
}

function scorePercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'student'
}

function escapeCsvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
