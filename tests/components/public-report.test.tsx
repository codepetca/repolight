import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'
import type { PublicRepositoryBundle } from '@/lib/report/bundle-contract'
import type { RepositoryReport } from '@/lib/report/contract'
import { buildRepositoryReport } from '@/lib/report/build'
import { buildRuleFeedback } from '@/lib/report/rules'
import { calculateScopeFacts } from '@/lib/report/calculations'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

function bundleFromReport(report: RepositoryReport): PublicRepositoryBundle {
  const { metricsVersion, repository, snapshot, period, scheduledProjectDates, baseline, exclusions } = report
  const coverage = {...report.coverage, notes:report.coverage.notes.filter(note => !note.includes('matched commit(s) have no author date'))}
  const {commits} = report
  const facts = calculateScopeFacts({...report,repositoryUrl:repository.url,branch:repository.branch,coverage,events:[]},commits)
  const ruleFeedback = {...buildRuleFeedback(report), rulesVersion: '1.1.0' as const}
  return {
    schemaVersion:'1.0', bundleRef:report.reportRef, context:{metricsVersion, repository, snapshot, period, scheduledProjectDates, baseline, exclusions}, collectionCoverage:coverage,
    selection:{requestedGithubLogin:null,status:'not_requested',contributorId:null,notice:'No GitHub username supplied. Showing the repository overview.'},
    overview:{scope:{kind:'repository'}, facts, ruleFeedback},
    contributors: commits.length ? [{contributor:{id:'sample',kind:'github_account',githubLogin:'sample-student',label:'sample-student',accountType:'user'},analysis:{scope:{kind:'contributor',contributorId:'sample'},facts:structuredClone(facts),ruleFeedback:{...structuredClone(ruleFeedback), feedbackDraft:'Contributor-specific draft.'}}}] : [],
  }
}

function multiContributorBundle() {
  const input = skyHopInput()
  const bundle = bundleFromReport(buildRepositoryReport(input))
  const descriptors: PublicRepositoryBundle['contributors'][number]['contributor'][] = [
    {id:'sample',kind:'github_account',githubLogin:'sample-student',label:'sample-student',accountType:'user'},
    {id:'bot',kind:'github_account',githubLogin:'helper-bot',label:'helper-bot',accountType:'bot'},
    {id:'unlinked',kind:'unlinked_email',githubLogin:null,label:'Unlinked author 1',accountType:'unknown'},
    {id:'unknown',kind:'unknown_author',githubLogin:null,label:'Unknown authors',accountType:'unknown'},
  ]
  bundle.contributors = descriptors.map((contributor, index) => {
    const report = buildRepositoryReport({...input,events:input.events.slice(index * 3, index * 3 + 3)})
    const analysis = bundleFromReport(report).overview
    for (const commit of analysis.facts.commits) commit.githubLogin = contributor.githubLogin
    for (const commit of bundle.overview.facts.commits.slice(index * 3, index * 3 + 3)) commit.githubLogin = contributor.githubLogin
    return {contributor,analysis:{...analysis,scope:{kind:'contributor',contributorId:contributor.id},ruleFeedback:{...analysis.ruleFeedback,feedbackDraft:`Original draft for ${contributor.id}.`}}}
  })
  return bundle
}

function mockBundle(bundle: PublicRepositoryBundle) {
  const fetchMock = vi.fn().mockResolvedValue({ok:true,json:async()=>bundle})
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function submitSample() {
  const report = buildRepositoryReport(skyHopInput())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>bundleFromReport(report)}))
  fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:'https://github.com/sample-student/sky-hop'}})
  fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
  await screen.findByRole('heading',{name:'sample-student/sky-hop'})
}

