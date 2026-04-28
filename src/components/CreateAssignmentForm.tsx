'use client'

import { ChangeEvent, FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Upload } from 'lucide-react'

const SAMPLE_ASSIGNMENT_CSV = `student_name,email,github_login,repo_url,default_branch,group,notes
Alex Lee,alex@example.com,alexlee,https://github.com/yrdsb-peths/dodge-it-solo-alexlee,main,Period 2,
Sam Cruz,sam@example.com,samcruz,https://github.com/yrdsb-peths/dodge-it-solo-samcruz,main,Period 2,`

export function CreateAssignmentForm({ classroomId }: { classroomId: string }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [templateRepoUrl, setTemplateRepoUrl] = useState('')
  const [repoPrefix, setRepoPrefix] = useState('')
  const [repoVisibility, setRepoVisibility] = useState('private')
  const [timezone, setTimezone] = useState('America/Toronto')
  const [startDate, setStartDate] = useState(() => formatDateInput(Date.now() - 14 * 24 * 60 * 60 * 1000))
  const [dueDate, setDueDate] = useState(() => formatDateInput(Date.now()))
  const [csvText, setCsvText] = useState(SAMPLE_ASSIGNMENT_CSV)
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
      const response = await fetch(`/api/classrooms/${classroomId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          templateRepoUrl,
          repoPrefix,
          repoVisibility,
          timezone,
          csvText,
          startAt: new Date(`${startDate}T00:00:00`).toISOString(),
          dueAt: new Date(`${dueDate}T23:59:59`).toISOString(),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to create assignment.')
      router.push(`/classrooms/${classroomId}/assignments/${payload.assignment.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assignment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">New Assignment</h2>
          <span className="badge">{Math.max(rowCount, 0)} CSV rows</span>
        </div>
        <div className="panel-body stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="assignment-title">Title</label>
              <input id="assignment-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dodge It Solo" required />
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
              <label htmlFor="due-date">Due date</label>
              <input id="due-date" className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="template-repo">Template repo</label>
              <input id="template-repo" className="input" value={templateRepoUrl} onChange={(event) => setTemplateRepoUrl(event.target.value)} placeholder="https://github.com/org/template" />
            </div>
            <div className="field">
              <label htmlFor="repo-prefix">Repo prefix</label>
              <input id="repo-prefix" className="input" value={repoPrefix} onChange={(event) => setRepoPrefix(event.target.value)} placeholder="dodge-it-solo" />
            </div>
            <div className="field">
              <label htmlFor="visibility">Repo visibility</label>
              <select id="visibility" className="select" value={repoVisibility} onChange={(event) => setRepoVisibility(event.target.value)}>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Students And Repos</h2>
          <label className="button secondary">
            <Upload size={16} aria-hidden="true" />
            Upload CSV
            <input type="file" accept=".csv,text/csv" onChange={readFile} hidden />
          </label>
        </div>
        <div className="panel-body stack">
          <div className="notice">Required columns for the manual MVP: student_name, repo_url, and github_login or commit_emails. One repository per student.</div>
          <textarea className="textarea" value={csvText} onChange={(event) => setCsvText(event.target.value)} spellCheck={false} />
        </div>
      </section>

      <div className="toolbar">
        <button className="button" type="submit" disabled={submitting}>
          <ClipboardList size={16} aria-hidden="true" />
          {submitting ? 'Creating...' : 'Create Assignment'}
        </button>
      </div>
    </form>
  )
}

function formatDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
