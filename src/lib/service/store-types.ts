import type { PublicRepositoryBundle, PublicRepositoryRequest } from '@/lib/report/bundle-contract'
import type { AnalysisErrorCode, AnalysisResult, AnalysisStatus, ClientBinding, FeedbackEdit } from './contract'

export type ApiKeyScope = 'analyses:create' | 'analyses:read'
export interface WorkspaceRecord { id: string; ownerUserId: string; customerRef: string; createdAt: string }
/** Server-only record. Never return this from a route or serialize it into UI props. */
export interface ApiKeyRecord {
  id: string; workspaceId: string; label: string; secretHash: string;
  scopes: ApiKeyScope[]; installationRef: string | null; expiresAt: string | null;
  revokedAt: string | null; createdAt: string; customerRef: string; ownerUserId: string;
}
export type ApiKeyMetadata = Omit<ApiKeyRecord, 'secretHash' | 'customerRef' | 'ownerUserId'>
export interface PinnedSnapshot {
  repositoryUrl: string; branch: string; sha: string; capturedAt: string; kind: 'analysis_time';
}
export interface StoredJob {
  id: string; workspaceId: string; createdByKeyId: string | null;
  idempotencyKey: string; request: PublicRepositoryRequest; requestFingerprint: string;
  clientBinding: ClientBinding | null; status: AnalysisStatus['status'];
  attemptCount: number; maxAttempts: number; nextAttemptAt: string | null;
  leaseToken: string | null; leaseGeneration: number; leaseExpiresAt: string | null;
  snapshot: PinnedSnapshot | null; reportRef: string | null;
  errorCode: AnalysisErrorCode | null; errorRetryable: boolean;
  createdAt: string; completedAt: string | null; deadlineAt: string;
}
export interface ServiceLimits {
  dailyAdmissions: number; queuedPerWorkspace: number; runningPerWorkspace: number;
  runningGlobal: number; maxAttempts: number; jobLifetimeSeconds: number;
}
export const DEFAULT_SERVICE_LIMITS: ServiceLimits = {
  dailyAdmissions: 20, queuedPerWorkspace: 5, runningPerWorkspace: 1,
  runningGlobal: 2, maxAttempts: 3, jobLifetimeSeconds: 86_400,
}
export interface EnqueueAnalysisInput {
  workspaceId: string; createdByKeyId?: string | null; idempotencyKey: string;
  request: PublicRepositoryRequest; requestFingerprint: string;
  clientBinding?: ClientBinding | null; limits?: Partial<ServiceLimits>;
}
export type EnqueueAnalysisResult =
  | { kind: 'accepted'; job: StoredJob }
  | { kind: 'replayed'; job: StoredJob }
  | { kind: 'conflict' }
  | { kind: 'unauthorized' }
  | { kind: 'limited'; reason: 'daily_limit' | 'queue_limit' }
export interface LeaseIdentity { jobId: string; leaseToken: string; leaseGeneration: number }
export interface ServiceStore {
  getOrCreateWorkspace(ownerUserId: string): Promise<WorkspaceRecord>;
  getWorkspaceForOwner(ownerUserId: string, workspaceId?: string): Promise<WorkspaceRecord | null>;
  issueApiKey(workspaceId: string, input: { id: string; label: string; secretHash: string; scopes: ApiKeyScope[]; installationRef?: string | null; expiresAt?: string | null }): Promise<ApiKeyMetadata>;
  listApiKeys(workspaceId: string): Promise<ApiKeyMetadata[]>;
  revokeApiKey(workspaceId: string, keyId: string): Promise<boolean>;
  findApiKey(keyId: string): Promise<ApiKeyRecord | null>;
  enqueueAnalysis(input: EnqueueAnalysisInput): Promise<EnqueueAnalysisResult>;
  getJob(workspaceId: string, jobId: string): Promise<StoredJob | null>;
  listJobs(workspaceId: string, limit?: number, installationRef?: string): Promise<StoredJob[]>;
  getResult(workspaceId: string, jobId: string): Promise<AnalysisResult | null>;
  getEdits(workspaceId: string, reportRef: string): Promise<FeedbackEdit[] | null>;
  saveEdit(input: { workspaceId: string; reportRef: string; actorUserId: string; scopeKey: string; expectedRevision: number; text: string | null }): Promise<{ kind: 'saved'; edit: FeedbackEdit } | { kind: 'conflict' | 'not_found' | 'invalid_scope' }>;
  claimAnalysis(input: { workerId: string; leaseSeconds?: number; limits?: Partial<ServiceLimits> }): Promise<StoredJob | null>;
  renewLease(lease: LeaseIdentity, leaseSeconds?: number): Promise<boolean>;
  pinSnapshot(lease: LeaseIdentity, snapshot: PinnedSnapshot): Promise<boolean>;
  completeAnalysis(lease: LeaseIdentity, input: { bundle: PublicRepositoryBundle; reportDigest: string }): Promise<boolean>;
  failOrRetryAnalysis(lease: LeaseIdentity, failure: { code: AnalysisErrorCode; retryable: boolean; retryAfterSeconds?: number }): Promise<boolean>;
  recoverExpiredJobs(): Promise<number>;
}
