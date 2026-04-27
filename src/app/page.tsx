import Link from 'next/link'
import { Plus } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { requireUser } from '@/lib/auth/session'
import { listRunsForUser } from '@/lib/runs/service'

export default async function DashboardPage() {
  const user = await requireUser()
  const runs = await listRunsForUser(user.id)

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Analysis Runs</h1>
            <p className="page-subtitle">Upload contributor CSVs, process public GitHub repos, and tune rubric scoring.</p>
          </div>
          <Link className="button" href="/runs/new">
            <Plus size={16} aria-hidden="true" />
            New Run
          </Link>
        </div>

        {runs.length === 0 ? (
          <div className="empty">
            No runs yet. Create a run from a CSV to start analyzing repository contributions.
          </div>
        ) : (
          <div className="run-grid">
            {runs.map((run) => {
              const progress = run.totalRepositories === 0
                ? 0
                : Math.round(((run.processedRepositories + run.failedRepositories) / run.totalRepositories) * 100)
              return (
                <Link className="run-card" href={`/runs/${run.id}`} key={run.id}>
                  <div>
                    <div className={`badge ${run.status}`}>{run.status}</div>
                    <h2 className="panel-title" style={{ marginTop: 12 }}>{run.name}</h2>
                  </div>
                  <div className="progress" aria-label={`${progress}% complete`}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <div className="meta-row">
                    <span>{run.processedRepositories}/{run.totalRepositories} repos processed</span>
                    {run.failedRepositories > 0 && <span>{run.failedRepositories} failed</span>}
                    <span>{new Date(run.createdAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
