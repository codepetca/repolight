import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ClassroomWebhookInput {
  eventName: string
  deliveryId: string
  payload: Record<string, unknown>
}

export interface ClassroomWebhookUpdate {
  eventType: string
  externalId: string
  repositoryFullName: string
  githubLogin: string | null
  occurredAt: string | null
  repositoryPatch: {
    invitationStatus: string | null
    activityStatus: string | null
    incrementSuccessfulPushCount: boolean
    firstPushAt: string | null
    lastPushAt: string | null
  }
  payloadSummary: Record<string, unknown>
}

export function verifyGitHubWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith('sha256=') || !secret) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export function buildClassroomWebhookUpdate(input: ClassroomWebhookInput): ClassroomWebhookUpdate | null {
  const repositoryFullName = stringAt(input.payload, ['repository', 'full_name'])
  if (!repositoryFullName) return null

  if (input.eventName === 'push') {
    if (booleanAt(input.payload, ['deleted'])) return null
    const occurredAt = stringAt(input.payload, ['head_commit', 'timestamp'])
    return {
      eventType: 'push',
      externalId: input.deliveryId,
      repositoryFullName,
      githubLogin: null,
      occurredAt,
      repositoryPatch: {
        invitationStatus: null,
        activityStatus: 'active',
        incrementSuccessfulPushCount: true,
        firstPushAt: occurredAt,
        lastPushAt: occurredAt,
      },
      payloadSummary: {
        ref: stringAt(input.payload, ['ref']),
        commit_count: arrayAt(input.payload, ['commits']).length,
      },
    }
  }

  if (input.eventName === 'member' && stringAt(input.payload, ['action']) === 'added') {
    return {
      eventType: 'member.added',
      externalId: input.deliveryId,
      repositoryFullName,
      githubLogin: stringAt(input.payload, ['member', 'login']),
      occurredAt: null,
      repositoryPatch: {
        invitationStatus: 'accepted',
        activityStatus: null,
        incrementSuccessfulPushCount: false,
        firstPushAt: null,
        lastPushAt: null,
      },
      payloadSummary: {
        action: 'added',
        member: stringAt(input.payload, ['member', 'login']),
      },
    }
  }

  if (input.eventName === 'create' && stringAt(input.payload, ['ref_type']) === 'branch') {
    return {
      eventType: 'branch.created',
      externalId: input.deliveryId,
      repositoryFullName,
      githubLogin: stringAt(input.payload, ['sender', 'login']),
      occurredAt: null,
      repositoryPatch: {
        invitationStatus: null,
        activityStatus: 'active',
        incrementSuccessfulPushCount: false,
        firstPushAt: null,
        lastPushAt: null,
      },
      payloadSummary: {
        ref: stringAt(input.payload, ['ref']),
        ref_type: 'branch',
      },
    }
  }

  if (input.eventName === 'pull_request' && stringAt(input.payload, ['action']) === 'opened') {
    return {
      eventType: 'pull_request.opened',
      externalId: input.deliveryId,
      repositoryFullName,
      githubLogin: stringAt(input.payload, ['pull_request', 'user', 'login']),
      occurredAt: stringAt(input.payload, ['pull_request', 'created_at']),
      repositoryPatch: {
        invitationStatus: null,
        activityStatus: 'active',
        incrementSuccessfulPushCount: false,
        firstPushAt: null,
        lastPushAt: null,
      },
      payloadSummary: {
        action: 'opened',
        number: numberAt(input.payload, ['pull_request', 'number']),
      },
    }
  }

  return null
}

function valueAt(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function stringAt(value: unknown, path: string[]): string | null {
  const found = valueAt(value, path)
  return typeof found === 'string' && found.trim() ? found : null
}

function numberAt(value: unknown, path: string[]): number | null {
  const found = valueAt(value, path)
  return typeof found === 'number' ? found : null
}

function booleanAt(value: unknown, path: string[]): boolean {
  const found = valueAt(value, path)
  return found === true
}

function arrayAt(value: unknown, path: string[]): unknown[] {
  const found = valueAt(value, path)
  return Array.isArray(found) ? found : []
}