describe('PublicReportWorkspace', () => {
  it('keeps dated heatmap gaps unknown when complete file evidence includes an undated commit', async () => {
    const input = skyHopInput()
    input.events[0].authoredAt = undefined
    const report = buildRepositoryReport(input)
    expect(report.heatmap.status).toBe('available')
    expect(report.activity.undatedCommitCount).toBe(1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>bundleFromReport(report)}))
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:input.repositoryUrl}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Workflow findings'})
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    expect(screen.getByText(/Missing cells are unknown/)).toBeTruthy()
    const table = screen.getByRole('table',{name:/Observed file changes/}) as HTMLTableElement
    const row = Array.from(table.tBodies[0].rows).find(row => row.cells[0].textContent === 'Main.java')!
    const column = Array.from(table.tHead!.rows[0].cells).findIndex(cell => cell.title === '2026-10-05')
    expect(row.cells[column].textContent).toBe('?')
    const observedColumn = Array.from(table.tHead!.rows[0].cells).findIndex(cell => cell.title === '2026-10-06')
    expect(row.cells[observedColumn].textContent).toBe('14')
    const gapColumn = Array.from(table.tHead!.rows[0].cells).findIndex(cell => cell.title === '2026-10-07')
    expect(row.cells[gapColumn].textContent).toBe('?')
    expect(row.cells[gapColumn].title).toContain('unknown')
  })

  it('starts with a compact form, main branch and a browser-local 60-day period', async () => {
    vi.useFakeTimers({toFake:['Date']})
    vi.setSystemTime(new Date('2026-10-22T01:00:00Z'))
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions
    vi.spyOn(Intl.DateTimeFormat.prototype,'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {return {...resolved.call(this),timeZone:'Pacific/Auckland'}})
    const input = skyHopInput()
    const report = buildRepositoryReport(input)
    const fetchMock = vi.fn().mockResolvedValue({ok:true,json:async()=>bundleFromReport(report)})
    vi.stubGlobal('fetch',fetchMock)
    render(<PublicReportWorkspace />)
    expect(screen.getByRole('heading',{name:'Analyze a repository'})).toBeTruthy()
    expect(screen.queryByRole('button',{name:'Explore fictional demo'})).toBeNull()
    expect(screen.queryByText(/Database-free preview/)).toBeNull()
    const options = screen.getByText('Options').closest('details')!
    expect(options.open).toBe(false)
    expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe('Pacific/Auckland')
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-08-24')
    expect((screen.getByLabelText('End date (inclusive)') as HTMLInputElement).value).toBe('2026-10-22')
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:input.repositoryUrl}})
    expect((screen.getByLabelText('GitHub username (optional)') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Workflow findings'})
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request).not.toHaveProperty('githubUsername')
    expect(request).not.toHaveProperty('commitEmails')
    expect(request).toMatchObject({branch:'main',period:{timezone:'Pacific/Auckland',startAt:'2026-08-23T12:00:00.000Z',endAt:'2026-10-22T11:00:00.000Z'}})
  })

  it('never autofills an owner and preserves an explicitly entered username', () => {
    render(<PublicReportWorkspace />)
    const repo = screen.getByLabelText('Public GitHub repository')
    const student = screen.getByLabelText('GitHub username (optional)') as HTMLInputElement
    fireEvent.change(repo,{target:{value:'https://github.com/alice/project'}})
    expect(student.value).toBe('')
    fireEvent.change(repo,{target:{value:'https://github.com/bob/project'}})
    expect(student.value).toBe('')
    fireEvent.change(student,{target:{value:'actual-student'}})
    fireEvent.change(repo,{target:{value:'https://github.com/school-org/assignment'}})
    expect(student.value).toBe('actual-student')
  })

  it('falls back to Toronto when browser timezone detection is unavailable', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype,'resolvedOptions').mockImplementation(() => {throw new Error('unavailable')})
    render(<PublicReportWorkspace />)
    expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe('America/Toronto')
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('exposes submitted evidence and keeps teacher edits separate', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    render(<PublicReportWorkspace />)
    await submitSample()
    expect(screen.getByRole('heading',{name:'sample-student/sky-hop'})).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Repository commits' })).toBeTruthy()
    expect(screen.getByRole('heading', {name:'Workflow findings'})).toBeTruthy()
    expect(screen.getByRole('heading', {name:'Limitations'})).toBeTruthy()
    expect(screen.getByText('Generic-message share')).toBeTruthy()
    expect(screen.getByText('33% · 4 / 12 messages')).toBeTruthy()
    expect(screen.queryByRole('table', {name:'Commit evidence'})).toBeNull()
    const feedback = screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement
    const original = buildRuleFeedback(buildRepositoryReport(skyHopInput())).feedbackDraft
    expect(feedback.value).toBe(original)
    fireEvent.change(feedback, { target: { value: 'My reviewed feedback.' } })
    fireEvent.click(screen.getByRole('button', {name:'View evidence'}))
    expect(screen.getByRole('table', { name: 'Commit evidence' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter file paths'), {target:{value:'Player.java'}})
    const fileTable = screen.getByRole('table', {name:/Observed file changes/}) as HTMLTableElement
    expect(fileTable.tBodies[0].rows).toHaveLength(1)
    expect(fileTable.tBodies[0].rows[0].cells[0].textContent).toBe('Player.java')
    const timeline = screen.getByRole('table', { name: 'Observed commits by local date', hidden: true }) as HTMLTableElement
    expect(timeline.tBodies[0].rows.length).toBe(12)
    const emptyDate = Array.from(timeline.tBodies[0].rows).find(row => row.cells[0].textContent === '2026-10-07')!
    expect(emptyDate.cells[1].textContent).toBe('0')
    expect(screen.getByText(/Commit time is not push time/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name:'Back to summary'}))
    expect((screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement).value).toBe('My reviewed feedback.')
    fireEvent.click(screen.getByRole('button', { name: 'Copy feedback' }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith('My reviewed feedback.'))
    fireEvent.click(screen.getByRole('button', { name: 'Restore rule draft' }))
    expect((screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement).value).toBe(original)
  })

  it('submits the explicit inclusive period and displays unavailable data without false zeros', async () => {
    const input = skyHopInput()
    const report = buildRepositoryReport({ ...input, scheduledProjectDates: null, coverage: { history: 'partial', files: 'partial', notes: ['Only observed history was collected.'] } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => bundleFromReport(report) })
    vi.stubGlobal('fetch', fetchMock)
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), { target: { value: input.repositoryUrl } })
    fireEvent.change(screen.getByLabelText('GitHub username (optional)'), { target: { value: 'sample-student' } })
    expect(screen.queryByLabelText('Commit email aliases (optional)')).toBeNull()
    fireEvent.change(screen.getByLabelText('Timezone'), {target:{value:'America/Toronto'}})
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('End date (inclusive)'), { target: { value: '2026-10-16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze public repository' }))
    await screen.findByRole('heading',{name:'Workflow findings'})
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reports/repository')
    expect(request).toMatchObject({ githubUsername: 'sample-student', scheduledProjectDates: null, baselineReviewed: false, period: { timezone: 'America/Toronto' } })
    expect(Date.parse(request.period.endAt) - Date.parse(request.period.startAt)).toBe(12 * 24 * 60 * 60 * 1000)
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.getByText(/History collection is partial/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    expect(screen.getByText('Only observed history was collected.')).toBeTruthy()
    expect(screen.getAllByText('?').length).toBeGreaterThan(0)
    expect(screen.getByText(/Missing cells are unknown/)).toBeTruthy()
    const timeline = screen.getByRole('table', { name: 'Observed commits by local date', hidden: true }) as HTMLTableElement
    const unknownDate = Array.from(timeline.tBodies[0].rows).find(row => row.cells[0].textContent === '2026-10-07')!
    expect(unknownDate.cells[1].textContent).toBe('Unknown')
  })

  it('clears previous results when a new request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Public repository not found.' }) }))
    render(<PublicReportWorkspace />)
    await submitSample()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'Public repository not found.'})}))
    fireEvent.click(screen.getByRole('button', {name:'Analyze another repository'}))
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), { target: { value: 'https://github.com/example/repository' } })
    fireEvent.change(screen.getByLabelText('GitHub username (optional)'), { target: { value: 'example' } })
    fireEvent.change(screen.getByLabelText('Timezone'), {target:{value:'America/Toronto'}})
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('End date (inclusive)'), { target: { value: '2026-10-16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze public repository' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('table', { name: 'Commit evidence' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Public repository not found.')
  })

  it('opens each new report on summary and preserves the form when changing configuration', async () => {
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('GitHub username (optional)'),{target:{value:'remember-this-login'}})
    await submitSample()
    expect(screen.queryByRole('heading',{name:'Analyze a repository'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    fireEvent.click(screen.getByRole('button',{name:'Analyze another repository'}))
    expect((screen.getByLabelText('GitHub username (optional)') as HTMLInputElement).value).toBe('remember-this-login')
    await submitSample()
    expect(screen.getByRole('heading',{name:'Workflow findings'})).toBeTruthy()
    expect(screen.queryByRole('table',{name:'Commit evidence'})).toBeNull()
  })

  it('keeps unknown summary counts unavailable instead of displaying zeros', async () => {
    const input = skyHopInput()
    const report = buildRepositoryReport({...input,events:[],coverage:{history:'unavailable',files:'unavailable',notes:[]}})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>bundleFromReport(report)}))
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:input.repositoryUrl}})
    fireEvent.change(screen.getByLabelText('GitHub username (optional)'),{target:{value:'sample-student'}})
    fireEvent.change(screen.getByLabelText('Start date'),{target:{value:'2026-10-05'}})
    fireEvent.change(screen.getByLabelText('End date (inclusive)'),{target:{value:'2026-10-16'}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Workflow findings'})
    for (const label of ['Observed active days','Generic-message share']) {
      expect(screen.getByText(label).parentElement?.querySelector('dd')?.textContent).toBe('Unavailable')
    }
    expect(screen.queryByText('0% · 0 / 0 messages')).toBeNull()
    expect(screen.getByText(/History collection is unavailable/)).toBeTruthy()
  })
  it.each(['not_found', 'invalid'] as const)('shows an overview and explicit notice for a %s username', async status => {
    const bundle = multiContributorBundle()
    bundle.selection = {requestedGithubLogin:status === 'invalid' ? 'bad/name' : 'absent-user',status,contributorId:null,notice:status === 'invalid' ? 'The supplied username is malformed. Showing the repository overview.' : 'No matching contributor in collected period evidence. Showing the repository overview; collection may be incomplete.'}
    const fetchMock = mockBundle(bundle)
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), {target:{value:bundle.context.repository.url}})
    fireEvent.change(screen.getByLabelText('GitHub username (optional)'), {target:{value:bundle.selection.requestedGithubLogin}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Repository overview'})
    expect(screen.getByText(bundle.selection.notice!)).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Repository commits'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'View Unlinked author 1'})).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).githubUsername).toBe(bundle.selection.requestedGithubLogin)
    fireEvent.click(screen.getByRole('button',{name:'View sample-student'}))
    expect(screen.getByRole('heading',{name:'sample-student'})).toBeTruthy()
    expect(screen.queryByText(bundle.selection.notice!)).toBeNull()
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'repository'}})
    expect(screen.getByText(bundle.selection.notice!)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('opens a matching contributor and switches all scopes using one collection', async () => {
    const bundle = multiContributorBundle()
    bundle.selection = {requestedGithubLogin:'sample-student',status:'matched',contributorId:'sample',notice:null}
    const fetchMock = mockBundle(bundle)
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), {target:{value:bundle.context.repository.url}})
    fireEvent.change(screen.getByLabelText('GitHub username (optional)'), {target:{value:'sample-student'}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'sample-student'})
    expect(screen.getByRole('heading',{name:'Contributor commits'}).parentElement?.querySelector('strong')?.textContent).toBe('3')
    expect(screen.queryByRole('heading',{name:'Contributors'})).toBeNull()
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'repository'}})
    expect(screen.getByRole('heading',{name:'Repository commits'}).parentElement?.querySelector('strong')?.textContent).toBe('12')
    expect(screen.getByText(/They do not represent one student/)).toBeTruthy()
    expect(screen.getByRole('option',{name:'helper-bot · Bot account'})).toBeTruthy()
    expect(screen.getByRole('option',{name:'Unlinked author 1 · Unlinked author'})).toBeTruthy()
    expect(screen.getByRole('option',{name:'Unknown authors · Unknown author'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'View helper-bot'}))
    expect(screen.getByRole('heading',{name:'helper-bot'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    expect((screen.getByRole('table',{name:'Commit evidence'}) as HTMLTableElement).tBodies[0].rows).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'contributor:unknown'}})
    expect(screen.getByRole('heading',{name:'Unknown authors'})).toBeTruthy()
    expect(screen.getByText(/Metrics, evidence and feedback below apply to an unknown-author bucket that may contain multiple people/)).toBeTruthy()
    expect(screen.getByText('Report scope').parentElement?.querySelector('dd')?.textContent).toContain('unknown-author bucket; may contain multiple people, not one identified contributor')
    fireEvent.click(screen.getByRole('button',{name:'Back to summary'}))
    expect(screen.getByText('This unknown-author bucket may contain multiple people; its activity cannot be attributed to one identified contributor.')).toBeTruthy()
    expect(screen.queryByText(/apply only to this contributor/)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('isolates edits, restores only the active draft, exports every scope and resets edits for a new analysis', async () => {
    const bundle = multiContributorBundle()
    const fetchMock = mockBundle(bundle)
    const createUrl = vi.fn().mockReturnValue('blob:report')
    vi.stubGlobal('URL', class extends URL {static createObjectURL = createUrl; static revokeObjectURL = vi.fn()})
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {})
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:bundle.context.repository.url}})
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Repository overview'})
    const edit = (value: string) => fireEvent.change(screen.getByLabelText('Teacher feedback'),{target:{value}})
    const value = () => (screen.getByLabelText('Teacher feedback') as HTMLTextAreaElement).value
    edit('Reviewed repository feedback.')
    fireEvent.click(screen.getByRole('button',{name:'View sample-student'}))
    expect(value()).toBe('Original draft for sample.')
    edit('Reviewed sample feedback.')
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'contributor:bot'}})
    fireEvent.click(screen.getByRole('button',{name:'Back to summary'}))
    expect(value()).toBe('Original draft for bot.')
    edit('Temporary bot feedback.')
    fireEvent.click(screen.getByRole('button',{name:'Restore rule draft'}))
    expect(value()).toBe('Original draft for bot.')
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'contributor:sample'}})
    expect(value()).toBe('Reviewed sample feedback.')
    fireEvent.change(screen.getByLabelText('Report view'),{target:{value:'repository'}})
    expect(value()).toBe('Reviewed repository feedback.')
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    fireEvent.click(screen.getByRole('button',{name:'Download report JSON'}))
    const blob = createUrl.mock.calls[0][0] as Blob
    const exported = JSON.parse(await new Promise<string>((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob)}))
    expect(exported.bundleRef).toBe(bundle.bundleRef)
    expect(exported.contributors).toHaveLength(4)
    expect(exported.overview).toEqual(bundle.overview)
    expect(exported.teacherEdits).toEqual({repository:'Reviewed repository feedback.','contributor:sample':'Reviewed sample feedback.','contributor:bot':'Original draft for bot.'})
    expect(exported.contributors[0].analysis.ruleFeedback.feedbackDraft).toBe('Original draft for sample.')
    expect(JSON.stringify(exported)).not.toContain('commitEmails')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button',{name:'Analyze another repository'}))
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Workflow findings'})
    expect(value()).toBe(bundle.overview.ruleFeedback.feedbackDraft)
    fireEvent.click(screen.getByRole('button',{name:'View sample-student'}))
    expect(value()).toBe('Original draft for sample.')
  })

})
