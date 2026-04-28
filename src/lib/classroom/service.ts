import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  analysisRuns,
  classroomActivityEvents,
  classroomAssignments,
  classroomRepositories,
  classrooms,
  classroomStudents,
  type Classroom,
  type ClassroomAssignment,
  type ClassroomRepository,
  type ClassroomStudent,
} from '@/db/schema'
import { normalizeCommitEmails, normalizeGitHubLogin } from '@/lib/engine/repo'
import { normalizeRubric } from '@/lib/engine/rubric'
import type { RubricConfig } from '@/lib/engine/types'
import { createRunFromParsed } from '@/lib/runs/service'
import { buildAssignmentRunParsedInput } from '@/lib/classroom/analysis'
import { parseClassroomAssignmentCsv } from '@/lib/classroom/csv'
import { GitHubAppClient } from '@/lib/classroom/github-app'
import {
  buildProvisioningSettings,
  provisionClassroomRepository,
  type ProvisioningClient,
  type ProvisioningRepositoryResult,
} from '@/lib/classroom/provisioning'
import type { ClassroomWebhookUpdate } from '@/lib/classroom/webhooks'

export interface ClassroomSummary {
  id: string
  name: string
  term: string | null
  githubOrg: string | null
  defaultRepoPrefix: string | null
  studentCount: number
  assignmentCount: number
  createdAt: string
  updatedAt: string
}

export interface ClassroomDetail extends Omit<ClassroomSummary, 'studentCount' | 'assignmentCount'> {
  students: ClassroomStudentResponse[]
  assignments: ClassroomAssignmentSummary[]
}

export interface ClassroomStudentResponse {
  id: string
  externalStudentId: string | null
  name: string
  email: string | null
  githubLogin: string | null
  commitEmails: string[]
  groupName: string | null
  notes: string | null
}

export interface ClassroomAssignmentSummary {
  id: string
  classroomId: string
  analysisRunId: string | null
  title: string
  status: string
  templateRepoUrl: string | null
  repoPrefix: string | null
  repoVisibility: string
  startAt: string
  dueAt: string
  timezone: string
  repositoryCount: number
  createdAt: string
  updatedAt: string
}

export interface ClassroomAssignmentDetail extends ClassroomAssignmentSummary {
  classroom: {
    id: string
    name: string
    githubOrg: string | null
  }
  repositories: ClassroomRepositoryResponse[]
  analysisRun: {
    id: string
    status: string
    totalRepositories: number
    processedRepositories: number
    failedRepositories: number
  } | null
}

export interface ClassroomRepositoryResponse {
  id: string
  student: ClassroomStudentResponse
  repositoryKey: string
  repoUrl: string
  owner: string
  name: string
  branch: string
  invitationStatus: string
  activityStatus: string
  successfulPushCount: number
  firstPushAt: string | null
  lastPushAt: string | null
  lastError: string | null
}

export interface CreateClassroomInput {
  name: string
  term?: string | null
  githubOrg?: string | null
  defaultRepoPrefix?: string | null
}

export interface CreateClassroomAssignmentInput {
  title: string
  csvText: string
  startAt: string
  dueAt: string
  timezone?: string
  templateRepoUrl?: string | null
  repoPrefix?: string | null
  repoVisibility?: string | null
  rubric?: Partial<RubricConfig>
}

export async function listClassrooms(userId: string): Promise<ClassroomSummary[]> {
  const database = getDb()
  const rows = await database
    .select()
    .from(classrooms)
    .where(eq(classrooms.userId, userId))
    .orderBy(desc(classrooms.createdAt))
    .limit(30)

  return Promise.all(rows.map(async (classroom) => {
    const [students, assignments] = await Promise.all([
      database.select().from(classroomStudents).where(eq(classroomStudents.classroomId, classroom.id)),
      database.select().from(classroomAssignments).where(eq(classroomAssignments.classroomId, classroom.id)),
    ])
    return {
      ...toClassroomSummary(classroom),
      studentCount: students.length,
      assignmentCount: assignments.length,
    }
  }))
}

