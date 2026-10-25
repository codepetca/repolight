'use client'

import { useEffect, useRef, useState } from 'react'
import { interpretationResponseSchema, type InterpretationCitation, type InterpretationResponse } from '@/lib/interpretation/contract'
import type { PublicRepositoryBundle, ScopeAnalysis } from '@/lib/report/bundle-contract'
import styles from './PublicReportWorkspace.module.css'

export type SavedInterpretationSource = { analysisId: string; reportDigest: string }
type Props = SavedInterpretationSource & { bundle: PublicRepositoryBundle; scopeKey: string }

// Resolve displayed citations from the current immutable report, never from model prose.
export function localCitation(sourceKey: InterpretationCitation['sourceKey'], bundle: PublicRepositoryBundle, scope: ScopeAnalysis): Pick<InterpretationCitation, 'value' | 'status'> {
  const {facts, ruleFeedback:{summary}} = scope
  const countStatus = facts.metrics.commits.status
  switch (sourceKey) {
    case 'metrics.commits': return facts.metrics.commits
    case 'metrics.commitDensity': return facts.metrics.commitDensity
    case 'metrics.scheduledDayCoverage': return facts.metrics.scheduledDayCoverage
    case 'metrics.busiestDayShare': return facts.metrics.busiestDayShare
    case 'activity.activeDays': return {value:countStatus === 'unavailable' ? null : summary.activeDays,status:facts.activity.undatedCommitCount && countStatus === 'available' ? 'partial' : countStatus}
    case 'activity.undatedCommits': return {value:facts.activity.undatedCommitCount,status:countStatus}
    case 'rules.genericMessageShare': return {value:summary.messageCount ? Math.round(summary.genericMessageCount / summary.messageCount * 10000) / 10000 : null,status:summary.messageCount ? countStatus : 'unavailable'}
    case 'rules.longestScheduledGap': return {value:summary.longestScheduledGap,status:summary.longestScheduledGap === null ? 'unavailable' : 'available'}
    case 'coverage.history': return {value:facts.coverage.history,status:facts.coverage.history === 'complete' ? 'available' : facts.coverage.history}
    case 'coverage.files': return {value:facts.coverage.files,status:facts.coverage.files === 'complete' ? 'available' : facts.coverage.files}
    case 'baseline.status': return {value:bundle.context.baseline.status,status:bundle.context.baseline.status === 'applied' ? 'available' : 'partial'}
  }
}

