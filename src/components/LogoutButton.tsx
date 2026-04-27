'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <button className="button secondary" type="button" onClick={logout}>
      <LogOut size={16} aria-hidden="true" />
      Sign out
    </button>
  )
}