export async function createClassroom(userId: string, input: CreateClassroomInput): Promise<ClassroomDetail> {
  const name = input.name.trim()
  if (!name) throw new Error('Class name is required.')

  const [classroom] = await getDb().insert(classrooms).values({
    userId,
    name,
    term: normalizedOptional(input.term),
    githubOrg: normalizedGithubOrg(input.githubOrg),
    defaultRepoPrefix: normalizedOptional(input.defaultRepoPrefix),
  }).returning()

  if (!classroom) throw new Error('Failed to create class.')
  return getClassroomDetail(userId, classroom.id)
}

export async function getClassroomDetail(userId: string, classroomId: string): Promise<ClassroomDetail> {
  const classroom = await getClassroomForUser(userId, classroomId)
  const database = getDb()
  const [students, assignments, repositories] = await Promise.all([
    database.select().from(classroomStudents).where(eq(classroomStudents.classroomId, classroom.id)).orderBy(asc(classroomStudents.name)),
    database.select().from(classroomAssignments).where(eq(classroomAssignments.classroomId, classroom.id)).orderBy(desc(classroomAssignments.createdAt)),
    database
      .select({
        id: classroomRepositories.id,
        assignmentId: classroomRepositories.assignmentId,
      })
      .from(classroomRepositories)
      .innerJoin(classroomAssignments, eq(classroomRepositories.assignmentId, classroomAssignments.id))
      .where(eq(classroomAssignments.classroomId, classroom.id)),
  ])

  return {
    ...toClassroomSummary(classroom),
    students: students.map(toStudentResponse),
    assignments: assignments.map((assignment) => toAssignmentSummary(
      assignment,
      repositories.filter((repository) => repository.assignmentId === assignment.id).length,
    )),
  }
}

export async function createClassroomAssignment(
  userId: string,
  classroomId: string,
  input: CreateClassroomAssignmentInput,
): Promise<ClassroomAssignmentDetail> {
  const classroom = await getClassroomForUser(userId, classroomId)
  const title = input.title.trim()
  if (!title) throw new Error('Assignment title is required.')
  const startAt = normalizeIso(input.startAt, 'startAt')
  const dueAt = normalizeIso(input.dueAt, 'dueAt')
  if (new Date(startAt).getTime() > new Date(dueAt).getTime()) {
    throw new Error('startAt must be before dueAt.')
  }

  const parsed = parseClassroomAssignmentCsv(input.csvText)
  const rubric = normalizeRubric(input.rubric)
  const database = getDb()

  const [assignment] = await database.insert(classroomAssignments).values({
    classroomId: classroom.id,
    title,
    status: 'ready',
    templateRepoUrl: normalizedOptional(input.templateRepoUrl),
    repoPrefix: normalizedOptional(input.repoPrefix) || classroom.defaultRepoPrefix,
    repoVisibility: normalizedOptional(input.repoVisibility) || 'private',
    startAt,
    dueAt,
    timezone: input.timezone || 'America/Toronto',
    rubricJson: rubric,
  }).returning()

  if (!assignment) throw new Error('Failed to create assignment.')

  const studentByContributorId = new Map<string, ClassroomStudent>()
  for (const row of parsed.rows) {
    let student = studentByContributorId.get(row.contributorId)
    if (!student) {
      student = await upsertClassroomStudent(classroom.id, {
        externalStudentId: row.contributorId,
        name: row.name,
        email: row.email,
        githubLogin: row.githubLogin,
        commitEmails: row.commitEmails,
        groupName: row.groupName,
        notes: row.notes,
      })
      studentByContributorId.set(row.contributorId, student)
    }

    await database.insert(classroomRepositories).values({
      assignmentId: assignment.id,
      studentId: student.id,
      repositoryKey: row.repository.key,
      repoUrl: row.repository.repoUrl,
      owner: row.repository.owner,
      name: row.repository.name,
      branch: row.repository.branch,
      invitationStatus: 'manual',
      activityStatus: 'not_started',
      successfulPushCount: 0,
    })
  }

  return getClassroomAssignmentDetail(userId, classroom.id, assignment.id)
}

