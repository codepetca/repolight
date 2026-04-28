import { describe, expect, it, vi } from 'vitest'
import {
  buildProvisioningSettings,
  provisionClassroomRepository,
} from '@/lib/classroom/provisioning'

describe('buildProvisioningSettings', () => {
  it('extracts template, owner, and visibility for GitHub provisioning', () => {
    expect(buildProvisioningSettings({
      githubOrg: '@yrdsb-peths',
      templateRepoUrl: 'https://github.com/yrdsb-peths/starter',
      repoVisibility: 'private',
    })).toEqual({
      owner: 'yrdsb-peths',
      templateOwner: 'yrdsb-peths',
      templateRepo: 'starter',
      private: true,
    })
  })

  it('requires a GitHub org and template repository', () => {
    expect(() => buildProvisioningSettings({
      githubOrg: null,
      templateRepoUrl: 'https://github.com/yrdsb-peths/starter',
      repoVisibility: 'private',
    })).toThrow('GitHub org')

    expect(() => buildProvisioningSettings({
      githubOrg: 'yrdsb-peths',
      templateRepoUrl: null,
      repoVisibility: 'private',
    })).toThrow('template repo')
  })
})

describe('provisionClassroomRepository', () => {
  it('creates a repo from template and invites the student with push access', async () => {
    const client = {
      createRepositoryFromTemplate: vi.fn().mockResolvedValue({
        fullName: 'yrdsb-peths/dodge-it-solo-alex',
        htmlUrl: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
        defaultBranch: 'main',
      }),
      addCollaborator: vi.fn().mockResolvedValue(undefined),
    }

    const result = await provisionClassroomRepository({
      client,
      settings: {
        owner: 'yrdsb-peths',
        templateOwner: 'yrdsb-peths',
        templateRepo: 'starter',
        private: true,
      },
      repository: {
        id: 'repo-1',
        name: 'dodge-it-solo-alex',
        branch: 'main',
        student: {
          githubLogin: 'alex',
        },
      },
    })

    expect(client.createRepositoryFromTemplate).toHaveBeenCalledWith({
      templateOwner: 'yrdsb-peths',
      templateRepo: 'starter',
      owner: 'yrdsb-peths',
      name: 'dodge-it-solo-alex',
      private: true,
    })
    expect(client.addCollaborator).toHaveBeenCalledWith({
      owner: 'yrdsb-peths',
      repo: 'dodge-it-solo-alex',
      username: 'alex',
      permission: 'push',
    })
    expect(result).toEqual({
      repositoryId: 'repo-1',
      ok: true,
      repoUrl: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
      branch: 'main',
      invitationStatus: 'invited',
      activityStatus: 'not_started',
      error: null,
    })
  })

  it('fails one repository cleanly when the student has no GitHub login', async () => {
    const client = {
      createRepositoryFromTemplate: vi.fn(),
      addCollaborator: vi.fn(),
    }

    const result = await provisionClassroomRepository({
      client,
      settings: {
        owner: 'yrdsb-peths',
        templateOwner: 'yrdsb-peths',
        templateRepo: 'starter',
        private: true,
      },
      repository: {
        id: 'repo-1',
        name: 'dodge-it-solo-alex',
        branch: 'main',
        student: {
          githubLogin: null,
        },
      },
    })

    expect(client.createRepositoryFromTemplate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      repositoryId: 'repo-1',
      ok: false,
      invitationStatus: 'failed',
      error: 'Student is missing a GitHub login.',
    })
  })
})
