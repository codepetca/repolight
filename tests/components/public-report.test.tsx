import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'
import { buildRepositoryReport } from '@/lib/report/build'
import { buildRuleFeedback } from '@/lib/report/rules'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PublicReportWorkspace', () => {
  it('labels the offline demo, exposes evidence and keeps teacher edits separate', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    render(<PublicReportWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Explore fictional demo' }))
    expect(screen.getByText(/Fictional Sky Hop example/)).toBeTruthy()
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
    fireEvent.change(screen.getByLabelText('Student GitHub logins'), { target: { value: 'sample-student, second-login' } })
    fireEvent.change(screen.getByLabelText('Commit email aliases (optional)'), { target: { value: 'student@example.test' } })
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
    fireEvent.click(screen.getByRole('button', { name: 'Explore fictional demo' }))
    fireEvent.click(screen.getByRole('button', {name:'Analyze another repository'}))
    fireEvent.change(screen.getByLabelText('Public GitHub repository'), { target: { value: 'https://github.com/example/repository' } })
    fireEvent.change(screen.getByLabelText('Student GitHub logins'), { target: { value: 'example' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('End date (inclusive)'), { target: { value: '2026-10-16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze public repository' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('table', { name: 'Commit evidence' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Public repository not found.')
  })

  it('opens each new report on summary and preserves the form when changing configuration', () => {
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Student GitHub logins'),{target:{value:'remember-this-login'}})
    fireEvent.click(screen.getByRole('button',{name:'Explore fictional demo'}))
    expect(screen.queryByRole('heading',{name:'Start with a repository'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'View evidence'}))
    fireEvent.click(screen.getByRole('button',{name:'Analyze another repository'}))
    expect((screen.getByLabelText('Student GitHub logins') as HTMLInputElement).value).toBe('remember-this-login')
    fireEvent.click(screen.getByRole('button',{name:'Explore fictional demo'}))
    expect(screen.getByRole('heading',{name:'Workflow findings'})).toBeTruthy()
    expect(screen.queryByRole('table',{name:'Commit evidence'})).toBeNull()
  })

  it('keeps unknown summary counts unavailable instead of displaying zeros', async () => {
    const input = skyHopInput()
    const report = buildRepositoryReport({...input,events:[],coverage:{history:'unavailable',files:'unavailable',notes:[]}})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({report,ruleFeedback:buildRuleFeedback(report)})}))
    render(<PublicReportWorkspace />)
    fireEvent.change(screen.getByLabelText('Public GitHub repository'),{target:{value:input.repositoryUrl}})
    fireEvent.change(screen.getByLabelText('Student GitHub logins'),{target:{value:'sample-student'}})
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
