import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'

export function AppHeader({ email }: { email: string }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="brand">
          <span className="brand-mark">R</span>
          <span>Repocat</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link href="/reports">Reports</Link>
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
