'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'
import type { PublicRepositoryRequest } from '@/lib/report/bundle-contract'
import { analysisResultSchema, analysisStatusSchema, feedbackEditSchema, type AnalysisResult, type AnalysisStatus, type FeedbackEdit } from '@/lib/service/contract'
import styles from './PublicReportWorkspace.module.css'

const api = '/api/v2'
const messages: Record<string, string> = {
  unauthorized:'Your session or workspace is unavailable. Sign in again if initialization fails.',
  forbidden:'This action is not permitted for your account.',
  daily_limit:'The daily analysis limit has been reached. Try again later.',
  queue_limit:'Your workspace queue is full. Wait for an analysis to finish.',
  conflict:'Feedback changed in another session. Your local edits are retained. Reopen this report to load the latest revision before saving again.',
  invalid_response:'The saved response does not match the selected analysis. Reopen the report or retry its status.',
  result_not_ready:'The report is still being stored. Checking again shortly.',
}
class ServiceError extends Error {
  constructor(readonly code: string) {super(messages[code] || `The request could not be completed (${code.replaceAll('_',' ')}). Your local edits are retained.`)}
}
async function serviceFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, {credentials:'same-origin', cache:'no-store', ...options})
  const payload = await response.json()
  if (!response.ok) throw new ServiceError(typeof payload?.error?.code === 'string' ? payload.error.code : 'request_failed')
  return payload
}
const json = (method: string, body: unknown): RequestInit => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const sameBinding = (a: AnalysisStatus['clientBinding'], b: AnalysisStatus['clientBinding']) => a === null ? b === null : b !== null && a.installationRef === b.installationRef && a.subjectRef === b.subjectRef && a.sourceRevisionRef === b.sourceRevisionRef
const statusMatches = (expected: AnalysisStatus, actual: AnalysisStatus | AnalysisResult) => expected.analysisId === actual.analysisId && expected.requestFingerprint === actual.requestFingerprint && sameBinding(expected.clientBinding, actual.clientBinding)
const errorText = (caught: unknown) => caught instanceof Error ? caught.message : 'The service is unavailable. Try again.'

type LoadedReport = {result: AnalysisResult; edits: FeedbackEdit[]}

