import { handleApi, jsonError } from '@/lib/api'
import { applyClassroomWebhookUpdate } from '@/lib/classroom/service'
import {
  buildClassroomWebhookUpdate,
  verifyGitHubWebhookSignature,
} from '@/lib/classroom/webhooks'

export async function POST(request: Request) {
  return handleApi(async () => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim()
    if (!secret) return jsonError('GITHUB_WEBHOOK_SECRET is not configured.', 503)

    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')
    if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
      return jsonError('Invalid GitHub webhook signature.', 401)
    }

    const eventName = request.headers.get('x-github-event') || ''
    const deliveryId = request.headers.get('x-github-delivery') || ''
    if (!eventName || !deliveryId) {
      return jsonError('GitHub webhook event and delivery headers are required.', 400)
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const update = buildClassroomWebhookUpdate({ eventName, deliveryId, payload })
    if (!update) {
      return { ignored: true, duplicate: false, repositoryId: null, message: 'Webhook event ignored.' }
    }

    return await applyClassroomWebhookUpdate(update, payload)
  })
}
