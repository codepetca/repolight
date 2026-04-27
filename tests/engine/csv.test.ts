import { describe, expect, it } from 'vitest'
import { parseRunCsv } from '@/lib/engine/csv'

describe('parseRunCsv', () => {
  it('builds contributors and de-duplicates shared repositories', () => {
    const parsed = parseRunCsv(`repo_url,contributor_name,github_login,commit_emails,default_branch
https://github.com/acme/app,Alex Lee,alex,alex@example.com,main
https://github.com/acme/app,Sam Cruz,sam,sam@example.com,main
https://github.com/acme/api,Alex Lee,alex,alex@school.edu,develop`)

    expect(parsed.repositories).toHaveLength(2)
    expect(parsed.contributors).toHaveLength(2)
    const alex = parsed.contributors.find((contributor) => contributor.githubLogin === 'alex')
    expect(alex?.repositoryKeys).toEqual(['acme/app#main', 'acme/api#develop'])
    expect(alex?.commitEmails).toEqual(['alex@example.com', 'alex@school.edu'])
  })

  it('warns about rows missing contributor identity', () => {
    const parsed = parseRunCsv(`repo_url,contributor_name,github_login,commit_emails
https://github.com/acme/app,Sam Cruz,sam,sam@example.com
https://github.com/acme/app,Alex Lee,,`)

    expect(parsed.contributors).toHaveLength(1)
    expect(parsed.warnings.some((warning) => warning.code === 'csv-missing-identity')).toBe(true)
  })

  it('rejects uploads with no valid rows', () => {
    expect(() => parseRunCsv('repo_url,contributor_name\n,')).toThrow('CSV must contain at least one contributor row')
  })
})
