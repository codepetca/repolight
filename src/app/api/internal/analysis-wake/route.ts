import { QueueClient } from '@vercel/queue'
import { runAnalysisWake } from '@/lib/service/analysis-wake'
import { createServiceStore } from '@/lib/service/store'
import { ANALYSIS_WAKE_TOPIC, analysisWakeEnabled, analysisWakeMessage, publishAnalysisWake } from '@/lib/service/vercel-analysis-wake'

export const runtime = 'nodejs'
export const maxDuration = 210

const callback = new QueueClient({ region: 'iad1', telemetry: { isEnabled: false } }).handleCallback(async (message, metadata) => {
  if (metadata.topicName !== ANALYSIS_WAKE_TOPIC || !analysisWakeMessage.safeParse(message).success) return
  try {
    await runAnalysisWake(createServiceStore(), publishAnalysisWake)
  } catch {
    throw new Error('Analysis queue wake could not finish.')
  }
}, {
  visibilityTimeoutSeconds: 240,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 30 * 2 ** Math.min(4, metadata.deliveryCount - 1)) }),
})

export async function POST(request: Request) {
  // Hosted access depends on the private queue/v2beta trigger in vercel.json.
  if (!analysisWakeEnabled()) return new Response(null, { status: 404 })
  return callback(request)
}