export async function getClassroomAssignmentDetail(
  userId: string,
  classroomId: string,
  assignmentId: string,
): Promise<ClassroomAssignmentDetail> {
  const classroom = await getClassroomForUser(userId, classroomId)
  const assignment = await getAssignmentInClassroom(classroom.id, assignmentId)
  const database = getDb()
  const [repositories, students, runRows] = await Promise.all([
    database.select().from(classroomRepositories).where(eq(classroomRepositories.assignmentId, assignment.id)).orderBy(asc(classroomRepositories.createdAt)),
    database.select().from(classroomStudents).where(eq(classroomStudents.classroomId, classroom.id)),
    assignment.analysisRunId
      ? database.select().from(analysisRuns).where(and(eq(analysisRuns.id, assignment.analysisRunId), eq(analysisRuns.userId, userId))).limit(1)
      : Promise.resolve([]),
  ])
  const studentsById = new Map(students.map((student) => [student.id, student]))
  const run = runRows[0]

  return {
    ...toAssignmentSummary(assignment, repositories.length),
    classroom: {
      id: classroom.id,
      name: classroom.name,
      githubOrg: classroom.githubOrg,
    },
    repositories: repositories.map((repository) => {
      const student = studentsById.get(repository.studentId)
      if (!student) throw new Error('Assignment repository is missing its student.')
      return toRepositoryResponse(repository, student)
    }),
    analysisRun: run ? {
      id: run.id,
      status: run.status,
      totalRepositories: run.totalRepositories,
      processedRepositories: run.processedRepositories,
      failedRepositories: run.failedRepositories,
    } : null,
  }
}

