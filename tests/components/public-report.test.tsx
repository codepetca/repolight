import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'
import { buildRepositoryReport } from '@/lib/report/build'
import { buildRuleFeedback } from '@/lib/report/rules'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

async function submitSample() {
  const report = buildRepositoryReport(skyHopInput())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({report,ruleFeedback:buildRuleFeedback(report)})}))
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({report,ruleFeedback:buildRuleFeedback(report)})}))
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
    const fetchMock = vi.fn().mockResolvedValue({ok:true,json:async()=>({report,ruleFeedback:buildRuleFeedback(report)})})
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
    expect((screen.getByLabelText('Student GitHub username') as HTMLInputElement).value).toBe('sample-student')
    fireEvent.click(screen.getByRole('button',{name:'Analyze public repository'}))
    await screen.findByRole('heading',{name:'Workflow findings'})
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request).toMatchObject({branch:'main',githubLogins:['sample-student'],period:{timezone:'Pacific/Auckland',startAt:'2026-08-23T12:00:00.000Z',endAt:'2026-10-22T11:00:00.000Z'}})
  })

  it('updates suggested owners while preserving an explicitly entered student username', () => {
    render(<PublicReportWorkspace />)
    const repo = screen.getByLabelText('Public GitHub repository')
    const student = screen.getByLabelText('Student GitHub username') as HTMLInputElement
    fireEvent.change(repo,{target:{value:'https://github.com/alice/project'}})
    expect(student.value).toBe('alice')
    fireEvent.change(repo,{target:{value:'https://github.com/bob/project'}})
    expect(student.value).toBe('bob')
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
    expect(screen.getByRole('heading', { name: 'Student commits' })).toBeTruthy()
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ report, ruleFeedback: buildRuleFeedback(report) }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), { target: { value: input.repositoryUrl } })
    fireEvent.change(screen.getByLabelText('Student GitHub username'), { target: { value: 'sample-student, second-login' } })
    fireEvent.change(screen.getByLabelText('Commit email aliases (optional)'), { target: { value: 'student@example.test' } })
    fireEvent.change(screen.getByLabelText('Timezone'), {target:{value:'America/Toronto'}})
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('End date (inclusive)'), { target: { value: '2026-10-16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze public repository' }))
    await screen.findByRole('heading',{name:'Workflow findings'})
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reports/analyze')
    expect(request).toMatchObject({ githubLogins: ['sample-student', 'second-login'], commitEmails: ['student@example.test'], scheduledProjectDates: null, baselineReviewed: false, period: { timezone: 'America/Toronto' } })
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
    fireEvent.change(screen.getByLabelText('Student GitHub username'), { target: { value: 'example' } })
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
    fireEvent.change(screen.getByLabelText('Student GitHub username'),{target:{value:'remember-this-login'}})
    await submitSample()
    expect(screen.queryByRole('heading',{name:'Analyze a repository'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    fireEvent.click(screen.getByRole('button',{name:'Analyze another repository'}))
    expect((screen.getByLabelText('Student GitHub username') as HTMLInputElement).value).toBe('remember-this-login')
    await submitSample()
    expect(screen.getByRole('heading',{name:'Workflow findings'})).toBeTruthy()
    expect(screen.queryByRole('table',{name:'Commit evidence'})).toBeNull()
  })

  it('keeps unknown summary counts unavailable instead of displaying zeros', async () => {
    const input = skyHopInput()
    const report = buildRepositoryReport({...input,events:[],coverage:{history:'unavailable',files:'unavailable',notes:[]}})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({report,ruleFeedback:buildRuleFeedback(report)})}))
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:input.repositoryUrl}})
    fireEvent.change(screen.getByLabelText('Student GitHub username'),{target:{value:'sample-student'}})
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
})
