import { AppHeader } from '@/components/AppHeader'
import { RunWorkspace } from '@/components/RunWorkspace'
import { requireUser } from '@/lib/auth/session'
import { getRunDetail, getRunResults } from '@/lib/runs/service'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params
  const user = await requireUser()
  const [run, results] = await Promise.all([
    getRunDetail(user.id, routeParams.id),
    getRunResults(user.id, routeParams.id),
  ])

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <RunWorkspace initialRun={run} initialResults={results} />
    </main>
  )
}
