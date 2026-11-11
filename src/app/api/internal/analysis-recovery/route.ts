import { handleSchedule } from '@vercel/schedules'
import { runAnalysisWake } from '@/lib/service/analysis-wake'
import { createServiceStore } from '@/lib/service/store'
import { ANALYSIS_RECOVERY_SCHEDULE, analysisWakeEnabled, publishAnalysisWake } from '@/lib/service/vercel-analysis-wake'

export const runtime = 'nodejs'
export const maxDuration = 210

const callback = handleSchedule(async metadata => {
  if (metadata.name !== ANALYSIS_RECOVERY_SCHEDULE || metadata.namespace !== 'default') return
  try {
    // Direct claim also recovers work when the queue service cannot publish.
    await runAnalysisWake(createServiceStore(), publishAnalysisWake)
  } catch {
    throw new Error('Scheduled analysis recovery could not finish.')
  }
})

export async function POST(request: Request) {
  // Hosted access depends on the private schedule/v1beta trigger in vercel.json.
  if (!analysisWakeEnabled()) return new Response(null, { status: 404 })
  return callback(request)
}
