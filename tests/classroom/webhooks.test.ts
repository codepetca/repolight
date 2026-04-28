import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildClassroomWebhookUpdate,
  verifyGitHubWebhookSignature,
} from '@/lib/classroom/webhooks'

describe('verifyGitHubWebhookSignature', () => {
  it('validates GitHub sha256 signatures', () => {
    const body = JSON.stringify({ action: 'opened' })
    const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`

    expect(verifyGitHubWebhookSignature(body, signature, 'secret')).toBe(true)
    expect(verifyGitHubWebhookSignature(body, signature, 'wrong-secret')).toBe(false)
    expect(verifyGitHubWebhookSignature(body, 'sha1=old', 'secret')).toBe(false)
  })
})

describe('buildClassroomWebhookUpdate', () => {
  it('maps push events to successful push activity', () => {
    expect(buildClassroomWebhookUpdate({
      eventName: 'push',
      deliveryId: 'delivery-1',
      payload: {
        ref: 'refs/heads/main',
        after: 'abc123',
        repository: {
          full_name: 'yrdsb-peths/dodge-it-solo-alex',
        },
        head_commit: {
          timestamp: '2026-04-20T10:15:00Z',
        },
        commits: [{ id: 'abc123' }],
      },
    })).toEqual({
      eventType: 'push',
      externalId: 'delivery-1',
      repositoryFullName: 'yrdsb-peths/dodge-it-solo-alex',
      githubLogin: null,
      occurredAt: '2026-04-20T10:15:00Z',
      repositoryPatch: {
        activityStatus: 'active',
        invitationStatus: null,
        incrementSuccessfulPushCount: true,
        firstPushAt: '2026-04-20T10:15:00Z',
        lastPushAt: '2026-04-20T10:15:00Z',
      },
      payloadSummary: {
        ref: 'refs/heads/main',
        commit_count: 1,
      },
    })
  })

  it('maps accepted member events to invitation acceptance', () => {
    expect(buildClassroomWebhookUpdate({
      eventName: 'member',
      deliveryId: 'delivery-2',
      payload: {
        action: 'added',
        repository: {
          full_name: 'yrdsb-peths/dodge-it-solo-alex',
        },
        member: {
          login: 'alex',
        },
      },
    })).toMatchObject({
      eventType: 'member.added',
      repositoryFullName: 'yrdsb-peths/dodge-it-solo-alex',
      githubLogin: 'alex',
      repositoryPatch: {
        invitationStatus: 'accepted',
        activityStatus: null,
        incrementSuccessfulPushCount: false,
      },
    })
  })

  it('maps branch creation and opened pull requests to active work', () => {
    expect(buildClassroomWebhookUpdate({
      eventName: 'create',
      deliveryId: 'delivery-3',
      payload: {
        ref_type: 'branch',
        ref: 'feature/player',
        repository: {
          full_name: 'yrdsb-peths/dodge-it-solo-alex',
        },
        sender: {
          login: 'alex',
        },
      },
    })).toMatchObject({
      eventType: 'branch.created',
      githubLogin: 'alex',
      repositoryPatch: {
        activityStatus: 'active',
      },
    })

    expect(buildClassroomWebhookUpdate({
      eventName: 'pull_request',
      deliveryId: 'delivery-4',
      payload: {
        action: 'opened',
        repository: {
          full_name: 'yrdsb-peths/dodge-it-solo-alex',
        },
        pull_request: {
          number: 3,
          created_at: '2026-04-20T11:00:00Z',
          user: {
            login: 'alex',
          },
        },
      },
    })).toMatchObject({
      eventType: 'pull_request.opened',
      githubLogin: 'alex',
      occurredAt: '2026-04-20T11:00:00Z',
      repositoryPatch: {
        activityStatus: 'active',
      },
    })
  })

  it('ignores unsupported or incomplete webhook events', () => {
    expect(buildClassroomWebhookUpdate({
      eventName: 'issues',
      deliveryId: 'delivery-5',
      payload: { action: 'opened' },
    })).toBeNull()

    expect(buildClassroomWebhookUpdate({
      eventName: 'create',
      deliveryId: 'delivery-6',
      payload: {
        ref_type: 'tag',
        repository: {
          full_name: 'yrdsb-peths/dodge-it-solo-alex',
        },
      },
    })).toBeNull()

    expect(buildClassroomWebhookUpdate({
      eventName: 'push',
      deliveryId: 'delivery-7',
      payload: {
        deleted: true,
        ref: 'refs/heads/old-branch',
        repository: {
          full_name: 'yrdsb-peths/dodge-it-solo-alex',
        },
        commits: [],
      },
    })).toBeNull()
  })
})
