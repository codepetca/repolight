import { createSign } from 'node:crypto'

const GITHUB_API_BASE = 'https://api.github.com'

export type GitHubAppFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface GitHubAppConfig {
  appId: string
  installationId: string
  privateKey: string
  apiBaseUrl: string
}

export interface GitHubAppClientOptions {
  config?: GitHubAppConfig
  fetchImpl?: GitHubAppFetch
  jwtFactory?: (config: GitHubAppConfig) => string
}

export interface CreateRepositoryFromTemplateInput {
  templateOwner: string
  templateRepo: string
  owner: string
  name: string
  private: boolean
}

export interface ProvisionedGitHubRepository {
  fullName: string
  htmlUrl: string
  defaultBranch: string
}

export interface AddCollaboratorInput {
  owner: string
  repo: string
  username: string
  permission?: 'pull' | 'push' | 'maintain' | 'admin' | 'triage'
}

type InstallationTokenResponse = {
  token?: string
}

type RepositoryResponse = {
  full_name?: string
  html_url?: string
  default_branch?: string
}

export function loadGitHubAppConfig(env: Record<string, string | undefined> = process.env): GitHubAppConfig {
  const appId = env.GITHUB_APP_ID?.trim()
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim()
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim().replace(/\\n/g, '\n')
  const missing = [
    !appId && 'GITHUB_APP_ID',
    !installationId && 'GITHUB_APP_INSTALLATION_ID',
    !privateKey && 'GITHUB_APP_PRIVATE_KEY',
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(`Missing GitHub App env vars: ${missing.join(', ')}`)
  }

  return {
    appId: appId!,
    installationId: installationId!,
    privateKey: privateKey!,
    apiBaseUrl: env.GITHUB_APP_API_BASE_URL?.trim() || GITHUB_API_BASE,
  }
}

export class GitHubAppClient {
  private readonly config: GitHubAppConfig
  private readonly fetchImpl: GitHubAppFetch
  private readonly jwtFactory: (config: GitHubAppConfig) => string
  private installationToken: string | null = null

  constructor(opts: GitHubAppClientOptions = {}) {
    this.config = opts.config || loadGitHubAppConfig()
    this.fetchImpl = opts.fetchImpl || fetch
    this.jwtFactory = opts.jwtFactory || createGitHubAppJwt
  }

  async createInstallationToken(): Promise<string> {
    const response = await this.request<InstallationTokenResponse>(
      `/app/installations/${encodeURIComponent(this.config.installationId)}/access_tokens`,
      {
        method: 'POST',
        authToken: this.jwtFactory(this.config),
      },
    )
    if (!response.token) {
      throw new Error('GitHub App did not return an installation token.')
    }
    this.installationToken = response.token
    return response.token
  }

  async createRepositoryFromTemplate(input: CreateRepositoryFromTemplateInput): Promise<ProvisionedGitHubRepository> {
    const token = await this.getInstallationToken()
    let response: RepositoryResponse
    try {
      response = await this.request<RepositoryResponse>(
        `/repos/${encodeURIComponent(input.templateOwner)}/${encodeURIComponent(input.templateRepo)}/generate`,
        {
          method: 'POST',
          authToken: token,
          body: JSON.stringify({
            owner: input.owner,
            name: input.name,
            private: input.private,
            include_all_branches: false,
          }),
        },
      )
    } catch (error) {
      if (!(error instanceof GitHubAppRequestError) || error.status !== 422) throw error
      response = await this.request<RepositoryResponse>(
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`,
        {
          method: 'GET',
          authToken: token,
        },
      )
    }

    return {
      fullName: response.full_name || `${input.owner}/${input.name}`,
      htmlUrl: response.html_url || `https://github.com/${input.owner}/${input.name}`,
      defaultBranch: response.default_branch || 'main',
    }
  }

  async addCollaborator(input: AddCollaboratorInput): Promise<void> {
    const token = await this.getInstallationToken()
    await this.request<void>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/collaborators/${encodeURIComponent(input.username)}`,
      {
        method: 'PUT',
        authToken: token,
        body: JSON.stringify({ permission: input.permission || 'push' }),
        allowEmptyResponse: true,
      },
    )
  }

  private async getInstallationToken(): Promise<string> {
    if (this.installationToken) return this.installationToken
    return this.createInstallationToken()
  }

  private async request<T>(
    path: string,
    opts: {
      method: string
      authToken: string
      body?: string
      allowEmptyResponse?: boolean
    },
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
      method: opts.method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${opts.authToken}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: opts.body,
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new GitHubAppRequestError(response.status, text || response.statusText)
    }

    if (opts.allowEmptyResponse || response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }
}

export class GitHubAppRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`GitHub App request failed (${status}): ${message}`)
    this.name = 'GitHubAppRequestError'
  }
}

export function createGitHubAppJwt(config: GitHubAppConfig, nowMs = Date.now()): string {
  const issuedAt = Math.floor(nowMs / 1000) - 60
  const expiresAt = issuedAt + 9 * 60
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iat: issuedAt,
    exp: expiresAt,
    iss: config.appId,
  })
  const unsignedToken = `${header}.${payload}`
  const signature = createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(config.privateKey, 'base64url')

  return `${unsignedToken}.${signature}`
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
