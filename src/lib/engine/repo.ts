import type { RepositoryTarget } from '@/lib/engine/types'

export interface ParsedGitHubRepo {
  owner: string
  name: string
  normalizedUrl: string
}

const OWNER_RE = '[A-Za-z0-9_.-]+'
const REPO_RE = '[A-Za-z0-9_.-]+'

export function parseGitHubRepoReference(input: string): ParsedGitHubRepo | null {
  const value = input.trim()
  if (!value) return null

  const shorthand = new RegExp(`^(${OWNER_RE})\\/(${REPO_RE})(?:\\.git)?$`).exec(value)
  if (shorthand) {
    return buildParsedRepo(shorthand[1], shorthand[2])
  }

  const sshMatch = new RegExp(`github\\.com[:/](${OWNER_RE})\\/(${REPO_RE})(?:\\.git)?(?:[#/?].*)?$`, 'i').exec(value)
  if (sshMatch) {
    return buildParsedRepo(sshMatch[1], sshMatch[2])
  }

  try {
    const url = new URL(value)
    if (!/github\.com$/i.test(url.hostname)) return null
    const [owner, name] = url.pathname.replace(/^\/+/, '').split('/')
    if (!owner || !name) return null
    return buildParsedRepo(owner, name.replace(/\.git$/, ''))
  } catch {
    return null
  }
}

export function normalizeCommitEmails(emails: string[] | null | undefined): string[] {
  return [...new Set((emails || []).map((email) => email.trim().toLowerCase()).filter(Boolean))]
}

export function normalizeGitHubLogin(login: string | null | undefined): string | null {
  const value = login?.trim().replace(/^@/, '') || ''
  return value ? value.toLowerCase() : null
}

export function makeRepositoryKey(owner: string, name: string, branch: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}#${branch.trim() || 'main'}`
}

export function makeRepositoryTarget(repoUrl: string, defaultBranch?: string | null): RepositoryTarget | null {
  const parsed = parseGitHubRepoReference(repoUrl)
  if (!parsed) return null
  const branch = defaultBranch?.trim() || 'main'
  return {
    key: makeRepositoryKey(parsed.owner, parsed.name, branch),
    provider: 'github',
    repoUrl: parsed.normalizedUrl,
    owner: parsed.owner,
    name: parsed.name,
    branch,
  }
}

function buildParsedRepo(owner: string, name: string): ParsedGitHubRepo {
  const cleanedOwner = owner.trim()
  const cleanedName = name.trim().replace(/\.git$/, '')
  return {
    owner: cleanedOwner,
    name: cleanedName,
    normalizedUrl: `https://github.com/${cleanedOwner}/${cleanedName}`,
  }
}
