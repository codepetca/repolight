import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportInterpretation } from '@/components/ReportInterpretation'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import type { InterpretationResponse } from '@/lib/interpretation/contract'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

const id = '10000000-0000-4000-8000-000000000001'
const digest = 'b'.repeat(64)
const input = skyHopInput()
const bundle = buildPublicRepositoryBundle({bundleRef:id,settings:{repositoryUrl:input.repositoryUrl,branch:input.branch,period:input.period,scheduledProjectDates:input.scheduledProjectDates,exclusions:input.exclusions,baselineReviewed:true},evidence:{target:makeRepositoryTarget(input.repositoryUrl,input.branch)!,snapshot:input.snapshot,coverage:input.coverage,events:input.events}})
const response = (payload: unknown, status = 200) => ({ok:status < 400,status,json:async()=>payload})
const reply = (overrides: Partial<InterpretationResponse> = {}): InterpretationResponse => ({schemaVersion:'1.0',enabled:true,state:'not_requested',scopeKey:'repository',requestId:null,interpretation:null,error:null,...overrides})
function available(enabled = true): InterpretationResponse {
  return reply({enabled,state:'available',interpretation:{schemaVersion:'1.0',provenance:{provider:'openai',model:'fixture-model',promptVersion:'1.0.0',inputDigest:'a'.repeat(64),reportDigest:digest,scopeKey:'repository',generatedAt:'2026-10-24T18:00:00.000Z'},observations:[{id:'observation-1',kind:'review_question',title:'Review activity',text:'Review the measured activity with the student.',citationIds:['c1']}],citations:[{id:'c1',label:'Included commits',sourceKey:'metrics.commits',value:bundle.overview.facts.metrics.commits.value,status:bundle.overview.facts.metrics.commits.status}]}})
}
const panel = (scopeKey = 'repository') => <ReportInterpretation analysisId={id} reportDigest={digest} bundle={bundle} scopeKey={scopeKey} />
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()})

