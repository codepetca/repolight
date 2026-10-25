import { z } from 'zod'
import { createNeonSqlExecutor, type SqlExecutor } from '@/lib/service/sql-executor'
import { interpretationSidecarSchema, type InterpretationSidecar, type InterpretationError } from './contract'
import type { interpretationEvidence } from './evidence'
export interface InterpretationRow { id: string; workspaceId: string; jobId: string; requestId: string; scopeKey: string; state: 'generating' | 'available' | 'failed'; leaseToken: string; leaseExpiresAt: string; model: string; inputDigest: string; reportDigest: string; createdAt: string; sidecar: InterpretationSidecar | null; error: InterpretationError | null }
export interface Reservation { workspaceId: string; jobId: string; requestId: string; scopeKey: string; model: string; reportDigest: string; evidence: ReturnType<typeof interpretationEvidence> }
export interface InterpretationStore {
  recover(workspaceId: string): Promise<void>;
  latest(workspaceId: string, jobId: string, scopeKey: string): Promise<InterpretationRow | null>;
  find(workspaceId: string, requestId: string): Promise<InterpretationRow | null>;
  reserve(input: Reservation): Promise<{ kind: 'admitted' | 'replayed'; row: InterpretationRow } | { kind: 'conflict' | 'limited' | 'not_found' }>;
  finish(row: InterpretationRow, sidecar: InterpretationSidecar | null, error: InterpretationError | null): Promise<boolean>;
}
const stamp = (value: unknown) => new Date(String(value)).toISOString()
function row(value: Record<string, unknown>): InterpretationRow { return { id: String(value.id), workspaceId: String(value.workspace_id), jobId: String(value.job_id), requestId: String(value.request_id), scopeKey: String(value.scope_key), state: value.state as InterpretationRow['state'], leaseToken: String(value.lease_token), leaseExpiresAt: stamp(value.lease_expires_at), model: String(value.model), inputDigest: String(value.input_digest), reportDigest: String(value.report_digest), createdAt: stamp(value.created_at), sidecar: value.sidecar_json == null ? null : interpretationSidecarSchema.parse(value.sidecar_json), error: value.error_code as InterpretationError | null } }
export function createInterpretationStore(provided?: SqlExecutor): InterpretationStore {
  let executor = provided
  const query = <T extends Record<string, unknown>>(text: string, args: unknown[]) => (executor ?? (executor = createNeonSqlExecutor(process.env.DATABASE_URL || ''))).query<T>(text, args)
  return {
    async recover(workspaceId) { await query('SELECT public.rl_recover_interpretations($1)', [workspaceId]) },
    async latest(workspaceId, jobId, scopeKey) { const values = await query('SELECT * FROM public.rl_interpretations WHERE workspace_id=$1 AND job_id=$2 AND scope_key=$3 ORDER BY created_at DESC,id DESC LIMIT 1', [workspaceId, jobId, scopeKey]); return values[0] ? row(values[0]) : null },
    async find(workspaceId, requestId) { const values = await query('SELECT * FROM public.rl_interpretations WHERE workspace_id=$1 AND request_id=$2', [workspaceId, requestId]); return values[0] ? row(values[0]) : null },
    async reserve(input) {
      const values = await query('SELECT public.rl_reserve_interpretation($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) AS value', [input.workspaceId, input.jobId, input.requestId, input.scopeKey, input.model, input.reportDigest, input.evidence.inputDigest, JSON.stringify(input.evidence.input), JSON.stringify(input.evidence.citations)])
      const value = values[0].value as { kind: 'admitted' | 'replayed' | 'conflict' | 'limited' | 'not_found'; row?: Record<string, unknown> }
      return value.row ? { kind: value.kind as 'admitted' | 'replayed', row: row(value.row) } : value as { kind: 'conflict' | 'limited' | 'not_found' }
    },
    async finish(current, sidecar, error) {
      const payload = sidecar === null ? null : interpretationSidecarSchema.parse(sidecar)
      const values = await query('SELECT public.rl_finish_interpretation($1,$2,$3,$4::jsonb,$5) AS ok', [current.workspaceId, current.id, z.uuid().parse(current.leaseToken), payload === null ? null : JSON.stringify(payload), error])
      return values[0].ok === true
    },
  }
}
