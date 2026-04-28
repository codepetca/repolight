import Link from 'next/link'
import { Activity, BarChart3, GitBranch, UserCheck } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { AssignmentActions } from '@/components/AssignmentActions'
import { requireUser } from '@/lib/auth/session'
import { getClassroomAssignmentDetail } from '@/lib/classroom/service'

export default async function ClassroomAssignmentPage({
  params,
}: {
  params: { id: string; assignmentId: string }
}) {
  const user = await requireUser()
  const assignment = await getClassroomAssignmentDetail(user.id, params.id, params.assignmentId)
  const acceptedCount = assignment.repositories.filter((repository) => repository.invitationStatus === 'accepted').length
  const activeCount = assignment.repositories.filter((repository) => repository.activityStatus === 'active' || repository.successfulPushCount > 0).length

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">{assignment.title}</h1>
            <p className="page-subtitle">
              <Link href={`/classrooms/${assignment.classroom.id}`}>{assignment.classroom.name}</Link>
              {' · '}
              due {new Date(assignment.dueAt).toLocaleDateString()}
            </p>
          </div>
          <div className="toolbar">
            {assignment.analysisRunId && (
              <Link className="button secondary" href={`/runs/${assignment.analysisRunId}`}>
                <BarChart3 size={16} aria-hidden="true" />
                Run Workspace
              </Link>
            )}
            <Link className="button secondary" href={`/classrooms/${assignment.classroom.id}`}>Class</Link>
          </div>
        </div>

        <div className="metric-strip">
          <div className="metric-box">
            <div className="metric-label">Repos</div>
            <div className="metric-value">{assignment.repositories.length}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Accepted</div>
            <div className="metric-value">{acceptedCount}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Active</div>
            <div className="metric-value">{activeCount}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Analysis</div>
            <div className="metric-value metric-text">{assignment.analysisRun?.status || 'not created'}</div>
          </div>
        </div>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Analysis Handoff</h2>
            {assignment.analysisRun && (
              <span className={`badge ${assignment.analysisRun.status}`}>{assignment.analysisRun.processedRepositories}/{assignment.analysisRun.totalRepositories} processed</span>
            )}
          </div>
          <div className="panel-body stack">
            <div className="notice">This creates an ordinary Repocat analysis run from the assignment repository mapping. Processing still happens in the run workspace.</div>
            <AssignmentActions classroomId={assignment.classroom.id} assignmentId={assignment.id} analysisRunId={assignment.analysisRunId} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Student Repositories</h2>
            <span className="badge">{assignment.repositories.length}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>GitHub</th>
                  <th>Repository</th>
                  <th>Invite</th>
                  <th>Activity</th>
                  <th>Pushes</th>
                  <th>Last Push</th>
                </tr>
              </thead>
              <tbody>
                {assignment.repositories.map((repository) => (
                  <tr key={repository.id}>
                    <td><UserCheck size={14} aria-hidden="true" /> {repository.student.name}</td>
                    <td>{repository.student.githubLogin ? `@${repository.student.githubLogin}` : 'email match'}</td>
                    <td>
                      <a href={repository.repoUrl} target="_blank" rel="noreferrer">
                        <GitBranch size={14} aria-hidden="true" /> {repository.owner}/{repository.name}
                      </a>
                    </td>
                    <td><span className="badge">{repository.invitationStatus}</span></td>
                    <td><span className="badge">{repository.activityStatus.replaceAll('_', ' ')}</span></td>
                    <td>{repository.successfulPushCount}</td>
                    <td>{repository.lastPushAt ? new Date(repository.lastPushAt).toLocaleString() : 'none yet'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {assignment.repositories.length === 0 && (
            <div className="panel-body">
              <div className="empty">No repositories on this assignment.</div>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">GitHub Automation Roadmap</h2>
            <Activity size={16} aria-hidden="true" />
          </div>
          <div className="panel-body">
            <div className="roadmap-grid">
              <div>
                <strong>Current</strong>
                <span>Manual repo CSV, analysis run creation, status dashboard.</span>
              </div>
              <div>
                <strong>Next</strong>
                <span>GitHub App creates repos from templates and invites students.</span>
              </div>
              <div>
                <strong>Then</strong>
                <span>Webhooks update invitation, push, branch, PR, and activity signals.</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
