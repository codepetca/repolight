import type { ServiceStore } from './store-types'
import { runWorkerOnce, type WorkerOptions } from './worker'

/** A wake has no job identity. Every invocation uses the same database claim order. */
export async function runAnalysisWake(store: ServiceStore, publish: (delaySeconds: number) => Promise<void>, options?: WorkerOptions) {
  const outcome = await runWorkerOnce(store, options)
  const pendingDelay = await store.nextAnalysisWakeDelaySeconds()
  if (pendingDelay === null) return

  // A due job can be blocked by another workspace/global lease. Avoid immediate
  // retries on contention; an active worker can still publish a faster wake.
  await publish(Math.min(300, Math.max(outcome === 'idle' ? 15 : 0, pendingDelay)))
}
