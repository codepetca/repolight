import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'

export function AppHeader({ email }: { email: string }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark">R</span>
        <span>Repocat</span>
      </Link>
      <div className="toolbar">
        <span className="badge">{email}</span>
        <LogoutButton />
      </div>
    </header>
  )
}