export async function createAnalysisRunForAssignment(
  userId: string,
  classroomId: string,
  assignmentId: string,
) {
  const classroom = await getClassroomForUser(userId, classroomId)
  const assignment = await getAssignmentInClassroom(classroom.id, assignmentId)
  const detail = await getClassroomAssignmentDetail(userId, classroom.id, assignment.id)

  if (detail.repositories.length === 0) {
    throw new Error('Assignment must have at least one student repository before analysis.')
  }

  const parsed = buildAssignmentRunParsedInput(detail)
  const run = await createRunFromParsed(userId, {
    name: `${classroom.name}: ${assignment.title}`,
    startAt: assignment.startAt,
    endAt: assignment.dueAt,
    timezone: assignment.timezone,
    rubric: assignment.rubricJson,
    externalSystem: 'repocat-classroom',
    externalRunKey: `assignment:${assignment.id}`,
    externalAssignmentId: assignment.id,
    externalClassroomId: classroom.id,
    externalMetadata: {
      classroom_name: classroom.name,
      assignment_title: assignment.title,
      source: 'repocat-classroom',
    },
    parsed,
  })

  await getDb().update(classroomAssignments)
    .set({
      analysisRunId: run.id,
      status: 'analysis_ready',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(classroomAssignments.id, assignment.id))

  return {
    assignment: await getClassroomAssignmentDetail(userId, classroom.id, assignment.id),
    run,
  }
}

export async function provisionAssignmentRepositories(
  userId: string,
  classroomId: string,
  assignmentId: string,
  opts: { client?: ProvisioningClient } = {},
): Promise<{
  assignment: ClassroomAssignmentDetail
  results: ProvisioningRepositoryResult[]
}> {
  const detail = await getClassroomAssignmentDetail(userId, classroomId, assignmentId)
  const settings = buildProvisioningSettings({
    githubOrg: detail.classroom.githubOrg,
    templateRepoUrl: detail.templateRepoUrl,
    repoVisibility: detail.repoVisibility,
  })
  const client = opts.client || new GitHubAppClient()
  const database = getDb()
  const now = new Date().toISOString()

  await database.update(classroomAssignments)
    .set({ status: 'provisioning', updatedAt: now })
    .where(eq(classroomAssignments.id, assignmentId))

  const results: ProvisioningRepositoryResult[] = []
  for (const repository of detail.repositories) {
    await database.update(classroomRepositories)
      .set({
        invitationStatus: 'provisioning',
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(classroomRepositories.id, repository.id))

    const result = await provisionClassroomRepository({
      client,
      settings,
      repository: {
        id: repository.id,
        name: repository.name,
        branch: repository.branch,
        student: {
          githubLogin: repository.student.githubLogin,
        },
      },
    })
    results.push(result)

    await database.update(classroomRepositories)
      .set({
        repoUrl: result.repoUrl || repository.repoUrl,
        owner: settings.owner,
        branch: result.branch,
        repositoryKey: `${settings.owner.toLowerCase()}/${repository.name.toLowerCase()}#${result.branch}`,
        invitationStatus: result.invitationStatus,
        activityStatus: result.activityStatus,
        lastError: result.error,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(classroomRepositories.id, repository.id))
  }

  const failed = results.some((result) => !result.ok)
  await database.update(classroomAssignments)
    .set({
      status: failed ? 'provisioning_failed' : 'provisioned',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(classroomAssignments.id, assignmentId))

  return {
    assignment: await getClassroomAssignmentDetail(userId, classroomId, assignmentId),
    results,
  }
}

export async function applyClassroomWebhookUpdate(
  update: ClassroomWebhookUpdate,
  payload: Record<string, unknown>,
): Promise<{
  ignored: boolean
  duplicate: boolean
  repositoryId: string | null
  message: string
}> {
  const [owner, name] = update.repositoryFullName.split('/')
  if (!owner || !name) {
    return { ignored: true, duplicate: false, repositoryId: null, message: 'Webhook payload did not include a valid repository full name.' }
  }

  const database = getDb()
  const [repository] = await database
    .select()
    .from(classroomRepositories)
    .where(and(
      eq(classroomRepositories.owner, owner),
      eq(classroomRepositories.name, name),
    ))
    .limit(1)

  if (!repository) {
    return { ignored: true, duplicate: false, repositoryId: null, message: 'No classroom repository matched the webhook repository.' }
  }

  const [student] = await database
    .select()
    .from(classroomStudents)
    .where(eq(classroomStudents.id, repository.studentId))
    .limit(1)

  if (!student) {
    return { ignored: true, duplicate: false, repositoryId: repository.id, message: 'Matched repository has no student.' }
  }

  if (
    update.eventType === 'member.added' &&
    update.githubLogin &&
    student.githubLogin &&
    update.githubLogin.toLowerCase() !== student.githubLogin.toLowerCase()
  ) {
    return { ignored: true, duplicate: false, repositoryId: repository.id, message: 'Member event did not match the assigned student.' }
  }

  const existing = await database
    .select()
    .from(classroomActivityEvents)
    .where(and(
      eq(classroomActivityEvents.assignmentId, repository.assignmentId),
      eq(classroomActivityEvents.eventType, update.eventType),
      eq(classroomActivityEvents.externalId, update.externalId),
    ))
    .limit(1)

  if (existing.length > 0) {
    return { ignored: false, duplicate: true, repositoryId: repository.id, message: 'Webhook delivery was already processed.' }
  }

  await database.insert(classroomActivityEvents).values({
    assignmentId: repository.assignmentId,
    repositoryId: repository.id,
    studentId: student.id,
    eventType: update.eventType,
    externalId: update.externalId,
    payloadJson: {
      summary: update.payloadSummary,
      payload,
    },
    occurredAt: update.occurredAt,
  })

  await database.update(classroomRepositories)
    .set({
      invitationStatus: update.repositoryPatch.invitationStatus || repository.invitationStatus,
      activityStatus: update.repositoryPatch.activityStatus || repository.activityStatus,
      successfulPushCount: repository.successfulPushCount + (update.repositoryPatch.incrementSuccessfulPushCount ? 1 : 0),
      firstPushAt: repository.firstPushAt || update.repositoryPatch.firstPushAt,
      lastPushAt: update.repositoryPatch.lastPushAt || repository.lastPushAt,
      lastWebhookAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(classroomRepositories.id, repository.id))

  return { ignored: false, duplicate: false, repositoryId: repository.id, message: 'Webhook processed.' }
}

async function getClassroomForUser(userId: string, classroomId: string): Promise<Classroom> {
  const [classroom] = await getDb()
    .select()
    .from(classrooms)
    .where(and(eq(classrooms.id, classroomId), eq(classrooms.userId, userId)))
    .limit(1)

  if (!classroom) throw new Error('Class not found.')
  return classroom
}

async function getAssignmentInClassroom(classroomId: string, assignmentId: string): Promise<ClassroomAssignment> {
  const [assignment] = await getDb()
    .select()
    .from(classroomAssignments)
    .where(and(eq(classroomAssignments.id, assignmentId), eq(classroomAssignments.classroomId, classroomId)))
    .limit(1)

  if (!assignment) throw new Error('Assignment not found.')
  return assignment
}

async function upsertClassroomStudent(
  classroomId: string,
  input: {
    externalStudentId: string
    name: string
    email: string | null
    githubLogin: string | null
    commitEmails: string[]
    groupName: string | null
    notes: string | null
  },
): Promise<ClassroomStudent> {
  const database = getDb()
  const normalizedLogin = normalizeGitHubLogin(input.githubLogin)
  const existingStudents = await database
    .select()
    .from(classroomStudents)
    .where(eq(classroomStudents.classroomId, classroomId))

  const existing = existingStudents.find((student) => (
    student.externalStudentId === input.externalStudentId ||
    (!!normalizedLogin && student.githubLogin === normalizedLogin)
  ))

  if (existing) {
    const [updated] = await database.update(classroomStudents)
      .set({
        externalStudentId: existing.externalStudentId || input.externalStudentId,
        name: input.name,
        email: input.email || existing.email,
        githubLogin: normalizedLogin || existing.githubLogin,
        commitEmails: normalizeCommitEmails([...(existing.commitEmails || []), ...input.commitEmails]),
        groupName: input.groupName || existing.groupName,
        notes: input.notes || existing.notes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(classroomStudents.id, existing.id))
      .returning()
    if (!updated) throw new Error('Failed to update student.')
    return updated
  }

  const [student] = await database.insert(classroomStudents).values({
    classroomId,
    externalStudentId: input.externalStudentId,
    name: input.name,
    email: input.email,
    githubLogin: normalizedLogin,
    commitEmails: normalizeCommitEmails(input.commitEmails),
    groupName: input.groupName,
    notes: input.notes,
  }).returning()

  if (!student) throw new Error('Failed to create student.')
  return student
}

function toClassroomSummary(classroom: Classroom): Omit<ClassroomSummary, 'studentCount' | 'assignmentCount'> {
  return {
    id: classroom.id,
    name: classroom.name,
    term: classroom.term,
    githubOrg: classroom.githubOrg,
    defaultRepoPrefix: classroom.defaultRepoPrefix,
    createdAt: classroom.createdAt,
    updatedAt: classroom.updatedAt,
  }
}

function toStudentResponse(student: ClassroomStudent): ClassroomStudentResponse {
  return {
    id: student.id,
    externalStudentId: student.externalStudentId,
    name: student.name,
    email: student.email,
    githubLogin: student.githubLogin,
    commitEmails: student.commitEmails || [],
    groupName: student.groupName,
    notes: student.notes,
  }
}

function toAssignmentSummary(assignment: ClassroomAssignment, repositoryCount: number): ClassroomAssignmentSummary {
  return {
    id: assignment.id,
    classroomId: assignment.classroomId,
    analysisRunId: assignment.analysisRunId,
    title: assignment.title,
    status: assignment.status,
    templateRepoUrl: assignment.templateRepoUrl,
    repoPrefix: assignment.repoPrefix,
    repoVisibility: assignment.repoVisibility,
    startAt: assignment.startAt,
    dueAt: assignment.dueAt,
    timezone: assignment.timezone,
    repositoryCount,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  }
}

function toRepositoryResponse(repository: ClassroomRepository, student: ClassroomStudent): ClassroomRepositoryResponse {
  return {
    id: repository.id,
    student: toStudentResponse(student),
    repositoryKey: repository.repositoryKey,
    repoUrl: repository.repoUrl,
    owner: repository.owner,
    name: repository.name,
    branch: repository.branch,
    invitationStatus: repository.invitationStatus,
    activityStatus: repository.activityStatus,
    successfulPushCount: repository.successfulPushCount,
    firstPushAt: repository.firstPushAt,
    lastPushAt: repository.lastPushAt,
    lastError: repository.lastError,
  }
}

function normalizeIso(value: string, field: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date/time.`)
  return date.toISOString()
}

function normalizedOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function normalizedGithubOrg(value: string | null | undefined): string | null {
  const normalized = normalizedOptional(value)
  return normalized?.replace(/^@/, '') || null
}
