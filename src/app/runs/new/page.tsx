'use client'

import { ChangeEvent, FormEvent, useMemo, useState } from 'react'
import { Upload, Play } from 'lucide-react'
import { useRouter } from 'next/navigation'

const SAMPLE_CSV = `repo_url,contributor_name,github_login,commit_emails,default_branch,group,notes
https://github.com/acme/example,Alex Lee,alexlee,alex@example.com,main,Team A,
https://github.com/acme/example,Sam Cruz,samcruz,sam@example.com,main,Team A,`

export default function NewRunPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [csvText, setCsvText] = useState(SAMPLE_CSV)
  const [timezone, setTimezone] = useState('America/Toronto')
  const [startDate, setStartDate] = useState(() => formatDateInput(Date.now() - 14 * 24 * 60 * 60 * 1000))
  const [endDate, setEndDate] = useState(() => formatDateInput(Date.now()))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const rowCount = useMemo(() => csvText.trim().split(/\r?\n/).filter(Boolean).length - 1, [csvText])

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setCsvText(await file.text())
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          csvText,
          timezone,
          startAt: new Date(`${startDate}T00:00:00`).toISOString(),
          endAt: new Date(`${endDate}T23:59:59`).toISOString(),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to create run.')
      router.push(`/runs/${payload.run.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create run.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">New Analysis Run</h1>
            <p className="page-subtitle">Paste or upload a CSV with public GitHub repos and contributor identities.</p>
          </div>
        </div>

        <form className="stack" onSubmit={submit}>
          {error && <div className="alert">{error}</div>}
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Run Settings</h2>
              <span className="badge">{Math.max(rowCount, 0)} CSV rows</span>
            </div>
            <div className="panel-body stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="run-name">Run name</label>
                  <input id="run-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Spring project review" />
                </div>
                <div className="field">
                  <label htmlFor="timezone">Timezone</label>
                  <input id="timezone" className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="start-date">Start date</label>
                  <input id="start-date" className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="end-date">End date</label>
                  <input id="end-date" className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Contributor CSV</h2>
              <label className="button secondary">
                <Upload size={16} aria-hidden="true" />
                Upload CSV
                <input type="file" accept=".csv,text/csv" onChange={readFile} hidden />
              </label>
            </div>
            <div className="panel-body stack">
              <div className="notice">Required columns: repo_url, contributor_name, and github_login or commit_emails.</div>
              <textarea className="textarea" value={csvText} onChange={(event) => setCsvText(event.target.value)} spellCheck={false} />
            </div>
          </section>

          <div className="toolbar">
            <button className="button" type="submit" disabled={submitting}>
              <Play size={16} aria-hidden="true" />
              {submitting ? 'Creating...' : 'Create Run'}
            </button>
            <button className="button secondary" type="button" onClick={() => router.push('/')}>Cancel</button>
          </div>
        </form>
      </div>
    </main>
  )
}

function formatDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
