import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/lib/auth/session'

export async function GET() {
  const user = await getOptionalUser()
  return NextResponse.json({ user })
}
