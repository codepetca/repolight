'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { skyHopInput } from '../../fixtures/reports/sky-hop'
import { buildRepositoryReport } from '@/lib/report/build'
import type { RepositoryReport } from '@/lib/report/contract'
import { periodFromDates, publicReportRequestSchema, type PublicAnalysisResult } from '@/lib/report/public'
import { buildRuleFeedback } from '@/lib/report/rules'
import styles from './PublicReportWorkspace.module.css'

const list = (value: string) => value.split(/[,\n]/).map(item => item.trim()).filter(Boolean)
const readable = (value: string) => value.replaceAll('_', ' ')
const dateLabel = (date: string) => date.slice(5).replace('-', '/')
type DisplayResult = { analysis: PublicAnalysisResult; fictional: boolean; logins: string[] }

export function PublicReportWorkspace() {
  const [result, setResult] = useState<DisplayResult | null>(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const [view, setView] = useState<'summary' | 'evidence'>('summary')
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const configurationHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (result) resultHeading.current?.focus() }, [result, view])
  useEffect(() => { if (result && configurationOpen) configurationHeading.current?.focus() }, [configurationOpen, result])

  function show(analysis: PublicAnalysisResult, fictional: boolean, logins: string[]) {
    setResult({ analysis, fictional, logins })
    setFeedback(analysis.ruleFeedback.feedbackDraft)
    setActionStatus('')
    setView('summary')
    setConfigurationOpen(false)
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResult(null)
    setFeedback('')
    setError('')
    setActionStatus('')
    const form = new FormData(event.currentTarget)
    const field = (name: string) => String(form.get(name) || '').trim()
    try {
      const request = publicReportRequestSchema.parse({
        repositoryUrl: field('repositoryUrl'), ...(field('branch') ? { branch: field('branch') } : {}),
        githubLogins: list(field('githubLogins')), commitEmails: list(field('commitEmails')),
        period: periodFromDates(field('startDate'), field('endDate'), field('timezone')),
        scheduledProjectDates: field('scheduledProjectDates') ? list(field('scheduledProjectDates')) : null,
        exclusions: { commitShas: list(field('commitShas')), pathPrefixes: list(field('pathPrefixes')), botLogins: list(field('botLogins')) },
        baselineReviewed: form.get('baselineReviewed') === 'on',
      })
      setLoading(true)
      const response = await fetch('/api/reports/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'The repository could not be analyzed. Try again.')
      show(payload as PublicAnalysisResult, false, request.githubLogins)
    } catch (caught) {
      const issues = caught && typeof caught === 'object' && 'issues' in caught ? (caught as { issues: Array<{ message: string }> }).issues : null
      setError(issues ? issues.map(issue => issue.message).join(' ') : caught instanceof Error ? caught.message : 'Unable to analyze this repository.')
    } finally { setLoading(false) }
  }

  function demo() {
    const report = buildRepositoryReport(skyHopInput())
    setError('')
    show({ report, ruleFeedback: buildRuleFeedback(report) }, true, ['sample-student'])
  }

  async function copy() {
    try { await navigator.clipboard.writeText(feedback); setActionStatus('Feedback copied.') }
    catch { setActionStatus('Copy is unavailable. Select the feedback text and copy it manually.') }
  }

  function download() {
    if (!result) return
    const content = { ...result.analysis, fictional: result.fictional, teacherFeedback: feedback }
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `repocat-${result.fictional ? 'fictional-' : ''}report.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <main className={styles.workspace}>
    <div className={styles.intro} hidden={Boolean(result)}>
      <p className={styles.eyebrow}>REPOSITORY REPORTS</p>
      <h1>Make progress visible.</h1>
      <p>Review the public commit evidence, understand its limits, and prepare feedback in your own words.</p>
      <span className="badge">Database-free preview · live analysis in local development</span>
      <p className={styles.modeNotice}>Live collection is available only from the local development server on a loopback address. The fictional demo works offline in this page.</p>
    </div>
    <section className={styles.panel} aria-labelledby="configure-heading" hidden={Boolean(result) && !configurationOpen}>
      <div className={styles.sectionHead}><div><h2 id="configure-heading" ref={configurationHeading} tabIndex={-1}>Start with a repository</h2><p>One public repository, one explicit student identity, one review period.</p></div>
        <button className="button secondary" type="button" onClick={demo} disabled={loading}>Explore fictional demo</button></div>
      <form onSubmit={analyze}>
        <fieldset disabled={loading} className={styles.fieldset}>
          <div className={styles.formGrid}>
            <Field label="Public GitHub repository" name="repositoryUrl" required placeholder="https://github.com/student/project" type="url" hint="Plain HTTPS GitHub URL. Public repositories only." />
            <Field label="Branch (optional)" name="branch" placeholder="Repository default branch" />
            <Field label="Student GitHub logins" name="githubLogins" required placeholder="student-login" hint="Separate aliases with commas or newlines. Counts use this identity only." />
            <Field label="Timezone" name="timezone" required defaultValue="America/Toronto" />
            <Field label="Start date" name="startDate" required type="date" />
            <Field label="End date (inclusive)" name="endDate" required type="date" hint="Both dates are included, using midnight boundaries in the selected timezone." />
          </div>
          <Field label="Scheduled project dates (optional)" name="scheduledProjectDates" multiline placeholder={'2026-10-05\n2026-10-06'} hint="YYYY-MM-DD, separated by commas or newlines. Leave blank when unknown; schedule metrics will be unavailable." />
          <details className={styles.advanced}><summary>Baseline & exclusions</summary>
            <p>Review inherited starter history before attributing it to a student. Explicit exclusions are preserved in the report.</p>
            <label className={styles.checkbox}><input type="checkbox" name="baselineReviewed" /> <span>I reviewed the starter history and supplied the necessary exclusions.</span></label>
            <p className={styles.muted}>This confirmation records your review; Repocat does not compare a starter repository automatically. Without it, counts are marked partial.</p>
            <div className={styles.formGrid}>
              <Field label="Commit email aliases (optional)" name="commitEmails" multiline hint="Use known student commit emails when GitHub cannot link their commits to a login. Emails are used for matching and omitted from downloaded reports." />
              <Field label="Excluded full commit SHAs" name="commitShas" multiline />
              <Field label="Excluded file or directory prefixes" name="pathPrefixes" multiline placeholder={'vendor/\ngenerated/'} />
              <Field label="Excluded bot logins" name="botLogins" multiline />
            </div>
            <p className={styles.muted}>Separate entries with commas or newlines. Editing a supplied file is included unless explicitly excluded.</p>
          </details>
          <div className={styles.actions}><button className="button" type="submit">{loading ? 'Collecting public evidence…' : 'Analyze public repository'}</button><span className={styles.muted}>Nothing is saved to a database.</span></div>
        </fieldset>
      </form>
      {loading && <p role="status">Pinning the branch snapshot and collecting evidence. This may take a moment.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
    </section>
    {result ? <div className={styles.results}>
      <section className={styles.panel} aria-labelledby="report-heading">
        <div className={styles.sectionHead}><div><p className={styles.eyebrow}>{result.fictional ? 'FICTIONAL DEMO · SYNTHETIC EVIDENCE' : 'PUBLIC REPOSITORY SNAPSHOT'}</p>
          <h2 ref={resultHeading} tabIndex={-1} id="report-heading">{result.fictional ? 'Fictional Sky Hop example' : result.analysis.report.repository.url.replace('https://github.com/', '')}</h2>
          <p>{view === 'summary' ? 'Report summary' : 'Report evidence'} · {result.analysis.report.repository.branch} · {result.logins.join(', ')}</p>
          <p>{localDate(result.analysis.report.period.startAt, result.analysis.report.period.timezone)} – {localDate(new Date(Date.parse(result.analysis.report.period.endAt) - 1).toISOString(), result.analysis.report.period.timezone)} · {result.analysis.report.period.timezone}</p></div>
          <div className={styles.actions}>
            <button type="button" className="button" onClick={() => setView(view === 'summary' ? 'evidence' : 'summary')}>{view === 'summary' ? 'View evidence' : 'Back to summary'}</button>
            <button type="button" className="button secondary" onClick={() => setConfigurationOpen(!configurationOpen)}>{configurationOpen ? 'Hide configuration' : 'Analyze another repository'}</button>
            <button type="button" className="button secondary" onClick={download}>Download report JSON</button>
          </div></div>
      </section>
      {view === 'summary' ? <>
      <Metrics report={result.analysis.report} />
      <SummaryStats result={result} />
      <div className={styles.summaryGrid}>
        <div className={styles.summaryColumn}><WorkflowFindings result={result} /><SummaryLimitations result={result} /></div>
        <section className={styles.panel} aria-labelledby="feedback-heading"><div className={styles.sectionHead}><div><h2 id="feedback-heading">Feedback draft</h2><p>Edit this rule-based draft before sharing. Your edits remain separate from the original.</p></div></div>
          <label htmlFor="teacher-feedback" className={styles.feedbackLabel}>Teacher feedback</label>
          <textarea id="teacher-feedback" className={styles.feedback} value={feedback} onChange={event => { setFeedback(event.target.value); setActionStatus('') }} />
          <div className={styles.actions}><button className="button" onClick={copy} type="button">Copy feedback</button><button className="button secondary" onClick={() => { setFeedback(result.analysis.ruleFeedback.feedbackDraft); setActionStatus('Rule draft restored.') }} type="button">Restore rule draft</button></div>
          <p className={styles.muted} role="status">{actionStatus || 'Edits stay in this page until you copy or download them.'}</p>
        </section>
      </div>
      </> : <>
      <section className={styles.panel} aria-labelledby="collection-heading"><h2 id="collection-heading">Source & collection details</h2><ReportMetadata result={result} /></section>
      <Timeline report={result.analysis.report} />
      <Heatmap report={result.analysis.report} />
      <CommitEvidence result={result} />
      <section className={styles.panel} aria-labelledby="workflow-heading"><div className={styles.sectionHead}><div><h2 id="workflow-heading">Workflow observations</h2><p>Deterministic rules {result.analysis.ruleFeedback.rulesVersion}. These observations are prompts for teacher review.</p></div><span className="badge">Rule-based · no AI interpretation</span></div>
        <div className={styles.observations}>{result.analysis.ruleFeedback.observations.map(observation => <article key={observation.id} className={styles.observation}>
          <span className={styles.eyebrow}>{readable(observation.kind)}</span><p>{observation.text}</p>
          <div className={styles.evidenceLinks}>{observation.evidence.map((evidence, index) => <a key={`${evidence.commitSha}-${index}`} href={`${result.analysis.report.repository.url}/commit/${evidence.commitSha}`} target="_blank" rel="noreferrer">{evidence.commitSha.slice(0, 7)}{evidence.path ? ` · ${evidence.path}` : ''} ↗</a>)}</div>
        </article>)}</div>
        {!result.analysis.ruleFeedback.observations.length && <p>No rule observations were produced for the available evidence.</p>}
      </section>
      <button type="button" className="button secondary" onClick={() => setView('summary')}>Return to summary & feedback</button>
      </>}
    </div> : <section className={styles.empty} aria-label="Report preview"><span className={styles.emptyIcon}>R</span><h2>Evidence first. Feedback second.</h2><p>Analyze a public repository or explore the fictional Sky Hop example to see the timeline, file activity and a reviewable feedback draft.</p></section>}
  </main>
}

function localDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:timezone, dateStyle:'medium'}).format(new Date(instant))
}

function SummaryStats({result}: {result: DisplayResult}) {
  const {report, ruleFeedback: {summary}} = result.analysis
  const available = report.metrics.studentCommits.status !== 'unavailable'
  const dated = available && (report.commits.length === 0 || report.timeline.length > 0)
  return <dl className={styles.summaryStats}>
    <div><dt>Observed active days</dt><dd>{dated ? summary.activeDays : 'Unavailable'}</dd><small>{report.metrics.studentCommits.status === 'partial' || report.activity.undatedCommitCount ? 'Partial evidence · dated commits only' : 'Local dates with included commits'}</small></div>
    <div><dt>Generic-message share</dt><dd>{available && summary.messageCount ? `${Math.round(summary.genericMessageCount / summary.messageCount * 100)}% · ${summary.genericMessageCount} / ${summary.messageCount} messages` : 'Unavailable'}</dd><small>{report.metrics.studentCommits.status === 'partial' ? 'Partial evidence · exact generic-label rules' : 'Exact generic-label rules; not a grammar score'}</small></div>
  </dl>
}

function WorkflowFindings({result}: {result: DisplayResult}) {
  const findings = result.analysis.ruleFeedback.observations.filter(item => item.kind !== 'limitation')
    .sort((a,b) => Number(a.kind === 'strength') - Number(b.kind === 'strength'))
  return <section className={styles.panel} aria-labelledby="findings-heading"><h2 id="findings-heading" className={styles.summaryTitle}>Workflow findings</h2>
    <p className={styles.muted}>Rule-based observations · teacher review</p>
    {findings.length ? <ul className={styles.findings}>{findings.slice(0,3).map(item => <li key={item.id}>{item.text}</li>)}</ul> : <p>No workflow findings can be supported by the included evidence.</p>}
    {findings.length > 3 && <p className={styles.muted}>{findings.length - 3} more findings in View evidence.</p>}
  </section>
}

function SummaryLimitations({result}: {result: DisplayResult}) {
  const {report, ruleFeedback} = result.analysis
  const limitations: string[] = []
  if (report.coverage.history !== 'complete') limitations.push(`History collection is ${report.coverage.history}; observed activity may be incomplete.`)
  if (report.coverage.files !== 'complete') limitations.push(`File evidence is ${report.coverage.files}; change totals and missing heatmap cells are uncertain.`)
  if (report.baseline.status !== 'applied') limitations.push('Starter history has not been reviewed; inherited changes may remain in counts.')
  if (!report.scheduledProjectDates?.length) limitations.push('Project schedule is unavailable; density and scheduled-day coverage cannot be calculated.')
  if (report.attribution.unmatchedCommitCount) limitations.push(`${report.attribution.unmatchedCommitCount} commit(s) did not match the configured student identity.`)
  if (report.activity.undatedCommitCount) limitations.push(`${report.activity.undatedCommitCount} included commit(s) have no author date; dates and period membership are uncertain.`)
  limitations.push(...report.coverage.notes.filter(note => note.includes('merge commit(s) omitted')))
  const noCommits = ruleFeedback.observations.find(item => item.ruleId === 'no-commits')
  if (noCommits) limitations.push(noCommits.text)
  return <section className={styles.panel} aria-labelledby="limitations-heading"><h2 id="limitations-heading" className={styles.summaryTitle}>Limitations</h2>
    {limitations.length > 0 && <ul className={styles.notes}>{limitations.map((item,index) => <li key={index}>{item}</li>)}</ul>}
    <p className={styles.muted}>Commit time is not push time. Counts do not establish effort, attendance, understanding or AI authorship. Full source, exclusions and collection notes are in View evidence.</p>
  </section>
}

function Field({ label, name, hint, multiline, ...props }: { label: string; name: string; hint?: string; multiline?: boolean; required?: boolean; type?: string; placeholder?: string; defaultValue?: string }) {
  return <div className={styles.field}><label htmlFor={name}>{label}</label>{multiline ? <textarea id={name} name={name} rows={3} aria-describedby={hint ? `${name}-hint` : undefined} {...props} /> : <input id={name} name={name} aria-describedby={hint ? `${name}-hint` : undefined} {...props} />}{hint && <small id={`${name}-hint`}>{hint}</small>}</div>
}

function ReportMetadata({ result }: { result: DisplayResult }) {
  const { report } = result.analysis
  return <><dl className={styles.metadata}>
    <div><dt>Source</dt><dd><a href={report.repository.url} target="_blank" rel="noreferrer">{report.repository.url.replace('https://github.com/', '')} ↗</a> · {report.repository.branch}</dd></div>
    <div><dt>Snapshot</dt><dd><a href={`${report.repository.url}/commit/${report.snapshot.sha}`} target="_blank" rel="noreferrer">{report.snapshot.sha.slice(0, 12)} ↗</a> · {readable(report.snapshot.kind)}<br />{report.snapshot.capturedAt}</dd></div>
    <div><dt>Period [start, end)</dt><dd>{report.period.startAt} → {report.period.endAt}<br />{report.period.timezone}</dd></div>
    <div><dt>Student identity</dt><dd>{result.logins.join(', ') || 'Not configured'} · {report.attribution.status === 'matched' ? 'identity configured' : 'not configured'}<br />{report.attribution.unmatchedCommitCount} unmatched commits</dd></div>
    <div><dt>Baseline</dt><dd>{readable(report.baseline.status)}{report.baseline.reference && ` · ${report.baseline.reference}`}</dd></div>
    <div><dt>Collection coverage</dt><dd>History: {report.coverage.history} · Files: {report.coverage.files}<br />{report.scheduledProjectDates === null ? 'Project schedule unknown' : `${report.scheduledProjectDates.length} scheduled project dates`}</dd></div>
  </dl>
  <p className={styles.caveat}>Commit time is not push time. Push events are unavailable. Counts describe visible repository evidence and do not measure effort, attendance or authorship.</p>
  {report.baseline.status !== 'applied' && <p className="notice">Starter history has not been established as reviewed. Inherited work may remain in observed counts.</p>}
  {report.coverage.notes.length > 0 && <ul className={styles.notes}>{report.coverage.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
  <details className={styles.advanced}><summary>Applied exclusions</summary><p>Commit SHAs: {report.exclusions.commitShas.join(', ') || 'None'}</p><p>Path prefixes: {report.exclusions.pathPrefixes.join(', ') || 'None'}</p><p>Bot logins: {report.exclusions.botLogins.join(', ') || 'None'}</p></details></>
}

function Metrics({ report }: { report: RepositoryReport }) {
  const items = [
    { label: 'Student commits', metric: report.metrics.studentCommits, unit: 'included commits', percent: false },
    { label: 'Commit density', metric: report.metrics.commitDensity, unit: 'commits / scheduled project day', percent: false },
    { label: 'Scheduled day coverage', metric: report.metrics.scheduledDayCoverage, unit: 'scheduled dates with commits', percent: true },
    { label: 'Busiest day share', metric: report.metrics.busiestDayShare, unit: 'of included commits', percent: true },
  ]
  return <section className={styles.metrics} aria-label="Report metrics">{items.map(({ label, metric, unit, percent }) => <article key={label} className={styles.metric}>
    <h3>{label}</h3><strong>{metric.value === null ? '—' : percent ? `${Math.round(metric.value * 100)}%` : Number(metric.value.toFixed(2)).toLocaleString('en-CA')}</strong><span>{unit}</span>
    <p className={metric.status === 'available' ? styles.available : styles.metricWarning}>{metric.status === 'available' ? 'Available' : metric.status === 'partial' ? 'Partial evidence' : 'Unavailable'}</p>
    {metric.numerator !== null && metric.denominator !== null && <small>{metric.numerator} / {metric.denominator}</small>}{metric.reason && <p className={styles.reason}>{readable(metric.reason)}</p>}
  </article>)}</section>
}

function Timeline({ report }: { report: RepositoryReport }) {
  const localDate = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: report.period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return `${fields.year}-${fields.month}-${fields.day}`
  }
  const firstDate = localDate(Date.parse(report.period.startAt))
  const lastDate = localDate(Date.parse(report.period.endAt) - 1)
  const dates: string[] = []
  for (let current = Date.parse(`${firstDate}T12:00:00Z`); current <= Date.parse(`${lastDate}T12:00:00Z`); current += 86400000) dates.push(new Date(current).toISOString().slice(0, 10))
  const observed = new Map(report.timeline.map(point => [point.date, point.commitCount]))
  const complete = report.metrics.studentCommits.status === 'available' && report.activity.undatedCommitCount === 0
  const max = Math.max(1, ...report.timeline.map(point => point.commitCount))
  const width = Math.max(500, dates.length * (dates.length > 20 ? 42 : 64))
  const slot = width / Math.max(1, dates.length)
  return <section className={styles.panel} aria-labelledby="timeline-heading"><div className={styles.sectionHead}><div><h2 id="timeline-heading">Commit timeline</h2><p>Author dates in {report.period.timezone}. {report.activity.undatedCommitCount} commits have no known author date.</p></div><span className="badge">{report.coverage.history} history</span></div>
    <p className={styles.muted}>{complete ? 'Every calendar date is shown. Zero means no included commit on that date.' : 'Every calendar date is shown. Bars are observed counts; ? marks dates with no observed commit and incomplete evidence, not verified zeros.'}</p>
    <div className={styles.chartScroll} tabIndex={0} role="region" aria-label="Scrollable daily commit timeline"><svg className={styles.chart} style={{ minWidth: width }} viewBox={`0 0 ${width} 180`} role="img" aria-label="Observed commits by local author date, including calendar gaps. Exact counts and unknown dates are in the timeline data table.">
      {dates.map((date, index) => { const count = observed.get(date); const unknown = count === undefined && !complete; const height = (count || 0) / max * 105; const x = index * slot; return <g key={date}>
        <rect x={x + slot * .25} y={unknown ? 128 : 135 - height} width={slot * .5} height={unknown ? 7 : Math.max(height, 1)} rx="3" fill={unknown ? 'var(--surface-3)' : 'var(--accent)'} />
        <text x={x + slot / 2} y={unknown ? 119 : 125 - height} textAnchor="middle">{unknown ? '?' : count || 0}</text><text x={x + slot / 2} y="160" textAnchor="middle">{dateLabel(date)}</text></g> })}
    </svg></div><details className={styles.advanced}><summary>Timeline data table</summary><div className={styles.tableScroll}><table className={styles.table}><caption>Observed commits by local date</caption><thead><tr><th scope="col">Date</th><th scope="col">Commits</th></tr></thead><tbody>{dates.map(date => <tr key={date}><th scope="row">{date}</th><td>{observed.has(date) ? `${observed.get(date)}${complete ? '' : ' observed (partial)'}` : complete ? '0' : 'Unknown'}</td></tr>)}</tbody></table></div></details>
    <p className={styles.muted}>{report.activity.outsideScheduleCommitCount === null ? 'Schedule comparison unavailable.' : `${report.activity.outsideScheduleCommitCount} commits fall outside scheduled project dates.`}</p>
  </section>
}

function Heatmap({ report }: { report: RepositoryReport }) {
  const [filter, setFilter] = useState('')
  const matchedFiles = report.heatmap.files.filter(path => path.toLowerCase().includes(filter.toLowerCase()))
  const visibleFiles = matchedFiles.slice(0, 50)
  const dates = Array.from(new Set([...(report.scheduledProjectDates || []), ...report.timeline.map(point => point.date)])).sort()
  const commitDates = new Map(report.timeline.flatMap(point => point.commitShas.map(sha => [sha, point.date] as const)))
  const cells = new Map<string, number>()
  for (const cell of report.heatmap.cells) { const date = commitDates.get(cell.commitSha); if (date) { const key = `${cell.path}\0${date}`; cells.set(key, (cells.get(key) || 0) + cell.additions + cell.deletions) } }
  const complete = report.heatmap.status === 'available' && report.coverage.files === 'complete' && report.coverage.history === 'complete'
  let maximum = 1
  for (const value of cells.values()) maximum = Math.max(maximum, value)
  return <section className={styles.panel} aria-labelledby="heatmap-heading"><div className={styles.sectionHead}><div><h2 id="heatmap-heading">File activity</h2><p>Observed additions + deletions by file and local date. Change volume describes the diff, not its value.</p></div><span className="badge">{report.heatmap.status} file evidence</span></div>
    <p className={styles.muted}>{complete ? 'A dash means no included change on that date.' : 'Missing cells are unknown (?). Observed values may be incomplete; they are not verified totals.'} Undated changes cannot be assigned to a date.</p>
    <div className={styles.field}><label htmlFor="file-filter">Filter file paths</label><input id="file-filter" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a file or directory" /></div>
    <p className={styles.muted}>Showing {visibleFiles.length} of {matchedFiles.length} matching files (up to 50 at a time). Filter to find other paths; the JSON download retains all file evidence.</p>
    {dates.length && visibleFiles.length ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Scrollable file activity table"><table className={`${styles.table} ${styles.heatmap}`}><caption>Observed file changes; darker green means more observed line changes; ? means unknown</caption><thead><tr><th scope="col">File</th>{dates.map(date => <th scope="col" key={date} title={date}>{dateLabel(date)}</th>)}</tr></thead><tbody>{visibleFiles.map(path => <tr key={path}><th scope="row">{path}</th>{dates.map(date => { const value = cells.get(`${path}\0${date}`); return <td key={date} className={value !== undefined ? styles.heat : complete ? styles.noChange : styles.unknown} style={value !== undefined ? { backgroundColor: `rgba(25, 122, 101, ${.08 + value / maximum * .22})` } : undefined} title={`${path}, ${date}: ${value !== undefined ? `${value} observed line changes` : complete ? 'no included change' : 'unknown'}`}>{value ?? (complete ? '—' : '?')}</td> })}</tr>)}</tbody></table></div> : <p>No dated file cells are available for display.</p>}
  </section>
}

function CommitEvidence({ result }: { result: DisplayResult }) {
  const { report, ruleFeedback } = result.analysis
  return <section className={styles.panel} aria-labelledby="commits-heading"><div className={styles.sectionHead}><div><h2 id="commits-heading">Commit evidence</h2><p>{ruleFeedback.summary.activeDays} observed active dates · {ruleFeedback.summary.genericMessageCount} of {ruleFeedback.summary.messageCount} messages match generic-message rules.</p></div></div>
    <div className={styles.tableScroll}><table className={styles.table}><caption>Commit evidence</caption><thead><tr><th scope="col">Commit / author date</th><th scope="col">Message</th><th scope="col">Observed files</th><th scope="col">Observed + / −</th></tr></thead><tbody>{report.commits.map(commit => <tr key={commit.sha}><td><a href={commit.url} target="_blank" rel="noreferrer">{commit.sha.slice(0, 7)} ↗</a><small className={styles.block}>{commit.authoredAt ? new Intl.DateTimeFormat('en-CA', { timeZone: report.period.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(commit.authoredAt)) : 'Author date unknown'}</small></td><td className={styles.message}>{commit.message || '(empty message)'}</td><td>{commit.files.length}{report.coverage.files !== 'complete' ? ' observed' : ''}</td><td>{commit.additions ?? '?'} / {commit.deletions ?? '?'}</td></tr>)}</tbody></table></div>
    {!report.commits.length && <p>No included commits were observed.</p>}
  </section>
}
