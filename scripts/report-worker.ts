import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { createServiceStore } from '../src/lib/service/store'
import { runWorkerOnce } from '../src/lib/service/worker'

async function main() {
  const flags = process.argv.slice(2)
  if (flags.some(flag => !['--once', '--poll'].includes(flag)) || (flags.includes('--once') && flags.includes('--poll'))) throw new Error('Use --once or --poll.')
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  const store = createServiceStore()
  const workerId = `worker-${randomUUID()}`
  do {
    const outcome = await runWorkerOnce(store, { workerId, signal: controller.signal })
    process.stdout.write(`${outcome}\n`)
    if (!flags.includes('--poll') || controller.signal.aborted) break
    if (outcome === 'idle') await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, 5000)
      controller.signal.addEventListener('abort', finish, { once: true })
    })
  } while (!controller.signal.aborted)
}
main().catch(() => { process.stderr.write('Worker stopped: service configuration or storage unavailable.\n'); process.exitCode = 1 })
