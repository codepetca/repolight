import Link from 'next/link'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'
import { Brand } from '@/components/Brand'

export const metadata = { title: 'Repository reports · RepoLight' }

export default function ReportsPage() {
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand"><Brand /></Link>
      <nav className="nav-links" aria-label="Primary"><Link href="/reports" aria-current="page">Reports</Link><Link href="/">Runs</Link></nav>
    </header>
    <PublicReportWorkspace />
  </div>
}