export function ReportInterpretation(props: Props) {
  return <InterpretationSession key={`${props.analysisId}:${props.reportDigest}:${props.scopeKey}`} {...props} />
}
function InterpretationSession({analysisId,reportDigest,bundle,scopeKey}: Props) {
  const [reply,setReply] = useState<InterpretationResponse | null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [forbidden,setForbidden] = useState(false)
  const live = useRef(true)
  const controllers = useRef(new Set<AbortController>())
  const intent = useRef<string | null>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const polls = useRef(0)
  const scope = scopeKey === 'repository' ? bundle.overview : bundle.contributors.find(entry => `contributor:${entry.contributor.id}` === scopeKey)?.analysis
  const path = `/api/v2/analyses/${encodeURIComponent(analysisId)}/interpretation?scopeKey=${encodeURIComponent(scopeKey)}`

  async function request(method: 'GET' | 'POST', version: number): Promise<InterpretationResponse | null> {
    const submittedIntent = method === 'POST' ? intent.current : null
    const controller = new AbortController()
    controllers.current.add(controller)
    const timeout = setTimeout(() => controller.abort(), 35000)
    try {
      const response = await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,...(method === 'POST' ? {headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:'1.0',requestId:submittedIntent,scopeKey})} : {})})
      if (!live.current || version !== generation.current) return null
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setForbidden(true)
        throw new Error(response.status === 429 ? 'The AI interpretation limit has been reached. Try again later.' : 'AI interpretation is unavailable. Your report and feedback are unchanged.')
      }
      const parsed = interpretationResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('AI interpretation returned an invalid response. Your report and feedback are unchanged.')
      const next = parsed.data
      if (!live.current || version !== generation.current) return null
      if (bundle.bundleRef !== analysisId || !scope || (next.state === 'available') !== (next.interpretation !== null) || next.scopeKey !== scopeKey || (next.interpretation && (next.state !== 'available' || next.interpretation.provenance.scopeKey !== scopeKey || next.interpretation.provenance.reportDigest !== reportDigest || next.interpretation.citations.some(cite => {const local = localCitation(cite.sourceKey,bundle,scope);return local.value !== cite.value || local.status !== cite.status})))) throw new Error('The AI interpretation does not match this report view. Your report and feedback are unchanged.')
      const notAdmitted = method === 'POST' && next.requestId === null && next.interpretation === null && ((next.state === 'disabled' && !next.enabled && next.error === null) || (next.state === 'failed' && next.enabled && next.error === 'configuration_unavailable'))
      if (method === 'POST' && !notAdmitted && (!submittedIntent || next.requestId !== submittedIntent)) throw new Error('The response does not match the requested interpretation. Retry the same request or check progress. Your report and feedback are unchanged.')
      if (method === 'GET' && intent.current && next.requestId !== intent.current) throw new Error('This progress response does not confirm the current request. Retry the same interpretation request or check progress later. Your report and feedback are unchanged.')
      setReply(next);setError(notAdmitted && next.state === 'disabled' ? 'AI interpretation is paused. Your report and feedback are unchanged.' : '')
      if (notAdmitted || ((next.state === 'failed' || next.state === 'available') && next.requestId === intent.current)) intent.current = null
      return next
    } catch (caught) {
      if (controller.signal.aborted) throw new Error('AI interpretation timed out. Check progress before retrying. Your report and feedback are unchanged.')
      throw caught
    } finally { clearTimeout(timeout);controllers.current.delete(controller) }
  }
  function schedule(next: InterpretationResponse | null, version: number) {
    if (!next || next.state !== 'pending' || !live.current) return
    if (++polls.current > 6) {setError('AI interpretation is still pending. Check progress later.');return}
    timer.current = setTimeout(() => {void read(version)},Math.min(15000,1500 * 2 ** (polls.current - 1)))
  }
  async function read(version: number) {
    try {schedule(await request('GET',version),version)}
    catch (caught) {if (live.current && generation.current === version) setError(caught instanceof Error ? caught.message : 'AI interpretation is unavailable. Your report and feedback are unchanged.')}
  }
  useEffect(() => {
    live.current = true
    void read(generation.current)
    const activeControllers = controllers.current
    return () => {live.current = false;generation.current += 1;activeControllers.forEach(controller => controller.abort());if (timer.current) clearTimeout(timer.current)}
    // The keyed session fixes the immutable report and scope for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function nextGeneration() {
    const version = ++generation.current
    controllers.current.forEach(controller => controller.abort())
    if (timer.current) clearTimeout(timer.current)
    return version
  }
  async function generate() {
    if (busy || !reply?.enabled || forbidden || reply.state === 'pending') return
    const version = nextGeneration()
    intent.current ||= crypto.randomUUID()
    setBusy(true);setError('');polls.current = 0
    try {schedule(await request('POST',version),version)}
    catch (caught) {if (live.current && generation.current === version) setError(caught instanceof Error ? caught.message : 'AI interpretation is unavailable. Your report and feedback are unchanged.')}
    finally {if (live.current && generation.current === version) setBusy(false)}
  }
  if ((!reply || (!reply.enabled && !reply.interpretation && reply.state !== 'pending')) && !error) return null
  const sidecar = reply?.interpretation
  return <details className={`${styles.panel} ${styles.advanced}`}>
    <summary>AI interpretation · optional teacher review</summary>
    <p>Read-only observations for this report view. Review the cited evidence before using them. AI interpretation does not change measured facts or feedback drafts.</p>
    {reply?.enabled && !forbidden && <><p>Sends selected measured facts to OpenAI. Source code and private teacher edits are not sent.</p><button className="button secondary" type="button" disabled={busy || reply.state === 'pending'} onClick={generate}>{busy ? 'Requesting interpretation…' : reply.state === 'failed' ? 'Retry AI interpretation' : intent.current ? 'Retry interpretation request' : sidecar ? 'Generate new interpretation' : 'Generate AI interpretation'}</button></>}
    {reply?.state === 'pending' && <p role="status">AI interpretation is pending.</p>}
    {reply?.state === 'failed' && <p role="status">AI interpretation could not be generated ({reply.error?.replaceAll('_',' ') || 'unavailable'}). Your report and feedback are unchanged.</p>}
    {error && <p role="status">{error}</p>}
    {(reply?.state === 'pending' || error) && <button className="button secondary" type="button" disabled={busy} onClick={() => {polls.current = 0;void read(nextGeneration())}}>Check interpretation progress</button>}
    {sidecar && <><h2>AI interpretation</h2><p className={styles.muted}>AI-generated · teacher review required</p>
      <div className={styles.observations}>{sidecar.observations.map(observation => <article className={styles.observation} key={observation.id}><span className={styles.eyebrow}>{observation.kind.replaceAll('_',' ')}</span><h3>{observation.title}</h3><p>{observation.text}</p><ul>{observation.citationIds.map(id => {const cite = sidecar.citations.find(item => item.id === id)!;const local = localCitation(cite.sourceKey,bundle,scope!);return <li key={id}>{cite.label}: {local.value ?? 'Unknown'} · {local.status}</li>})}</ul></article>)}</div>
      <details><summary>Interpretation provenance</summary><dl className={styles.metadata}><dt>Provider / model</dt><dd>{sidecar.provenance.provider} / {sidecar.provenance.model}</dd><dt>Prompt version</dt><dd>{sidecar.provenance.promptVersion}</dd><dt>Generated</dt><dd>{sidecar.provenance.generatedAt}</dd><dt>Scope</dt><dd>{sidecar.provenance.scopeKey}</dd><dt>Report digest</dt><dd className={styles.digest}>{sidecar.provenance.reportDigest}</dd><dt>Input digest</dt><dd className={styles.digest}>{sidecar.provenance.inputDigest}</dd></dl></details>
    </>}
  </details>
}
