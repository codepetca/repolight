import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SavedReportWorkspace } from '@/components/SavedReportWorkspace'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import type { AnalysisResult, AnalysisStatus, FeedbackEdit } from '@/lib/service/contract'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

const firstId = '10000000-0000-4000-8000-000000000001'
const secondId = '10000000-0000-4000-8000-000000000002'
const timestamp = '2026-10-24T18:00:00.000Z'
const response = (payload: unknown, status = 200) => ({ok:status < 400,status,json:async()=>payload})
const failure = (code: string, status: number) => response({error:{code}},status)
function status(id = firstId, state: AnalysisStatus['status'] = 'succeeded'): AnalysisStatus {
  return {schemaVersion:'1.0',analysisId:id,status:state,requestFingerprint:'a'.repeat(64),clientBinding:null,attemptCount:1,nextAttemptAt:null,createdAt:timestamp,completedAt:state === 'succeeded' || state === 'failed' ? timestamp : null,reportRef:state === 'succeeded' ? id : null,error:state === 'failed' ? {code:'upstream_timeout',retryable:false} : null}
}
function result(id = firstId): AnalysisResult {
  const input = skyHopInput()
  const bundle = buildPublicRepositoryBundle({bundleRef:id,settings:{repositoryUrl:input.repositoryUrl,branch:input.branch,period:input.period,scheduledProjectDates:input.scheduledProjectDates,exclusions:input.exclusions,baselineReviewed:true},evidence:{target:makeRepositoryTarget(input.repositoryUrl,input.branch)!,snapshot:input.snapshot,coverage:input.coverage,events:input.events}})
  return {schemaVersion:'1.0',analysisId:id,requestFingerprint:'a'.repeat(64),clientBinding:null,reportRef:id,reportDigest:'b'.repeat(64),bundle}
}
const edit = (id: string, text: string, revision = 3, scopeKey = 'repository'): FeedbackEdit => ({reportRef:id,scopeKey,text,revision,updatedAt:timestamp})
function fixtureFetch(overrides?: (path: string, options: RequestInit) => unknown | Promise<unknown>) {
  const fetchMock = vi.fn(async (path: string, options: RequestInit = {}) => {
    const override = await overrides?.(path,options)
    if (override !== undefined) return override
    if (path === '/api/v2/workspace') return response({workspace:{id:'fixture-workspace',customerRef:'fixture-customer'}})
    if (path === '/api/v2/analyses') return response({analyses:[status()]})
    if (path === `/api/v2/analyses/${firstId}`) return response(status())
    if (path === `/api/v2/analyses/${firstId}/result`) return response(result())
    if (path === `/api/v2/analyses/${firstId}/edits`) return response({edits:[edit(firstId,'Saved overview feedback.')]})
    if (path === '/api/v2/workspace/keys') return response({keys:[]})
    throw new Error(`Unexpected fixture request: ${path}`)
  })
  vi.stubGlobal('fetch',fetchMock)
  return fetchMock
}
async function openFirst() {
  fireEvent.click(await screen.findByRole('button',{name:'Open 10000000'}))
  await screen.findByRole('heading',{name:'Repository overview'})
}
const teacherText = () => (screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement).value

afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()})

