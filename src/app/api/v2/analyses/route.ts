import { after } from 'next/server'
import { serviceApi } from '@/lib/service/runtime'
import { serviceHandle } from '@/lib/service/http'
import { analysisWakeEnabled, isHostedAnalysisDeployment, publishAnalysisWake } from '@/lib/service/vercel-analysis-wake'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return serviceHandle(async () => (await serviceApi()).list(request))
}

export async function POST(request: Request) {
  return serviceHandle(async () => {
    const enabled = analysisWakeEnabled()
    const scheduleWake = enabled ? () => after(async () => {
      try { await publishAnalysisWake() }
      catch { console.warn('Analysis was queued but its immediate worker wake was unavailable.') }
    }) : undefined
    return (await serviceApi()).create(request, { allowAdmission: enabled || !isHostedAnalysisDeployment(), scheduleWake })
  })
}
