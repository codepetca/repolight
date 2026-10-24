import { buildRepositoryReport } from '../src/lib/report/build'
import { skyHopInput } from '../fixtures/reports/sky-hop'

// Offline synthetic evidence only. No database, credentials, GitHub App or AI provider.
process.stdout.write(`${JSON.stringify(buildRepositoryReport(skyHopInput()), null, 2)}\n`)