describe('SavedReportWorkspace',()=>{
  it('initializes a missing workspace only after an explicit action',async()=>{
    let initialized = false
    const fetchMock = fixtureFetch((path,options)=>{
      if (path === '/api/v2/workspace' && options?.method === 'POST') {initialized = true;return response({workspace:{id:'fixture-workspace',customerRef:'fixture-customer'}},201)}
      if (path === '/api/v2/workspace' && !initialized) return failure('unauthorized',401)
    })
    render(<SavedReportWorkspace />)
    const initialize = await screen.findByRole('button',{name:'Create report workspace'})
    expect(fetchMock.mock.calls.some(([,options])=>options?.method === 'POST')).toBe(false)
    expect(screen.queryByRole('button',{name:'Analyze public repository'})).toBeNull()
    fireEvent.click(initialize)
    await screen.findByRole('button',{name:'Analyze public repository'})
    expect(fetchMock.mock.calls.find(([path,options])=>path === '/api/v2/workspace' && options?.method === 'POST')?.[1]?.body).toBe('{}')
  })

  it('queues with an idempotency key, polls status with backoff and stops after success',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    let polls = 0
    const fetchMock = fixtureFetch((path,options)=>{
      if (path === '/api/v2/analyses' && options?.method === 'POST') return response(status(firstId,'queued'),202)
      if (path === `/api/v2/analyses/${firstId}`) return response(status(firstId,++polls < 2 ? 'running' : 'succeeded'))
    })
    await act(async()=>{render(<SavedReportWorkspace />)})
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:'https://github.com/sample-student/sky-hop'}})
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))})
    expect(screen.getByText(/Selected analysis: running/)).toBeTruthy()
    const create = fetchMock.mock.calls.find(([path,options])=>path === '/api/v2/analyses' && options?.method === 'POST')!
    expect(JSON.parse(String(create[1]?.body))).toMatchObject({schemaVersion:'1.0',request:{repositoryUrl:'https://github.com/sample-student/sky-hop'}})
    expect(JSON.parse(String(create[1]?.body)).request).not.toHaveProperty('githubUsername')
    expect((create[1]?.headers as Record<string,string>)['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/)
    expect(fetchMock.mock.calls.some(([path])=>path === '/api/reports/repository')).toBe(false)
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500)})
    expect(screen.getByRole('heading',{name:'Repository overview'})).toBeTruthy()
    expect(teacherText()).toBe('Saved overview feedback.')
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000)})
    expect(polls).toBe(2)
  })

  it('reopens a stored result, isolates local scope edits and uses revision checks without overwriting on conflict',async()=>{
    let saves = 0
    const fetchMock = fixtureFetch((path,options)=>{
      if (path.endsWith('/edits') && options?.method === 'PUT') {
        const body = JSON.parse(String(options?.body))
        return ++saves === 1 ? response({edit:edit(firstId,body.text,4,body.scopeKey)}) : failure('conflict',409)
      }
    })
    render(<SavedReportWorkspace />)
    await openFirst()
    expect(teacherText()).toBe('Saved overview feedback.')
    fireEvent.change(screen.getByLabelText('Teacher feedback'),{target:{value:'Local overview edit.'}})
    fireEvent.click(screen.getByRole('button',{name:'View @sample-student'}))
    expect(teacherText()).not.toBe('Local overview edit.')
    fireEvent.change(screen.getByLabelText('Teacher feedback'),{target:{value:'Local contributor edit.'}})
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'repository'}})
    expect(teacherText()).toBe('Local overview edit.')
    fireEvent.click(screen.getByRole('button',{name:'Save feedback'}))
    await screen.findByText('Feedback saved.')
    fireEvent.change(screen.getByLabelText('Teacher feedback'),{target:{value:'Keep my conflicting edit.'}})
    fireEvent.click(screen.getByRole('button',{name:'Save feedback'}))
    await screen.findByText(/Feedback changed in another session/)
    expect(teacherText()).toBe('Keep my conflicting edit.')
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'contributor:github-sample-student'}})
    expect(teacherText()).toBe('Local contributor edit.')
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'repository'}})
    expect(teacherText()).toBe('Keep my conflicting edit.')
    const writes = fetchMock.mock.calls.filter(([,options])=>options?.method === 'PUT').map(([,options])=>JSON.parse(String(options?.body)))
    expect(writes).toEqual([{scopeKey:'repository',expectedRevision:3,text:'Local overview edit.'},{scopeKey:'repository',expectedRevision:4,text:'Keep my conflicting edit.'}])
  })

  it.each(['job','fingerprint','source binding'])('rejects a result with a mismatched %s before displaying its bundle',async mismatch=>{
    const wrong = result(mismatch === 'job' ? secondId : firstId)
    if (mismatch === 'fingerprint') wrong.requestFingerprint = 'c'.repeat(64)
    if (mismatch === 'source binding') wrong.clientBinding = {installationRef:'another-installation',subjectRef:'another-subject',sourceRevisionRef:'another-source'}
    fixtureFetch(path=>path.endsWith('/result') ? response(wrong) : undefined)
    render(<SavedReportWorkspace />)
    fireEvent.click(await screen.findByRole('button',{name:'Open 10000000'}))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('does not match the selected analysis')
    expect(screen.queryByRole('heading',{name:'Repository overview'})).toBeNull()
  })

  it('ignores an older asynchronous result after another saved analysis is selected',async()=>{
    let release: ((value: unknown)=>void) | undefined
    fixtureFetch(path=>{
      if (path === '/api/v2/analyses') return response({analyses:[status(),status(secondId)]})
      if (path === `/api/v2/analyses/${firstId}/result`) return new Promise(resolve=>{release = resolve})
      if (path === `/api/v2/analyses/${secondId}`) return response(status(secondId))
      if (path === `/api/v2/analyses/${secondId}/result`) return response(result(secondId))
      if (path === `/api/v2/analyses/${secondId}/edits`) return response({edits:[edit(secondId,'Second saved report.')]})
    })
    render(<SavedReportWorkspace />)
    const buttons = await screen.findAllByRole('button',{name:'Open 10000000'})
    fireEvent.click(buttons[0])
    await waitFor(()=>expect(release).toBeTypeOf('function'))
    fireEvent.click(buttons[1])
    await screen.findByDisplayValue('Second saved report.')
    await act(async()=>{release!(response(result()))})
    expect(teacherText()).toBe('Second saved report.')
  })

  it('keeps queue admission errors visible when submitting from an opened report',async()=>{
    fixtureFetch((path,options)=>path === '/api/v2/analyses' && options?.method === 'POST' ? failure('queue_limit',429) : undefined)
    render(<SavedReportWorkspace />)
    await openFirst()
    fireEvent.click(screen.getByRole('button',{name:'Analyze another repository'}))
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:'https://github.com/sample-student/sky-hop'}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('workspace queue is full')
    expect(screen.queryByRole('heading',{name:'Repository overview'})).toBeNull()
  })

  it('shows terminal failures and cancels queued polling when unmounted',async()=>{
    fixtureFetch(path=>path === `/api/v2/analyses/${firstId}` ? response(status(firstId,'failed')) : undefined)
    const rendered = render(<SavedReportWorkspace />)
    fireEvent.click(await screen.findByRole('button',{name:'Open 10000000'}))
    await screen.findByText(/Analysis failed: upstream timeout/)
    expect(screen.queryByRole('heading',{name:'Repository overview'})).toBeNull()
    rendered.unmount()
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    const fetchMock = fixtureFetch(path=>path === `/api/v2/analyses/${firstId}` ? response(status(firstId,'queued')) : undefined)
    let pending: ReturnType<typeof render>
    await act(async()=>{pending = render(<SavedReportWorkspace />)})
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Open 10000000'}))})
    const count = fetchMock.mock.calls.length
    pending!.unmount()
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000)})
    expect(fetchMock.mock.calls).toHaveLength(count)
  })

  it('keeps integration tokens temporary and supports list, copy and revoke',async()=>{
    const key = {id:'20000000-0000-4000-8000-000000000001',label:'Fixture integration',scopes:['analyses:create','analyses:read'],installationRef:'fixture-school',expiresAt:null,revokedAt:null,createdAt:timestamp}
    let revoked = false
    let issued = false
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}})
    const fetchMock = fixtureFetch((path,options)=>{
      if (path === '/api/v2/workspace/keys' && options?.method === 'POST') {issued = true;return response({key,token:'fixture-only-secret-token'},201)}
      if (path === '/api/v2/workspace/keys') return response({keys:revoked ? [{...key,revokedAt:timestamp}] : issued ? [key] : []})
      if (path === `/api/v2/workspace/keys/${key.id}`) {revoked = true;return response({revoked:true})}
    })
    render(<SavedReportWorkspace />)
    await screen.findByRole('button',{name:'Analyze public repository'})
    const details = screen.getByText('Integration keys').closest('details')!
    expect(details.open).toBe(false)
    await act(async()=>{details.open = true;fireEvent(details,new Event('toggle'))})
    fireEvent.change(screen.getByLabelText('Key label'),{target:{value:'Fixture integration'}})
    fireEvent.change(screen.getByLabelText('Installation reference (optional)'),{target:{value:'fixture-school'}})
    fireEvent.submit(screen.getByLabelText('Key label').closest('form')!)
    await screen.findByDisplayValue('fixture-only-secret-token')
    fireEvent.click(screen.getByRole('button',{name:'Copy integration key'}))
    await waitFor(()=>expect(copy).toHaveBeenCalledWith('fixture-only-secret-token'))
    await act(async()=>{details.open = false;fireEvent(details,new Event('toggle'))})
    expect(screen.queryByDisplayValue('fixture-only-secret-token')).toBeNull()
    await act(async()=>{details.open = true;fireEvent(details,new Event('toggle'))})
    expect(screen.queryByDisplayValue('fixture-only-secret-token')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Revoke Fixture integration'}))
    await screen.findByText(/Fixture integration · Revoked/)
    const create = fetchMock.mock.calls.find(([path,options])=>path === '/api/v2/workspace/keys' && options?.method === 'POST')!
    expect(JSON.parse(String(create[1]?.body))).toEqual({label:'Fixture integration',installationRef:'fixture-school',scopes:['analyses:create','analyses:read']})
    expect(localStorage.length).toBe(0)
  })
  it('requires an installation and explicit opt-in for Pika report cleanup permission',async()=>{
    const fetchMock = fixtureFetch((path,options)=>{
      if (path === '/api/v2/workspace/keys' && options.method === 'POST') return response({key:{id:secondId,label:'Pika',scopes:['analyses:create','analyses:read','analyses:erase'],installationRef:'pika-fixture',expiresAt:null,revokedAt:null,createdAt:timestamp},token:'fixture-only-cleanup-token'},201)
    })
    render(<SavedReportWorkspace />)
    await screen.findByRole('button',{name:'Open 10000000'})
    const details = screen.getByText('Integration keys').closest('details')!
    await act(async()=>{details.open = true;fireEvent(details,new Event('toggle'))})
    const optIn = screen.getByRole('checkbox',{name:'Allow Pika to remove its report copies'}) as HTMLInputElement
    expect(optIn.checked).toBe(false)
    fireEvent.click(optIn)
    expect((screen.getByLabelText('Installation reference (required for Pika cleanup)') as HTMLInputElement).required).toBe(true)
    fireEvent.change(screen.getByLabelText('Key label'),{target:{value:'Pika'}})
    fireEvent.change(screen.getByLabelText('Installation reference (required for Pika cleanup)'),{target:{value:'pika-fixture'}})
    fireEvent.submit(screen.getByLabelText('Key label').closest('form')!)
    await screen.findByDisplayValue('fixture-only-cleanup-token')
    const issued = fetchMock.mock.calls.find(([path,options])=>path === '/api/v2/workspace/keys' && options?.method === 'POST')!
    expect(JSON.parse(String(issued[1]?.body))).toEqual({label:'Pika',installationRef:'pika-fixture',scopes:['analyses:create','analyses:read','analyses:erase']})
  })
})
