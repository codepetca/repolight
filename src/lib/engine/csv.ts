import Papa from 'papaparse'
import { makeRepositoryTarget, normalizeCommitEmails, normalizeGitHubLogin } from '@/lib/engine/repo'
import type { ContributorIdentity, RepositoryTarget, RunWarning } from '@/lib/engine/types'

export interface ParsedRunCsv {
  contributors: ContributorIdentity[]
  repositories: RepositoryTarget[]
  warnings: RunWarning[]
}

type CsvRecord = Record<string, string | undefined>

export function parseRunCsv(csvText: string): ParsedRunCsv {
  const parsed = Papa.parse<CsvRecord>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    transform: (value) => value.trim(),
  })

  const warnings: RunWarning[] = []
  if (parsed.errors.length > 0) {
    warnings.push(...parsed.errors.map((error) => ({
      code: 'csv-parse-warning',
      message: `CSV row ${error.row ?? '?'}: ${error.message}`,
    })))
  }

  const repositories = new Map<string, RepositoryTarget>()
  const contributors = new Map<string, ContributorIdentity>()
  const rows = parsed.data.filter((row) => Object.values(row).some(Boolean))

  if (rows.length === 0) {
    throw new Error('CSV must contain at least one contributor row.')
  }
  if (rows.length > 250) {
    throw new Error('CSV contains too many rows for v1. Keep the upload to 250 rows or fewer.')
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const repoUrl = valueFor(row, 'repo_url')
    const contributorName = valueFor(row, 'contributor_name')
    const githubLogin = normalizeGitHubLogin(valueFor(row, 'github_login'))
    const commitEmails = normalizeCommitEmails(splitList(valueFor(row, 'commit_emails')))
    const branch = valueFor(row, 'default_branch') || 'main'

    if (!repoUrl) {
      warnings.push({ code: 'csv-missing-repo', message: `Row ${rowNumber} is missing repo_url.` })
      return
    }
    if (!contributorName) {
      warnings.push({ code: 'csv-missing-name', message: `Row ${rowNumber} is missing contributor_name.` })
      return
    }
    if (!githubLogin && commitEmails.length === 0) {
      warnings.push({ code: 'csv-missing-identity', message: `Row ${rowNumber} must include github_login or commit_emails.` })
      return
    }

    const repository = makeRepositoryTarget(repoUrl, branch)
    if (!repository) {
      warnings.push({ code: 'csv-invalid-repo', message: `Row ${rowNumber} has an invalid GitHub repo URL: ${repoUrl}.` })
      return
    }
    repositories.set(repository.key, repository)

    const explicitContributorId = valueFor(row, 'contributor_id')
    const identityKey = explicitContributorId || githubLogin || commitEmails[0] || contributorName
    const contributorId = slugify(identityKey)
    const existing = contributors.get(contributorId)
    if (existing) {
      existing.repositoryKeys = [...new Set([...existing.repositoryKeys, repository.key])]
      existing.commitEmails = normalizeCommitEmails([...existing.commitEmails, ...commitEmails])
      existing.githubLogin = existing.githubLogin || githubLogin
    } else {
      contributors.set(contributorId, {
        contributorId,
        name: contributorName,
        githubLogin,
        commitEmails,
        repositoryKeys: [repository.key],
        groupName: valueFor(row, 'group') || null,
        notes: valueFor(row, 'notes') || null,
      })
    }
  })

  if (contributors.size === 0 || repositories.size === 0) {
    throw new Error('CSV did not contain any valid contributor/repository rows.')
  }

  if (contributors.size > 100 || repositories.size > 100) {
    throw new Error('V1 supports up to 100 contributors and 100 repositories per run.')
  }

  return {
    contributors: [...contributors.values()],
    repositories: [...repositories.values()],
    warnings,
  }
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_')
}

function valueFor(row: CsvRecord, key: string): string {
  return (row[key]?.trim() || '')
}

function splitList(value: string): string[] {
  return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean)
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `contributor-${Math.random().toString(36).slice(2, 8)}`
}
