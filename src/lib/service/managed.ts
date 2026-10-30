import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { analysisIdSchema, digestSchema, serviceRefSchema } from './contract'
import { readServiceJson, serviceHandle, serviceJson, ServiceHttpError } from './http'
import type { ServiceStore } from './store-types'

const canonicalUuid = analysisIdSchema.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const requestSchema = z.object({ schemaVersion: z.literal('1.0'), tenantRef: serviceRefSchema, operationRef: canonicalUuid, keyId: canonicalUuid, secretHash: digestSchema }).strict()

const rotationSchema = requestSchema.extend({ expectedKeyId: canonicalUuid }).strict()

/** One separately configured control credential is bound to one installation. */
export function createManagedProvisionApi(store: ServiceStore, operation: 'provision' | 'rotate' = 'provision') {
  return (request: Request) => serviceHandle(async () => {
    const installationRef = serviceRefSchema.safeParse(process.env.REPOLIGHT_CONTROL_INSTALLATION_REF)
    const secret = process.env.REPOLIGHT_CONTROL_SECRET
    if (!installationRef.success || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new ServiceHttpError('service_not_configured', 503)
    const authorization = request.headers.get('authorization')
    const match = authorization && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)
    const actual = createHash('sha256').update(match?.[1] ?? '').digest()
    const expected = createHash('sha256').update(secret).digest()
    if (!timingSafeEqual(actual, expected) || !match || request.headers.has('cookie')) throw new ServiceHttpError('unauthorized', 401)
    const raw = await readServiceJson(request)
    const body = operation === 'rotate' ? rotationSchema.parse(raw) : requestSchema.parse(raw)
    const base = { installationRef: installationRef.data, tenantRef: body.tenantRef, operationRef: body.operationRef, keyId: body.keyId, secretHash: body.secretHash }
    const result = operation === 'rotate' ? await store.rotateManaged({ ...base, expectedKeyId: rotationSchema.parse(body).expectedKeyId }) : await store.provisionManaged(base)
    if (result.kind === 'conflict') throw new ServiceHttpError('operation_conflict', 409)
    return serviceJson({ schemaVersion: '1.0', workspaceRef: result.workspaceRef, installationRef: installationRef.data, keyId: body.keyId }, result.kind === 'created' ? 201 : 200)
  })
}