describe('ReportInterpretation',()=>{
  it('hides disabled empty state and never posts from mount',async()=>{
    const fetchMock = vi.fn(async()=>response(reply({enabled:false,state:'disabled'})))
    vi.stubGlobal('fetch',fetchMock)
    const {container} = render(panel())
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async()=>{})
    expect(container.textContent).toBe('')
    expect(fetchMock.mock.calls[0]).toEqual(expect.arrayContaining([expect.any(String),expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store'})]))
  })
  it('generates only on explicit action and displays locally checked citations and provenance',async()=>{
    const fetchMock = vi.fn(async(_path:string,options:RequestInit)=>response(options.method === 'POST' ? {...available(),requestId:JSON.parse(options.body as string).requestId} : reply()))
    vi.stubGlobal('fetch',fetchMock)
    render(panel())
    const generate = await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('AI interpretation · optional teacher review'))
    expect(screen.getByText(/Sends selected measured facts to OpenAI/)).toBeTruthy()
    fireEvent.click(generate)
    await screen.findByText('Review the measured activity with the student.')
    const post = fetchMock.mock.calls.find(([,options])=>options.method === 'POST')!
    expect(JSON.parse(post[1].body as string)).toEqual({schemaVersion:'1.0',scopeKey:'repository',requestId:expect.stringMatching(/^[a-f0-9-]{36}$/)})
    expect(screen.getByText(`Included commits: ${bundle.overview.facts.metrics.commits.value} · ${bundle.overview.facts.metrics.commits.status}`)).toBeTruthy()
    expect(screen.getByText('openai / fixture-model')).toBeTruthy()
    expect(screen.queryByRole('button',{name:/apply|import/i})).toBeNull()
  })
  it('reads a stored result while generation is paused',async()=>{
    const fetchMock=vi.fn(async()=>response(available(false)));vi.stubGlobal('fetch',fetchMock)
    render(panel())
    await screen.findByText('Review the measured activity with the student.')
    expect(screen.queryByRole('button',{name:/Generate/})).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('ignores a late prior-scope read after navigation',async()=>{
    let resolve!: (value:unknown)=>void
    const old = new Promise(resolvePromise=>{resolve=resolvePromise})
    const nextScope = `contributor:${bundle.contributors[0].contributor.id}`
    const fetchMock=vi.fn(async(path:string)=>path.endsWith('=repository') ? old : response(reply({scopeKey:nextScope})))
    vi.stubGlobal('fetch',fetchMock)
    const view=render(panel());view.rerender(panel(nextScope))
    await screen.findByText('AI interpretation · optional teacher review')
    await act(async()=>{resolve(response(available()))})
    expect(screen.queryByText('Review the measured activity with the student.')).toBeNull()
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  it('ignores a late generation response after changing the selected report scope',async()=>{
    let finish!: (value:unknown)=>void
    const pending = new Promise(resolve=>{finish=resolve})
    const nextScope = `contributor:${bundle.contributors[0].contributor.id}`
    vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit)=>options.method === 'POST' ? pending : response(reply({scopeKey:path.endsWith('=repository') ? 'repository' : nextScope}))))
    const view=render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    view.rerender(panel(nextScope))
    await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true})
    await act(async()=>{finish(response(available()))})
    expect(screen.queryByText('Review the measured activity with the student.')).toBeNull()
  })
  it('times out an uncertain POST without automatically retrying or losing its intent',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    const ids:string[]=[]
    const fetchMock=vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') return response(reply())
      ids.push(JSON.parse(options.body as string).requestId)
      return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(new Error('aborted'))))
    })
    vi.stubGlobal('fetch',fetchMock)
    await act(async()=>{render(panel())})
    fireEvent.click(screen.getByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await act(async()=>{await vi.advanceTimersByTimeAsync(35000)})
    expect(screen.getByText(/timed out/)).toBeTruthy()
    expect(ids).toHaveLength(1)
    fireEvent.click(screen.getByRole('button',{name:'Retry interpretation request',hidden:true}))
    expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
  })
  it('rejects mismatched digest and measured citation values',async()=>{
    const wrong=available();wrong.interpretation!.citations[0].value=99999
    vi.stubGlobal('fetch',vi.fn(async()=>response(wrong)))
    render(panel())
    await screen.findByText(/does not match this report view/)
    expect(screen.queryByText('Review the measured activity with the student.')).toBeNull()
    cleanup()
    wrong.interpretation!.provenance.reportDigest='c'.repeat(64)
    render(panel())
    await screen.findByText(/does not match this report view/)
    expect(screen.queryByText('Review the measured activity with the student.')).toBeNull()
  })
  it('keeps request id for uncertain explicit retry, then uses a new intent after cached failure',async()=>{
    const ids:string[]=[]
    let posts=0
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') return response(reply())
      ids.push(JSON.parse(options.body as string).requestId)
      if(++posts === 1) throw new Error('Connection interrupted. Your report and feedback are unchanged.')
      return response(reply({state:'failed',error:'provider_timeout',requestId:ids.at(-1)!}))
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText(/Connection interrupted/)
    fireEvent.click(screen.getByRole('button',{name:'Retry interpretation request',hidden:true}))
    await screen.findByText(/could not be generated/)
    fireEvent.click(screen.getByRole('button',{name:'Retry AI interpretation',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(3))
    expect(ids[0]).toBe(ids[1]);expect(ids[2]).not.toBe(ids[1])
  })
  it.each(['available','failed'] as const)('preserves an uncertain intent when progress returns an older %s request',async oldState=>{
    const oldId='10000000-0000-4000-8000-000000000099'
    const older = {...available(),requestId:oldId}
    const ids:string[]=[]
    let reads=0
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') {
        if(++reads === 1) return response(older)
        return response(oldState === 'available' ? older : reply({state:'failed',error:'provider_timeout',requestId:oldId}))
      }
      ids.push(JSON.parse(options.body as string).requestId)
      if(ids.length === 1) throw new Error('Connection interrupted.')
      return response({...available(),requestId:ids.at(-1)!})
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate new interpretation',hidden:true}))
    await screen.findByText('Connection interrupted.')
    fireEvent.click(screen.getByRole('button',{name:'Check interpretation progress',hidden:true}))
    await screen.findByText(/does not confirm the current request/)
    fireEvent.click(screen.getByRole('button',{name:'Retry interpretation request',hidden:true}))
    await screen.findByRole('button',{name:'Generate new interpretation',hidden:true})
    expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
    // A matching terminal reply released the intent, so this is a new explicit generation.
    fireEvent.click(screen.getByRole('button',{name:'Generate new interpretation',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(3))
    expect(ids[2]).not.toBe(ids[1])
  })
  it('polls only reads for its matching pending intent and releases it after matching terminal progress',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    const ids:string[]=[]
    let progress=0
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method === 'POST') {
        ids.push(JSON.parse(options.body as string).requestId)
        return response(reply({state:'pending',requestId:ids.at(-1)!}))
      }
      if(!ids.length) return response(reply())
      return response(reply({requestId:ids.at(-1)!,state:++progress === 1 ? 'pending' : 'failed',error:progress === 1 ? null : 'provider_timeout'}))
    }))
    await act(async()=>{render(panel())})
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Generate AI interpretation',hidden:true}))})
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500)})
    expect(ids).toHaveLength(1);expect(progress).toBe(1)
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000)})
    expect(progress).toBe(2);expect(ids).toHaveLength(1)
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Retry AI interpretation',hidden:true}))})
    expect(ids).toHaveLength(2);expect(ids[0]).not.toBe(ids[1])
  })
  it('accepts generation paused between the initial read and explicit POST without an uncertain intent',async()=>{
    const ids:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') return response(reply())
      ids.push(JSON.parse(options.body as string).requestId)
      return response(reply({enabled:false,state:'disabled'}))
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText(/AI interpretation is paused/)
    expect(screen.queryByText(/does not match the requested interpretation/)).toBeNull()
    expect(screen.queryByRole('button',{name:/Generate|Retry interpretation request/,hidden:true})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Check interpretation progress',hidden:true}))
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(2))
    expect(ids[0]).not.toBe(ids[1])
  })
  it('shows a documented configuration-unavailable nonadmission and starts a fresh explicit retry',async()=>{
    const ids:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') return response(reply())
      ids.push(JSON.parse(options.body as string).requestId)
      return response(reply({state:'failed',error:'configuration_unavailable'}))
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText(/could not be generated \(configuration unavailable\)/)
    expect(screen.queryByText(/does not match the requested interpretation/)).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Retry AI interpretation',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(2))
    expect(ids[0]).not.toBe(ids[1])
  })
  it.each(['available','pending'] as const)('rejects a null request id for an admitted %s response',async state=>{
    const ids:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') return response(reply())
      ids.push(JSON.parse(options.body as string).requestId)
      return response(state === 'available' ? available() : reply({state:'pending'}))
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText(/does not match the requested interpretation/)
    fireEvent.click(screen.getByRole('button',{name:'Retry interpretation request',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(2))
    expect(ids[0]).toBe(ids[1])
  })
  it.each(['available','pending','network_error'] as const)('allows same-UUID replay after pending progress returns another %s request',async otherState=>{
    const ids:string[]=[]
    const otherId='10000000-0000-4000-8000-000000000099'
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method === 'POST') {
        ids.push(JSON.parse(options.body as string).requestId)
        return response(ids.length === 1 ? reply({state:'pending',requestId:ids[0]}) : {...available(),requestId:ids.at(-1)!})
      }
      if(!ids.length) return response(reply())
      if(otherState === 'network_error') throw new Error('Progress could not be read.')
      return response(otherState === 'available' ? {...available(),requestId:otherId} : reply({state:'pending',requestId:otherId}))
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText('AI interpretation is pending.')
    expect((screen.getByRole('button',{name:'Retry interpretation request',hidden:true}) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button',{name:'Check interpretation progress',hidden:true}))
    await screen.findByText(otherState === 'network_error' ? 'Progress could not be read.' : /does not confirm the current request/)
    const replay=screen.getByRole('button',{name:'Retry interpretation request',hidden:true}) as HTMLButtonElement
    expect(replay.disabled).toBe(false)
    fireEvent.click(replay)
    await screen.findByRole('button',{name:'Generate new interpretation',hidden:true})
    expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1])
    fireEvent.click(screen.getByRole('button',{name:'Generate new interpretation',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(3))
    expect(ids[2]).not.toBe(ids[1])
  })
  it('rejects a POST reply for another request and retains its exact retry intent',async()=>{
    const ids:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
      if(options.method !== 'POST') return response(reply())
      ids.push(JSON.parse(options.body as string).requestId)
      return response({...available(),requestId:'10000000-0000-4000-8000-000000000099'})
    }))
    render(panel())
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText(/does not match the requested interpretation/)
    expect(screen.queryByText('Review the measured activity with the student.')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Retry interpretation request',hidden:true}))
    await waitFor(()=>expect(ids).toHaveLength(2))
    expect(ids[0]).toBe(ids[1])
  })
  it('preserves scoped teacher drafts through AI failure and evidence navigation; public preview makes no requests',async()=>{
    const fetchMock=vi.fn(async(_path:string,options:RequestInit)=> options.method==='POST' ? response({error:{code:'forbidden'}},403) : response(reply()))
    vi.stubGlobal('fetch',fetchMock)
    const view=render(<PublicReportWorkspace initialBundle={bundle} />)
    expect(fetchMock).not.toHaveBeenCalled()
    view.unmount()
    render(<PublicReportWorkspace initialBundle={bundle} savedInterpretation={{analysisId:id,reportDigest:digest}} />)
    fireEvent.change(screen.getByLabelText('Teacher feedback'),{target:{value:'Keep this teacher draft.'}})
    fireEvent.click(await screen.findByRole('button',{name:'Generate AI interpretation',hidden:true}))
    await screen.findByText(/AI interpretation is unavailable/)
    expect((screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement).value).toBe('Keep this teacher draft.')
    expect(screen.queryByRole('button',{name:'Generate AI interpretation',hidden:true})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    fireEvent.click(screen.getByRole('button',{name:'Return to summary & feedback'}))
    expect((screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement).value).toBe('Keep this teacher draft.')
  })
  it('bounds pending GET polling and never automatically posts',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
    const fetchMock=vi.fn(async()=>response(reply({state:'pending',requestId:'10000000-0000-4000-8000-000000000002'})))
    vi.stubGlobal('fetch',fetchMock)
    await act(async()=>{render(panel())})
    await act(async()=>{await vi.advanceTimersByTimeAsync(120000)})
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(screen.getByText(/Check progress later/)).toBeTruthy()
    expect(fetchMock.mock.calls.every(call=>(call as unknown as [string,RequestInit])[1].method==='GET')).toBe(true)
  })
})
