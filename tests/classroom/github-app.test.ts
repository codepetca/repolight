import { describe, expect, it, vi } from 'vitest'
import {
  GitHubAppClient,
  loadGitHubAppConfig,
} from '@/lib/classroom/github-app'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('loadGitHubAppConfig', () => {
  it('normalizes required GitHub App env vars', () => {
    const config = loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    })

    expect(config).toMatchObject({
      appId: '123',
      installationId: '456',
    })
    expect(config.privateKey).toContain('\nabc\n')
  })

  it('fails clearly when GitHub App env vars are missing', () => {
    expect(() => loadGitHubAppConfig({})).toThrow('GITHUB_APP_ID')
    expect(() => loadGitHubAppConfig({
      GITHUB_APP_ID: '123',
      GITHUB_APP_INSTALLATION_ID: '456',
    })).toThrow('GITHUB_APP_PRIVATE_KEY')
  })
})

describe('GitHubAppClient', () => {
  it('creates an installation token using an app JWT', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: 'installation-token' }))
    const client = new GitHubAppClient({
      config: {
        appId: '123',
        installationId: '456',
        privateKey: 'private-key',
        apiBaseUrl: 'https://api.github.test',
      },
      fetchImpl,
      jwtFactory: () => 'signed-jwt',
    })

    await expect(client.createInstallationToken()).resolves.toBe('installation-token')
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.test/app/installations/456/access_tokens', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer signed-jwt',
      }),
    }))
  })

  it('creates a repository from a template with an installation token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token' }))
      .mockResolvedValueOnce(jsonResponse({
        full_name: 'yrdsb-peths/dodge-it-solo-alex',
        html_url: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
        default_branch: 'main',
      }, 201))
    const client = new GitHubAppClient({
      config: {
        appId: '123',
        installationId: '456',
        privateKey: 'private-key',
        apiBaseUrl: 'https://api.github.test',
      },
      fetchImpl,
      jwtFactory: () => 'signed-jwt',
    })

    const repo = await client.createRepositoryFromTemplate({
      templateOwner: 'yrdsb-peths',
      templateRepo: 'starter',
      owner: 'yrdsb-peths',
      name: 'dodge-it-solo-alex',
      private: true,
    })

    expect(repo).toEqual({
      fullName: 'yrdsb-peths/dodge-it-solo-alex',
      htmlUrl: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
      defaultBranch: 'main',
    })
    expect(fetchImpl).toHaveBeenLastCalledWith('https://api.github.test/repos/yrdsb-peths/starter/generate', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer installation-token',
      }),
      body: JSON.stringify({
        owner: 'yrdsb-peths',
        name: 'dodge-it-solo-alex',
        private: true,
        include_all_branches: false,
      }),
    }))
  })

  it('adds a student collaborator with push access', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token' }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const client = new GitHubAppClient({
      config: {
        appId: '123',
        installationId: '456',
        privateKey: 'private-key',
        apiBaseUrl: 'https://api.github.test',
      },
      fetchImpl,
      jwtFactory: () => 'signed-jwt',
    })

    await client.addCollaborator({
      owner: 'yrdsb-peths',
      repo: 'dodge-it-solo-alex',
      username: 'alex',
      permission: 'push',
    })

    expect(fetchImpl).toHaveBeenLastCalledWith('https://api.github.test/repos/yrdsb-peths/dodge-it-solo-alex/collaborators/alex', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ permission: 'push' }),
    }))
  })

  it('treats an already-created repository as an idempotent success', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token' }))
      .mockResolvedValueOnce(new Response('already exists', { status: 422, statusText: 'Unprocessable Entity' }))
      .mockResolvedValueOnce(jsonResponse({
        full_name: 'yrdsb-peths/dodge-it-solo-alex',
        html_url: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
        default_branch: 'main',
      }))
    const client = new GitHubAppClient({
      config: {
        appId: '123',
        installationId: '456',
        privateKey: 'private-key',
        apiBaseUrl: 'https://api.github.test',
      },
      fetchImpl,
      jwtFactory: () => 'signed-jwt',
    })

    await expect(client.createRepositoryFromTemplate({
      templateOwner: 'yrdsb-peths',
      templateRepo: 'starter',
      owner: 'yrdsb-peths',
      name: 'dodge-it-solo-alex',
      private: true,
    })).resolves.toEqual({
      fullName: 'yrdsb-peths/dodge-it-solo-alex',
      htmlUrl: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
      defaultBranch: 'main',
    })
    expect(fetchImpl).toHaveBeenLastCalledWith('https://api.github.test/repos/yrdsb-peths/dodge-it-solo-alex', expect.objectContaining({
      method: 'GET',
    }))
  })

  it('surfaces GitHub API failures with status and body text', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token' }))
      .mockResolvedValueOnce(new Response('server failed', { status: 500, statusText: 'Server Error' }))
    const client = new GitHubAppClient({
      config: {
        appId: '123',
        installationId: '456',
        privateKey: 'private-key',
        apiBaseUrl: 'https://api.github.test',
      },
      fetchImpl,
      jwtFactory: () => 'signed-jwt',
    })

    await expect(client.createRepositoryFromTemplate({
      templateOwner: 'yrdsb-peths',
      templateRepo: 'starter',
      owner: 'yrdsb-peths',
      name: 'dodge-it-solo-alex',
      private: true,
    })).rejects.toThrow('GitHub App request failed (500): server failed')
  })
})
