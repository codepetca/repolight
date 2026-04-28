import type { ContributorIdentity, RepositoryTarget, RunWarning } from '@/lib/engine/types'

export interface ClassroomRunStudent {
  id: string
  externalStudentId: string | null
  name: string
  email: string | null
  githubLogin: string | null
  commitEmails: string[]
  groupName: string | null
  notes: string | null
}

export interface ClassroomRunRepository {
  repositoryKey: string
  repoUrl: string
  owner: string
  name: string
  branch: string
  student: ClassroomRunStudent
}

export interface ClassroomRunSource {
  repositories: ClassroomRunRepository[]
}

export function buildAssignmentRunParsedInput(source: ClassroomRunSource): {
  contributors: ContributorIdentity[]
  repositories: RepositoryTarget[]
  warnings: RunWarning[]
} {
  return {
    contributors: source.repositories.map((repository) => ({
      contributorId: stableContributorId(repository.student),
      name: repository.student.name,
      githubLogin: repository.student.githubLogin,
      commitEmails: repository.student.commitEmails,
      repositoryKeys: [repository.repositoryKey],
      groupName: repository.student.groupName,
      notes: repository.student.notes,
    })),
    repositories: source.repositories.map((repository) => ({
      key: repository.repositoryKey,
      provider: 'github',
      repoUrl: repository.repoUrl,
      owner: repository.owner,
      name: repository.name,
      branch: repository.branch,
    })),
    warnings: [],
  }
}

function stableContributorId(student: ClassroomRunStudent): string {
  return student.externalStudentId || student.githubLogin || student.email || student.id
}