export function SavedReportWorkspace() {
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'missing' | 'ready' | 'error'>('loading')
  const [analyses, setAnalyses] = useState<AnalysisStatus[]>([])
  const [target, setTarget] = useState<AnalysisStatus | null>(null)
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [loaded, setLoaded] = useState<LoadedReport | null>(null)
  const [error, setError] = useState('')
  const [initializing, setInitializing] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const selectionVersion = useRef(0)
  const revisions = useRef<Record<string, number>>({})

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    async function load() {
      try {
        await serviceFetch('/workspace',{signal:controller.signal})
        const response = await serviceFetch('/analyses',{signal:controller.signal})
        const jobs = analysisStatusSchema.array().parse(response.analyses)
        if (live) {setAnalyses(jobs);setWorkspaceState('ready');setError('')}
      } catch (caught) {
        if (!live) return
        if (caught instanceof ServiceError && caught.code === 'unauthorized') setWorkspaceState('missing')
        else {setWorkspaceState('error');setError(errorText(caught))}
      }
    }
    void load()
    return () => {live = false;controller.abort()}
  }, [refresh])

  useEffect(() => {
    if (!target) return
    const controller = new AbortController()
    const version = selectionVersion.current
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 1500
    let failures = 0
    const current = () => live && selectionVersion.current === version
    const again = () => {timer = setTimeout(poll,delay);delay = Math.min(15000, Math.round(delay * 1.5))}
    async function poll() {
      try {
        const next = analysisStatusSchema.parse(await serviceFetch(`/analyses/${target!.analysisId}`,{signal:controller.signal}))
        if (!statusMatches(target!,next)) throw new ServiceError('invalid_response')
        if (!current()) return
        setStatus(next)
        setAnalyses(jobs => jobs.map(job => job.analysisId === next.analysisId ? next : job))
        if (next.status === 'succeeded') {
          const [resultPayload, editPayload] = await Promise.all([
            serviceFetch(`/analyses/${next.analysisId}/result`,{signal:controller.signal}),
            serviceFetch(`/analyses/${next.analysisId}/edits`,{signal:controller.signal}),
          ])
          const result = analysisResultSchema.parse(resultPayload)
          const edits = feedbackEditSchema.array().parse(editPayload.edits)
          const scopes = new Set(['repository', ...result.bundle.contributors.map(entry => `contributor:${entry.contributor.id}`)])
          if (!statusMatches(next,result) || next.reportRef !== result.reportRef || edits.some(edit => edit.reportRef !== result.reportRef || !scopes.has(edit.scopeKey))) throw new ServiceError('invalid_response')
          if (!current()) return
          revisions.current = Object.fromEntries(edits.map(edit => [edit.scopeKey,edit.revision]))
          setLoaded({result,edits});setError('')
          return
        }
        if (next.status === 'failed') {setError('');return}
        failures = 0
        setError('')
        again()
      } catch (caught) {
        if (!current()) return
        setError(errorText(caught))
        if (!(caught instanceof ServiceError && caught.code === 'invalid_response') && ++failures < 4) again()
      }
    }
    void poll()
    return () => {live = false;controller.abort();if (timer) clearTimeout(timer)}
  }, [target])

  async function initialize() {
    setInitializing(true);setError('')
    try {await serviceFetch('/workspace',json('POST',{}));setRefresh(value => value + 1)}
    catch (caught) {setError(errorText(caught))}
    finally {setInitializing(false)}
  }

  function open(job: AnalysisStatus) {
    selectionVersion.current += 1
    revisions.current = {}
    setLoaded(null);setStatus(job);setTarget({...job});setError('')
  }

  async function enqueue(request: PublicRepositoryRequest) {
    const version = ++selectionVersion.current
    setTarget(null);setLoaded(null);setStatus(null);setError('')
    try {
      const job = analysisStatusSchema.parse(await serviceFetch('/analyses',{
        ...json('POST',{schemaVersion:'1.0',request}),
        headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},
      }))
      if (job.clientBinding !== null) throw new ServiceError('invalid_response')
      if (selectionVersion.current !== version) return null
      setAnalyses(jobs => [job,...jobs.filter(item => item.analysisId !== job.analysisId)].slice(0,50))
      setStatus(job);setTarget(job)
    } catch (caught) {if (selectionVersion.current === version) setError(errorText(caught))}
    return null
  }

  async function saveFeedback(scopeKey: string, text: string) {
    if (!loaded) throw new Error('Reopen the saved report before saving feedback.')
    const version = selectionVersion.current
    const reportRef = loaded.result.reportRef
    const expectedRevision = revisions.current[scopeKey] || 0
    const payload = await serviceFetch(`/analyses/${loaded.result.analysisId}/edits`,json('PUT',{scopeKey,expectedRevision,text}))
    const edit = feedbackEditSchema.parse(payload.edit)
    if (edit.reportRef !== reportRef || edit.scopeKey !== scopeKey || edit.revision !== expectedRevision + 1) throw new ServiceError('invalid_response')
    if (selectionVersion.current === version) revisions.current[scopeKey] = edit.revision
  }

  return <>
    <section className={styles.workspace} aria-labelledby="saved-heading">
      <div className={styles.panel}>
        <h1 id="saved-heading">Saved repository reports</h1>
        <p className={styles.muted}>Queue a public repository analysis, reopen collected evidence and save feedback separately for each report view.</p>
        {workspaceState === 'loading' && <p role="status">Loading your workspace…</p>}
        {workspaceState === 'missing' && <><p>Create your private report workspace to start saving analyses.</p><button className="button" type="button" disabled={initializing} onClick={initialize}>{initializing ? 'Creating workspace…' : 'Create report workspace'}</button></>}
        {workspaceState === 'error' && <button className="button secondary" type="button" onClick={() => setRefresh(value => value + 1)}>Retry workspace</button>}
        {error && <p role="alert" className="alert">{error}</p>}
        {workspaceState === 'ready' && <>
          <div className={styles.actions}><h2>Recent analyses</h2><button className="button secondary" type="button" onClick={() => setRefresh(value => value + 1)}>Refresh analyses</button></div>
          {analyses.length ? <ul className={styles.contributors}>{analyses.map(job => <li key={job.analysisId}><button className="button secondary" type="button" aria-pressed={target?.analysisId === job.analysisId} onClick={() => open(job)}>Open {job.analysisId.slice(0,8)}</button><span>{job.status} · {new Date(job.createdAt).toLocaleString()}{job.error && ` · ${job.error.code.replaceAll('_',' ')}`}</span></li>)}</ul> : <p>No saved analyses yet.</p>}
          {status && <div role="status"><p>Selected analysis: {status.status}{status.status === 'running' && ' · collecting the pinned repository snapshot'}{status.status === 'queued' && ' · waiting for a background worker'}.</p>
            {status.nextAttemptAt && <p>Next attempt: {new Date(status.nextAttemptAt).toLocaleString()}.</p>}
            {status.status === 'failed' && <p>Analysis failed: {status.error?.code.replaceAll('_',' ') || 'unavailable evidence'}. Submit a new analysis to try again. Previously saved reports remain available.</p>}
            {status.status === 'succeeded' && !loaded && !error && <p>Loading the saved result…</p>}
            {error && <button className="button secondary" type="button" onClick={() => open(status)}>Retry selected analysis</button>}
          </div>}
          <IntegrationKeys />
        </>}
      </div>
    </section>
    {workspaceState === 'ready' && <PublicReportWorkspace key={loaded?.result.analysisId || 'new-analysis'} initialBundle={loaded?.result.bundle} initialTeacherEdits={loaded ? Object.fromEntries(loaded.edits.filter(edit => edit.text !== null).map(edit => [edit.scopeKey, edit.text!])) : undefined} analyzeRepository={enqueue} saveFeedback={loaded ? saveFeedback : undefined} />}
  </>
}

