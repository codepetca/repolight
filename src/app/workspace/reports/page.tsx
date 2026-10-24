import { AppHeader } from '@/components/AppHeader'
import { SavedReportWorkspace } from '@/components/SavedReportWorkspace'
import { requireUser } from '@/lib/auth/session'

export const metadata = {title:'Saved reports · RepoLight'}

export default async function SavedReportsPage() {
  const user = await requireUser()
  return <div className="app-shell"><AppHeader email={user.email} /><SavedReportWorkspace /></div>
}
