'use client'

import { useMemo, useState } from 'react'
import { Award, Download, Play, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { RunDetail, RunResults } from '@/lib/runs/service'
import type { ContributorMetrics, RubricConfig, SemanticBreakdown } from '@/lib/engine/types'
import { toRepocatSummary, type RepocatContributorSummary } from '@/lib/integrations/results'

type ResultRow = RunResults['contributors'][number]

export function RunWorkspace({
  initialRun,
  initialResults,
}: {
  initialRun: RunDetail
  initialResults: RunResults
}) {
  const [run, setRun] = useState(initialRun)
  const [results, setResults] = useState(initialResults)
  const [selectedId, setSelectedId] = useState(initialResults.contributors[0]?.metrics.contributorId || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const selected = useMemo(() => {
    return results.contributors.find((item) => item.metrics.contributorId === selectedId) || results.contributors[0] || null
  }, [results.contributors, selectedId])

  const summariesByContributor = useMemo(() => {
    return new Map(toRepocatSummary(results).contributors.map((summary) => [summary.contributor.id, summary]))
  }, [results])

  const selectedFeedback = selected ? summariesByContributor.get(selected.metrics.contributorId) || null : null

  const progress = run.totalRepositories === 0
    ? 0
    : Math.round(((run.processedRepositories + run.failedRepositories) / run.totalRepositories) * 100)

  async function refresh() {
    const [runResponse, resultsResponse] = await Promise.all([
      fetch(`/api/runs/${run.id}`),
      fetch(`/api/runs/${run.id}/results`),
    ])
    const runPayload = await runResponse.json()
    const resultsPayload = await resultsResponse.json()
    if (!runResponse.ok) throw new Error(runPayload.error || 'Failed to load run.')
    if (!resultsResponse.ok) throw new Error(resultsPayload.error || 'Failed to load results.')
    setRun(runPayload.run)
    setResults(resultsPayload)
    if (!selectedId && resultsPayload.contributors[0]) {
      setSelectedId(resultsPayload.contributors[0].metrics.contributorId)
    }
  }

  async function processLoop(retryFailed = false) {
    setBusy(true)
    setError('')
    setMessage(retryFailed ? 'Retrying failed repositories...' : 'Processing repositories...')
    try {
      let keepGoing = true
      let processed = 0
      let failed = 0
      while (keepGoing) {
        const response = await fetch(`/api/runs/${run.id}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retryFailed }),
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Processing failed.')
        setRun(payload.run)
        if (payload.processed) processed += 1
        if (payload.error) failed += 1
        keepGoing = Boolean(payload.hasMore) && !retryFailed
        await loadResultsOnly()
      }
      setMessage(`Processed ${processed} repositories${failed ? `, ${failed} failed` : ''}.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed.')
    } finally {
      setBusy(false)
    }
  }

  async function loadResultsOnly() {
    const response = await fetch(`/api/runs/${run.id}/results`)
    const payload = await response.json()
    if (response.ok) setResults(payload)
  }

  return (
    <div className="page stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">{run.name}</h1>
          <p className="page-subtitle">
            {new Date(run.startAt).toLocaleDateString()} to {new Date(run.endAt).toLocaleDateString()} · {run.timezone}
          </p>
        </div>
        <div className="toolbar">
          <span className={`badge ${run.status}`}>{run.status}</span>
          <a className="button secondary" href={`/api/runs/${run.id}/export.csv`}>
            <Download size={16} aria-hidden="true" />
            Export
          </a>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Processing</h2>
          <div className="toolbar">
            <button className="button" type="button" disabled={busy || !run.repositories.some((repo) => repo.status === 'queued')} onClick={() => void processLoop(false)}>
              <Play size={16} aria-hidden="true" />
              {busy ? 'Processing...' : 'Process Queued'}
            </button>
            <button className="button secondary" type="button" disabled={busy || !run.repositories.some((repo) => repo.status === 'failed')} onClick={() => void processLoop(true)}>
              <RotateCcw size={16} aria-hidden="true" />
              Retry Failed
            </button>
            <button className="button secondary icon-only" type="button" disabled={busy} onClick={() => void refresh()} aria-label="Refresh run">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="panel-body stack">
          <div className="progress" aria-label={`${progress}% complete`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="meta-row">
            <span>{run.processedRepositories}/{run.totalRepositories} repos processed</span>
            <span>{run.failedRepositories} failed</span>
            <span>{run.warnings.length} warnings</span>
          </div>
          <RepositoryList repositories={run.repositories} />
          {run.warnings.length > 0 && (
            <div className="stack">
              {run.warnings.slice(0, 5).map((warning, index) => (
                <div className="notice" key={`${warning.code}-${index}`}>{warning.message}</div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="metric-strip">
        <MetricBox label="Contributors" value={String(results.contributors.length)} />
        <MetricBox label="Average" value={`${averagePercent(results.contributors)}%`} />
        <MetricBox label="Commits" value={String(sumMetric(results.contributors, 'commitCount'))} />
        <MetricBox label="Confidence" value={`${Math.round((results.run.warnings.length ? 0.75 : 0.9) * 100)}%`} />
      </div>

      <section className="results-layout">
        <div className="stack">
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Contributor Results</h2>
              <span className="badge">relative + rubric mapped</span>
            </div>
            <div className="panel-body">
              <ResultsTable rows={results.contributors} summariesByContributor={summariesByContributor} selectedId={selected?.metrics.contributorId || ''} onSelect={setSelectedId} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Impact vs Workflow</h2>
            </div>
            <div className="panel-body">
              <ScatterPlot rows={results.contributors} selectedId={selected?.metrics.contributorId || ''} onSelect={setSelectedId} />
            </div>
          </section>

          {selected && (
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">Timeline</h2>
                <span className="badge">{selected.metrics.name}</span>
              </div>
              <div className="panel-body">
                <TimelineChart metric={selected.metrics} />
              </div>
            </section>
          )}
        </div>

        <aside className="stack">
          {selectedFeedback && <FeedbackSummary summary={selectedFeedback} />}
          <RubricEditor runId={run.id} rubric={run.rubric} onUpdated={refresh} />
          {selected && (
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">Evidence</h2>
                <span className="grade-pill">{selected.grade.letterGrade}</span>
              </div>
              <div className="panel-body stack">
                <SelectedSummary row={selected} />
                <SemanticBars breakdown={selected.metrics.semanticBreakdown} />
                <div className="evidence-list">
                  {selected.metrics.evidence.length === 0 ? (
                    <div className="empty">No matched evidence yet.</div>
                  ) : selected.metrics.evidence.map((item) => (
                    <a className="evidence-item" href={item.url || '#'} target="_blank" rel="noreferrer" key={`${item.type}-${item.id}`}>
                      <div className="meta-row">
                        <span className="badge">{item.type}</span>
                        {item.category && <span className="badge">{item.category}</span>}
                      </div>
                      <strong>{item.title}</strong>
                      {item.summary && <p className="page-subtitle">{item.summary}</p>}
                    </a>
                  ))}
                </div>
              </div>
            </section>
          )}
        </aside>
      </section>
    </div>
  )
}

function RepositoryList({ repositories }: { repositories: RunDetail['repositories'] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {repositories.map((repository) => (
            <tr key={repository.id}>
              <td>{repository.owner}/{repository.name}</td>
              <td>{repository.branch}</td>
              <td><span className={`badge ${repository.status}`}>{repository.status}</span></td>
              <td>{repository.lastError || repository.warnings[0]?.message || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultsTable({
  rows,
  summariesByContributor,
  selectedId,
  onSelect,
}: {
  rows: ResultRow[]
  summariesByContributor: Map<string, RepocatContributorSummary>
  selectedId: string
  onSelect: (id: string) => void
}) {
  if (rows.length === 0) return <div className="empty">No contributor results yet.</div>

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Grade</th>
            <th>Contributor</th>
            <th>Achievement</th>
            <th>Percent</th>
            <th>Raw</th>
            <th>Commits</th>
            <th>Active Days</th>
            <th>Weighted</th>
            <th>Share</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={row.metrics.contributorId === selectedId ? 'selected' : ''} key={row.metrics.contributorId} onClick={() => onSelect(row.metrics.contributorId)}>
              <td><span className="grade-pill">{row.grade.letterGrade}</span></td>
              <td>
                <strong>{row.metrics.name}</strong>
                <div className="meta-row">{row.metrics.githubLogin ? `@${row.metrics.githubLogin}` : row.metrics.contributorId}</div>
              </td>
              <td><span className="badge">{summariesByContributor.get(row.metrics.contributorId)?.achievement || 'Builder'}</span></td>
              <td>{row.grade.absolutePercent}%</td>
              <td>{Math.round(row.grade.rawScore * 100)}%</td>
              <td>{row.metrics.commitCount}</td>
              <td>{row.metrics.activeDays}</td>
              <td>{row.metrics.weightedContribution}</td>
              <td>{Math.round(row.metrics.relativeContributionShare * 100)}%</td>
              <td>{Math.round(row.metrics.confidence * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeedbackSummary({ summary }: { summary: RepocatContributorSummary }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Feedback</h2>
        <span className="badge achievement-badge">
          <Award size={14} aria-hidden="true" />
          {summary.achievement}
        </span>
      </div>
      <div className="panel-body stack">
        <p className="feedback-comment">{summary.feedback_comment}</p>
        {summary.strengths.length > 0 && (
          <div className="field">
            <label>Strengths</label>
            <div className="meta-row">
              {summary.strengths.map((strength) => (
                <span className="badge completed" key={strength}>{strength}</span>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label>Next Step</label>
          <div className="notice">{summary.next_step}</div>
        </div>
      </div>
    </section>
  )
}

function SelectedSummary({ row }: { row: ResultRow }) {
  return (
    <div className="stack">
      <div>
        <h3 className="panel-title">{row.metrics.name}</h3>
        <p className="page-subtitle">
          {row.grade.absolutePercent}% · raw {Math.round(row.grade.rawScore * 100)}% · relative {Math.round(row.grade.cohortRelativeScore * 100)}%
        </p>
      </div>
      <div className="metric-strip">
        <MetricBox label="Impact" value={`${Math.round(row.metrics.impactScore * 100)}%`} />
        <MetricBox label="Workflow" value={`${Math.round(row.metrics.workflowScore * 100)}%`} />
        <MetricBox label="Quality" value={`${Math.round(row.metrics.qualityScore * 100)}%`} />
        <MetricBox label="Collab" value={`${Math.round(row.metrics.collaborationScore * 100)}%`} />
      </div>
      {row.metrics.areas.length > 0 && <div className="meta-row">{row.metrics.areas.map((area) => <span className="badge" key={area}>{area}</span>)}</div>}
    </div>
  )
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-box">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  )
}

function ScatterPlot({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ResultRow[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const width = 640
  const height = 260
  const pad = 34
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Contributor impact versus workflow">
      <rect x="0" y="0" width={width} height={height} rx="8" fill="#f7f7f3" />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#d8d4c8" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#d8d4c8" />
      <text x={width - pad} y={height - 8} textAnchor="end" fontSize="12" fill="#66645b">Impact</text>
      <text x="8" y={pad} fontSize="12" fill="#66645b">Workflow</text>
      {rows.map((row) => {
        const x = pad + row.metrics.impactScore * (width - pad * 2)
        const y = height - pad - row.metrics.workflowScore * (height - pad * 2)
        const selected = row.metrics.contributorId === selectedId
        return (
          <g key={row.metrics.contributorId} onClick={() => onSelect(row.metrics.contributorId)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={selected ? 9 : 7} fill={gradeColor(row.grade.letterGrade)} stroke={selected ? '#20201d' : '#fff'} strokeWidth={2} />
            <text x={x + 10} y={y + 4} fontSize="11" fill="#20201d">{row.metrics.name.split(' ')[0]}</text>
          </g>
        )
      })}
    </svg>
  )
}

function SemanticBars({ breakdown }: { breakdown: SemanticBreakdown }) {
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return <div className="empty">No semantic breakdown yet.</div>
  const entries = Object.entries(breakdown).filter(([, value]) => value > 0)
  return (
    <div className="stack">
      {entries.map(([label, value]) => (
        <div className="range-row" key={label}>
          <span className="metric-label">{label}</span>
          <div className="progress"><span style={{ width: `${Math.round((value / total) * 100)}%`, background: semanticColor(label) }} /></div>
          <span className="metric-label">{Math.round((value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

function TimelineChart({ metric }: { metric: ContributorMetrics }) {
  const width = 640
  const height = 220
  const pad = 34
  const max = Math.max(1, ...metric.timeline.map((point) => point.weightedContribution))
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Contribution timeline">
      <rect x="0" y="0" width={width} height={height} rx="8" fill="#f7f7f3" />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#d8d4c8" />
      {metric.timeline.map((point, index) => {
        const barWidth = Math.max(12, (width - pad * 2) / Math.max(metric.timeline.length, 1) - 8)
        const x = pad + index * ((width - pad * 2) / Math.max(metric.timeline.length, 1)) + 4
        const h = (point.weightedContribution / max) * (height - pad * 2)
        return (
          <g key={point.date}>
            <rect x={x} y={height - pad - h} width={barWidth} height={h} rx="4" fill="#197a65" />
            <text x={x} y={height - 10} fontSize="10" fill="#66645b">{point.date.slice(5)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function RubricEditor({
  runId,
  rubric,
  onUpdated,
}: {
  runId: string
  rubric: RubricConfig
  onUpdated: () => Promise<void>
}) {
  const [draft, setDraft] = useState(rubric)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setWeight(key: keyof RubricConfig['componentWeights'], value: number) {
    setDraft((current) => ({
      ...current,
      componentWeights: {
        ...current.componentWeights,
        [key]: value / 100,
      },
    }))
  }

  function setBand(label: string, value: number) {
    setDraft((current) => ({
      ...current,
      gradeBands: current.gradeBands.map((band) => band.label === label ? { ...band, minPercent: value } : band),
    }))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const patchResponse = await fetch(`/api/runs/${runId}/rubric`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubric: draft }),
      })
      const patchPayload = await patchResponse.json()
      if (!patchResponse.ok) throw new Error(patchPayload.error || 'Failed to update rubric.')

      const recalcResponse = await fetch(`/api/runs/${runId}/recalculate`, { method: 'POST' })
      const recalcPayload = await recalcResponse.json()
      if (!recalcResponse.ok) throw new Error(recalcPayload.error || 'Failed to recalculate.')
      await onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rubric.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Rubric</h2>
        <SlidersHorizontal size={16} aria-hidden="true" />
      </div>
      <div className="panel-body stack">
        {error && <div className="alert">{error}</div>}
        <Range label="Impact" value={Math.round(draft.componentWeights.impact * 100)} onChange={(value) => setWeight('impact', value)} />
        <Range label="Workflow" value={Math.round(draft.componentWeights.workflow * 100)} onChange={(value) => setWeight('workflow', value)} />
        <Range label="Quality" value={Math.round(draft.componentWeights.quality * 100)} onChange={(value) => setWeight('quality', value)} />
        <Range label="Collab" value={Math.round(draft.componentWeights.collaboration * 100)} onChange={(value) => setWeight('collaboration', value)} />
        <div className="rubric-grid">
          {draft.gradeBands.filter((band) => band.label !== 'F').map((band) => (
            <div className="field" key={band.label}>
              <label>{band.label} minimum</label>
              <input className="input" type="number" min={0} max={100} value={band.minPercent} onChange={(event) => setBand(band.label, Number(event.target.value))} />
            </div>
          ))}
        </div>
        <div className="field">
          <label>Churn divisor</label>
          <input
            className="input"
            type="number"
            min={1}
            value={draft.contributionScale.churnDivisor}
            onChange={(event) => setDraft((current) => ({
              ...current,
              contributionScale: { ...current.contributionScale, churnDivisor: Number(event.target.value) },
            }))}
          />
        </div>
        <button className="button" type="button" onClick={() => void save()} disabled={saving}>
          <RefreshCw size={16} aria-hidden="true" />
          {saving ? 'Recalculating...' : 'Apply Rubric'}
        </button>
      </div>
    </section>
  )
}

function Range({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="range-row">
      <span className="metric-label">{label}</span>
      <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="metric-label">{value}%</span>
    </label>
  )
}

function sumMetric(rows: ResultRow[], key: 'commitCount') {
  return rows.reduce((sum, row) => sum + Number(row.metrics[key] || 0), 0)
}

function averagePercent(rows: ResultRow[]) {
  if (rows.length === 0) return 0
  return Math.round(rows.reduce((sum, row) => sum + row.grade.absolutePercent, 0) / rows.length)
}

function gradeColor(grade: string) {
  if (grade === 'A') return '#197a65'
  if (grade === 'B') return '#2867a8'
  if (grade === 'C') return '#986400'
  if (grade === 'D') return '#ba4a38'
  return '#66645b'
}

function semanticColor(label: string) {
  const colors: Record<string, string> = {
    feature: '#197a65',
    bugfix: '#2867a8',
    test: '#6956a6',
    refactor: '#ba4a38',
    docs: '#986400',
    styling: '#b05c86',
    config: '#66645b',
    generated: '#a8a39a',
  }
  return colors[label] || '#197a65'
}
