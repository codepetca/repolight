import { z } from 'zod'
import { reportBuildInputSchema, type RepositoryReport } from '@/lib/report/contract'
import { formatDayInZone } from '@/lib/engine/time'

export const publicReportRequestSchema = reportBuildInputSchema.pick({ repositoryUrl: true, period: true, scheduledProjectDates: true, exclusions: true }).extend({
  branch: z.string().trim().min(1).max(200).optional(),
  githubLogins: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  commitEmails: z.array(z.string().trim().email().max(254)).max(20).default([]),
  baselineReviewed: z.boolean().default(false),
}).strict().superRefine(validatePublicSettings)

export function validatePublicSettings(value: Pick<z.infer<typeof reportBuildInputSchema>, 'period' | 'scheduledProjectDates' | 'exclusions'>, ctx: z.RefinementCtx) {
  if (Date.parse(value.period.endAt) - Date.parse(value.period.startAt) > 366 * 86400000) ctx.addIssue({ code: 'custom', message: 'Choose a report period of at most 366 days.' })
  if ((value.scheduledProjectDates?.length || 0) > 366 || value.exclusions.commitShas.length > 250 || value.exclusions.pathPrefixes.length > 100 || value.exclusions.botLogins.length > 100) ctx.addIssue({ code: 'custom', message: 'Too many schedule dates or exclusions.' })
  try {
    const first = formatDayInZone(value.period.startAt, value.period.timezone)
    const last = formatDayInZone(new Date(Date.parse(value.period.endAt) - 1).toISOString(), value.period.timezone)
    if (value.scheduledProjectDates?.some(date => date < first || date > last)) ctx.addIssue({ code: 'custom', message: 'Scheduled project dates must fall within the report period.' })
  } catch { /* The period schema reports invalid dates/timezones. */ }
}
export type PublicReportRequest = z.infer<typeof publicReportRequestSchema>
export type RuleObservation = { id: string; ruleId: string; kind: 'strength' | 'improvement' | 'review_question' | 'limitation'; text: string; evidence: Array<{ commitSha: string; path: string | null }> }
export type RuleFeedback = {
  rulesVersion: '1.0.0'; observations: RuleObservation[];
  summary: { activeDays: number; genericMessageCount: number; messageCount: number; longestScheduledGap: number | null };
  feedbackDraft: string;
}
export type PublicAnalysisResult = { report: RepositoryReport; ruleFeedback: RuleFeedback }

/** Inclusive local calendar dates become a half-open instant range; never use browser timezone implicitly. */
export function periodFromDates(startDate: string, endDateInclusive: string, timezone: string) {
  const parseDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use calendar dates in YYYY-MM-DD format.')
    const ms = Date.parse(`${date}T00:00:00Z`)
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date.')
    return ms
  }
  const first = parseDate(startDate), last = parseDate(endDateInclusive)
  if (first > last) throw new Error('Start date must be on or before end date.')
  const midnight = (date: string) => {
    const target = parseDate(date)
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    let guess = target
    for (let attempt = 0; attempt < 5; attempt++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]))
      const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
      const correction = target - local
      if (!correction) return new Date(guess).toISOString()
      guess += correction
    }
    throw new Error('Local midnight is unavailable for this date/timezone. Use an explicit period through the API.')
  }
  return { startAt: midnight(startDate), endAt: midnight(new Date(last + 86400000).toISOString().slice(0, 10)), timezone }
}