const keySchema = z.object({id:z.string().uuid(),label:z.string(),scopes:z.array(z.string()),installationRef:z.string().nullable(),expiresAt:z.string().nullable(),revokedAt:z.string().nullable(),createdAt:z.string()})
type KeyMetadata = z.infer<typeof keySchema>

function IntegrationKeys() {
  const [keys,setKeys] = useState<KeyMetadata[]>([])
  const [token,setToken] = useState('')
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)
  const [allowErasure,setAllowErasure] = useState(false)
  const generation = useRef(0)
  async function load() {
    try {setKeys(keySchema.array().parse((await serviceFetch('/workspace/keys')).keys));setMessage('')}
    catch (caught) {setMessage(errorText(caught))}
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setToken('');setMessage('')
    const form = new FormData(event.currentTarget)
    const current = ++generation.current
    try {
      const payload = await serviceFetch('/workspace/keys',json('POST',{label:String(form.get('label') || '').trim(),scopes:allowErasure ? ['analyses:create','analyses:read','analyses:erase'] : ['analyses:create','analyses:read'],installationRef:String(form.get('installationRef') || '').trim() || null}))
      const key = keySchema.parse(payload.key)
      if (typeof payload.token !== 'string' || !payload.token) throw new ServiceError('invalid_response')
      if (generation.current !== current) return
      setKeys(items => [key,...items]);setToken(payload.token)
    } catch (caught) {if (generation.current === current) setMessage(errorText(caught))}
    finally {setBusy(false)}
  }
  async function revoke(id: string) {
    setBusy(true);setMessage('')
    try {await serviceFetch(`/workspace/keys/${id}`,json('DELETE',{}));setToken('');await load()}
    catch (caught) {setMessage(errorText(caught))}
    finally {setBusy(false)}
  }
  async function copyToken() {
    try {await navigator.clipboard.writeText(token);setMessage('Integration key copied.')}
    catch {setMessage('Select the key and copy it manually.')}
  }
  return <details className={styles.advanced} onToggle={event => {if (event.currentTarget.open) void load(); else {generation.current += 1;setToken('')}}}>
    <summary>Integration keys</summary>
    <p>Keys can create and read analyses. An installation reference restricts the key to that integration.</p>
    <form onSubmit={create}><fieldset disabled={busy} className={styles.fieldset}><div className={styles.formGrid}><div className={styles.field}><label htmlFor="key-label">Key label</label><input id="key-label" name="label" required maxLength={100} /></div><div className={styles.field}><label htmlFor="key-installation">{allowErasure ? 'Installation reference (required for Pika cleanup)' : 'Installation reference (optional)'}</label><input id="key-installation" name="installationRef" required={allowErasure} pattern="[A-Za-z0-9._~-]+" maxLength={128} /></div></div><label><input type="checkbox" checked={allowErasure} onChange={event => setAllowErasure(event.target.checked)} /> Allow Pika to remove its report copies</label>{allowErasure && <p>Pika can permanently remove reports for this installation when their submission data is deleted.</p>}<button className="button secondary" type="submit">Create integration key</button></fieldset></form>
    {token && <div><p>Copy this key now. It is shown only once and disappears when you close these options.</p><div className={styles.field}><label htmlFor="integration-token">New integration key</label><input id="integration-token" readOnly value={token} autoComplete="off" /></div><div className={styles.actions}><button className="button secondary" type="button" onClick={copyToken}>Copy integration key</button><button className="button secondary" type="button" onClick={() => setToken('')}>Hide integration key</button></div></div>}
    <button className="button secondary" type="button" onClick={load}>Refresh keys</button>
    <ul className={styles.contributors}>{keys.map(key => <li key={key.id}><span>{key.label} · {key.revokedAt ? 'Revoked' : 'Not revoked'}{key.installationRef && ` · ${key.installationRef}`}{key.expiresAt && ` · Expires ${key.expiresAt}`}</span>{!key.revokedAt && <button className="button secondary" type="button" disabled={busy} onClick={() => revoke(key.id)}>Revoke {key.label}</button>}</li>)}</ul>
    {message && <p role="status">{message}</p>}
  </details>
}
