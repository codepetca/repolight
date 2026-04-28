import Papa from 'papaparse'
import { makeRepositoryTarget, normalizeCommitEmails, normalizeGitHubLogin } from '@/lib/engine/repo'
import type { ContributorIdentity, RepositoryTarget, RunWarning } from '@/lib/engine/types'

export interface ClassroomAssignmentCsvRow {
  contributorId: string
  name: string
  email: string | null
  githubLogin: string | null
  commitEmails: string[]
  groupName: string | null
  notes: string | null
  repository: RepositoryTarget
}

export interface ParsedClassroomAssignmentCsv {
  contributors: ContributorIdentity[]
  repositories: RepositoryTarget[]
  rows: ClassroomAssignmentCsvRow[]
  warnings: RunWarning[]
}

type CsvRecord = Record<string, string | undefined>

export function parseClassroomAssignmentCsv(csvText: string): ParsedClassroomAssignmentCsv {
  const parsed = Papa.parse<CsvRecord>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    transform: (value) => value.trim(),
  })

  const warnings: RunWarning[] = []
  if (parsed.errors.length > 0) {
    warnings.push(...parsed.errors.map((error) => ({
      code: 'classroom-csv-parse-warning',
      message: `CSV row ${error.row ?? '?'}: ${error.message}`,
    })))
  }

  const contributors = new Map<string, ContributorIdentity>()
  const repositories = new Map<string, RepositoryTarget>()
  const rows: ClassroomAssignmentCsvRow[] = []
  const dataRows = parsed.data.filter((row) => Object.values(row).some(Boolean))

  if (dataRows.length === 0) {
    throw new Error('CSV must contain at least one student repository row.')
  }
  if (dataRows.length > 250) {
    throw new Error('CSV contains too many rows for v1. Keep the upload to 250 rows or fewer.')
  }

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2
    const repoUrl = valueFor(row, 'repo_url')
    const name = valueFor(row, 'student_name') || valueFor(row, 'contributor_name') || valueFor(row, 'name')
    const email = valueFor(row, 'email') || null
    const githubLogin = normalizeGitHubLogin(valueFor(row, 'github_login'))
    const commitEmails = normalizeCommitEmails(splitList(valueFor(row, 'commit_emails')))
    const branch = valueFor(row, 'default_branch') || 'main'

    if (!repoUrl) {
      warnings.push({ code: 'classroom-csv-missing-repo', message: `Row ${rowNumber} is missing repo_url.` })
      return
    }
    if (!name) {
      warnings.push({ code: 'classroom-csv-missing-name', message: `Row ${rowNumber} is missing student_name or contributor_name.` })
      return
    }
    if (!githubLogin && commitEmails.length === 0) {
      warnings.push({ code: 'classroom-csv-missing-identity', message: `Row ${rowNumber} must include github_login or commit_emails.` })
      return
    }

    const repository = makeRepositoryTarget(repoUrl, branch)
    if (!repository) {
      warnings.push({ code: 'classroom-csv-invalid-repo', message: `Row ${rowNumber} has an invalid GitHub repo URL: ${repoUrl}.` })
      return
    }

    const explicitId = valueFor(row, 'student_id') || valueFor(row, 'contributor_id')
    const contributorId = slugify(explicitId || githubLogin || email || commitEmails[0] || name)
    const groupName = valueFor(row, 'group') || null
    const notes = valueFor(row, 'notes') || null
    const existing = contributors.get(contributorId)

    repositories.set(repository.key, repository)
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
        groupName,
        notes,
      })
    }

    rows.push({
      contributorId,
      name,
      email,
      githubLogin,
      commitEmails,
      groupName,
      notes,
      repository,
    })
  })

  if (contributors.size === 0 || repositories.size === 0 || rows.length === 0) {
    throw new Error('CSV did not contain any valid student repository rows.')
  }

  const multiRepoContributor = [...contributors.values()].find((contributor) => contributor.repositoryKeys.length > 1)
  if (multiRepoContributor) {
    throw new Error(`Classroom assignments support one repository per student in v1. ${multiRepoContributor.name} appears more than once.`)
  }

  if (repositories.size !== rows.length) {
    throw new Error('Classroom assignments support one student per repository in v1. Two or more rows reference the same repository.')
  }

  if (contributors.size > 100 || repositories.size > 100) {
    throw new Error('V1 supports up to 100 students and 100 repositories per assignment.')
  }

  return {
    contributors: [...contributors.values()],
    repositories: [...repositories.values()],
    rows,
    warnings,
  }
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_')
}

function valueFor(row: CsvRecord, key: string): string {
  return row[key]?.trim() || ''
}

function splitList(value: string): string[] {
  return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean)
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `student-${Math.random().toString(36).slice(2, 8)}`
}
