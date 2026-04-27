import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function handleApi<T>(fn: () => Promise<T | Response>): Promise<Response> {
  try {
    const result = await fn()
    if (result instanceof Response) return result
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(error.issues[0]?.message || 'Invalid request', 400)
    }
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 500
      return jsonError(error.message, status)
    }
    return jsonError('Unexpected error', 500)
  }
}
