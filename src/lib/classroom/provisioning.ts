import { parseGitHubRepoReference } from '@/lib/engine/repo'
import type { AddCollaboratorInput, CreateRepositoryFromTemplateInput, ProvisionedGitHubRepository } from '@/lib/classroom/github-app'

export interface ProvisioningSettingsInput {
  githubOrg: string | null
  templateRepoUrl: string | null
  repoVisibility: string
}

export interface ProvisioningSettings {
  owner: string
  templateOwner: string
  templateRepo: string
  private: boolean
}

export interface ProvisioningClient {
  createRepositoryFromTemplate(input: CreateRepositoryFromTemplateInput): Promise<ProvisionedGitHubRepository>
  addCollaborator(input: AddCollaboratorInput): Promise<void>
}

export interface ProvisioningRepositoryInput {
  id: string
  name: string
  branch: string
  student: {
    githubLogin: string | null
  }
}

export interface ProvisioningRepositoryResult {
  repositoryId: string
  ok: boolean
  repoUrl: string | null
  branch: string
  invitationStatus: 'invited' | 'failed'
  activityStatus: 'not_started'
  error: string | null
}

export function buildProvisioningSettings(input: ProvisioningSettingsInput): ProvisioningSettings {
  const owner = input.githubOrg?.trim().replace(/^@/, '')
  if (!owner) {
    throw new Error('A GitHub org is required before provisioning repositories.')
  }

  const template = input.templateRepoUrl ? parseGitHubRepoReference(input.templateRepoUrl) : null
  if (!template) {
    throw new Error('A valid GitHub template repo is required before provisioning repositories.')
  }

  return {
    owner,
    templateOwner: template.owner,
    templateRepo: template.name,
    private: input.repoVisibility !== 'public',
  }
}

export async function provisionClassroomRepository(input: {
  client: ProvisioningClient
  settings: ProvisioningSettings
  repository: ProvisioningRepositoryInput
}): Promise<ProvisioningRepositoryResult> {
  const githubLogin = input.repository.student.githubLogin?.trim().replace(/^@/, '')
  if (!githubLogin) {
    return failedResult(input.repository, 'Student is missing a GitHub login.')
  }

  try {
    const repository = await input.client.createRepositoryFromTemplate({
      templateOwner: input.settings.templateOwner,
      templateRepo: input.settings.templateRepo,
      owner: input.settings.owner,
      name: input.repository.name,
      private: input.settings.private,
    })

    await input.client.addCollaborator({
      owner: input.settings.owner,
      repo: input.repository.name,
      username: githubLogin,
      permission: 'push',
    })

    return {
      repositoryId: input.repository.id,
      ok: true,
      repoUrl: repository.htmlUrl,
      branch: repository.defaultBranch || input.repository.branch,
      invitationStatus: 'invited',
      activityStatus: 'not_started',
      error: null,
    }
  } catch (error) {
    return failedResult(input.repository, error instanceof Error ? error.message : 'Repository provisioning failed.')
  }
}

function failedResult(repository: ProvisioningRepositoryInput, error: string): ProvisioningRepositoryResult {
  return {
    repositoryId: repository.id,
    ok: false,
    repoUrl: null,
    branch: repository.branch,
    invitationStatus: 'failed',
    activityStatus: 'not_started',
    error,
  }
}
