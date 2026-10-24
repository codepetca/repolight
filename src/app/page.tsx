import Link from 'next/link'
import { ClipboardList, Plus, School } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { requireUser } from '@/lib/auth/session'
import { listClassrooms } from '@/lib/classroom/service'
import { listRunsForUser } from '@/lib/runs/service'

export default async function DashboardPage() {
  const user = await requireUser()
  const [runs, classrooms] = await Promise.all([
    listRunsForUser(user.id),
    listClassrooms(user.id),
  ])

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">RepoLight Workspace</h1>
            <p className="page-subtitle">Create classroom assignments or run standalone CSV analysis against public GitHub repos.</p>
          </div>
          <div className="toolbar">
            <Link className="button" href="/classrooms/new">
              <School size={16} aria-hidden="true" />
              New Class
            </Link>
            <Link className="button secondary" href="/runs/new">
              <Plus size={16} aria-hidden="true" />
              New Run
            </Link>
          </div>
        </div>

        <section className="stack" style={{ marginBottom: 24 }}>
          <div className="section-head">
            <div>
              <h2 className="section-title">Classrooms</h2>
              <p className="page-subtitle">Rosters, assignments, per-student repos, and analysis handoff.</p>
            </div>
            <Link className="button secondary" href="/classrooms">View All</Link>
          </div>
          {classrooms.length === 0 ? (
            <div className="empty">No classes yet. Start with a class when you want GitHub Classroom-style tracking.</div>
          ) : (
            <div className="run-grid">
              {classrooms.slice(0, 3).map((classroom) => (
                <Link className="run-card" href={`/classrooms/${classroom.id}`} key={classroom.id}>
                  <div>
                    <div className="badge">class</div>
                    <h2 className="panel-title" style={{ marginTop: 12 }}>{classroom.name}</h2>
                    <p className="page-subtitle">{classroom.term || classroom.githubOrg || 'Classroom workspace'}</p>
                  </div>
                  <div className="classroom-stat-row">
                    <span><School size={15} aria-hidden="true" /> {classroom.githubOrg || 'manual repos'}</span>
                    <span><ClipboardList size={15} aria-hidden="true" /> {classroom.assignmentCount} assignments</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="section-head">
          <div>
            <h2 className="section-title">Analysis Runs</h2>
            <p className="page-subtitle">Standalone CSV runs and runs created from classroom assignments.</p>
          </div>
          <Link className="button secondary" href="/runs/new">New Run</Link>
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
