'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { School } from 'lucide-react'

export function CreateClassroomForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [term, setTerm] = useState('')
  const [githubOrg, setGithubOrg] = useState('')
  const [defaultRepoPrefix, setDefaultRepoPrefix] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch('/api/classrooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          term,
          githubOrg,
          defaultRepoPrefix,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to create class.')
      router.push(`/classrooms/${payload.classroom.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create class.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Class Settings</h2>
        </div>
        <div className="panel-body stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="class-name">Class name</label>
              <input id="class-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="ICS4U Period 2" required />
            </div>
            <div className="field">
              <label htmlFor="term">Term</label>
              <input id="term" className="input" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Spring 2026" />
            </div>
            <div className="field">
              <label htmlFor="github-org">GitHub org</label>
              <input id="github-org" className="input" value={githubOrg} onChange={(event) => setGithubOrg(event.target.value)} placeholder="yrdsb-peths" />
            </div>
            <div className="field">
              <label htmlFor="repo-prefix">Default repo prefix</label>
              <input id="repo-prefix" className="input" value={defaultRepoPrefix} onChange={(event) => setDefaultRepoPrefix(event.target.value)} placeholder="dodge-it-solo" />
            </div>
          </div>
          <div className="notice">This MVP starts with manual repo CSVs. GitHub App repo creation will use the org and prefix later.</div>
        </div>
      </section>

      <div className="toolbar">
        <button className="button" type="submit" disabled={submitting}>
          <School size={16} aria-hidden="true" />
          {submitting ? 'Creating...' : 'Create Class'}
        </button>
        <button className="button secondary" type="button" onClick={() => router.push('/classrooms')}>Cancel</button>
      </div>
    </form>
  )
}
