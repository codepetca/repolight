import { QueueClient } from '@vercel/queue'
import { z } from 'zod'

export const ANALYSIS_WAKE_TOPIC = 'repolight-analysis-wake-v1'
export const ANALYSIS_RECOVERY_SCHEDULE = 'repolight-analysis-recovery'
export const analysisWakeMessage = z.object({ version: z.literal(1) }).strict()
const queue = new QueueClient({ region: 'iad1', telemetry: { isEnabled: false } })

export function isHostedAnalysisDeployment() {
  // The build flag still identifies a Vercel artifact when system variables are hidden.
  return process.env.REPOLIGHT_VERCEL_BUILD === '1' || Boolean(process.env.VERCEL_DEPLOYMENT_ID) ||
    (process.env.VERCEL === '1' && process.env.VERCEL_ENV !== 'development')
}

export function analysisWakeEnabled() {
  return process.env.REPOLIGHT_ON_DEMAND_WORKER_ENABLED === 'true' &&
    process.env.VERCEL === '1' && Boolean(process.env.VERCEL_DEPLOYMENT_ID)
}

export function analysisWakeOptions(delaySeconds: number, now = Date.now()) {
  // Use a future bucket, so requests coalesced into the same wake have already
  // committed by the time it runs. Neither the key nor the payload identifies a job.
  const bucket = Math.ceil((now + (delaySeconds + 1) * 1000) / 5000) * 5000
  return { idempotencyKey: `wake-v1:${bucket}`, delaySeconds: Math.ceil((bucket - now) / 1000) }
}

export async function publishAnalysisWake(delaySeconds = 0) {
  if (!analysisWakeEnabled()) return
  // A failed or uncertain publish must not change the already committed 202.
  // The SDK does not accept an AbortSignal. A late send is safe and deduplicated.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      queue.send(ANALYSIS_WAKE_TOPIC, { version: 1 }, analysisWakeOptions(delaySeconds)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Analysis wake publish timed out.')), 5000) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
