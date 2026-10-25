import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'
import { Brand } from '@/components/Brand'

export function AppHeader({ email }: { email: string }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="brand">
          <Brand />
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link href="/workspace/reports">Reports</Link>
          <Link href="/classrooms">Classrooms</Link>
          <Link href="/">Runs</Link>
        </nav>
      </div>
      <div className="toolbar">
        <span className="badge">{email}</span>
        <LogoutButton />
      </div>
    </header>
  )
}
