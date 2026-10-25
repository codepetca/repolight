import { analysisResultSchema, type AnalysisResult } from '@/lib/service/contract'
import { digestJson } from '@/lib/service/http'
import { buildInterpretationCitations } from './citations'
export function interpretationEvidence(raw: AnalysisResult, scopeKey: string) {
  const result = analysisResultSchema.parse(raw)
  if (digestJson(result.bundle) !== result.reportDigest) throw new Error('invalid_report_digest')
  const citations = buildInterpretationCitations(result.bundle, scopeKey)
  // Static enums, counts and ratios only. No source text, dates, identity, paths, URLs or edits leave this boundary.
  const input = { scope: scopeKey === 'repository' ? 'repository' : 'contributor', evidence: citations.map(({ id, sourceKey, value, status }) => ({ id, measure: sourceKey, value, status })) }
  return { input, inputDigest: digestJson(input), citations }
}
