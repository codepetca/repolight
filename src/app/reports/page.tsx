import Link from 'next/link'
import { PublicReportWorkspace } from '@/components/PublicReportWorkspace'

export const metadata = { title: 'Repository reports · Repocat' }

export default function ReportsPage() {
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">R</span><span>Repocat</span></Link>
      <nav className="nav-links" aria-label="Primary"><Link href="/reports" aria-current="page">Reports</Link><Link href="/">Runs</Link></nav>
      <span className="badge">Public repository preview</span>
    </header>
    <PublicReportWorkspace />
  </div>
}
