import { AppHeader } from '@/components/AppHeader'
import { RunWorkspace } from '@/components/RunWorkspace'
import { requireUser } from '@/lib/auth/session'
import { getRunDetail, getRunResults } from '@/lib/runs/service'

export default async function RunPage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  const [run, results] = await Promise.all([
    getRunDetail(user.id, params.id),
    getRunResults(user.id, params.id),
  ])

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <RunWorkspace initialRun={run} initialResults={results} />
    </main>
  )
}
