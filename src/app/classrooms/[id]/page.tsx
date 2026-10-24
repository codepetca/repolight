import Link from 'next/link'
import { ArrowRight, ClipboardList, Users } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { CreateAssignmentForm } from '@/components/CreateAssignmentForm'
import { requireUser } from '@/lib/auth/session'
import { getClassroomDetail } from '@/lib/classroom/service'

export default async function ClassroomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params
  const user = await requireUser()
  const classroom = await getClassroomDetail(user.id, routeParams.id)

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">{classroom.name}</h1>
            <p className="page-subtitle">
              {[classroom.term, classroom.githubOrg && `@${classroom.githubOrg}`].filter(Boolean).join(' · ') || 'Classroom workspace'}
            </p>
          </div>
          <Link className="button secondary" href="/classrooms">All Classes</Link>
        </div>

        <div className="metric-strip">
          <div className="metric-box">
            <div className="metric-label">Students</div>
            <div className="metric-value">{classroom.students.length}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Assignments</div>
            <div className="metric-value">{classroom.assignments.length}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">GitHub Org</div>
            <div className="metric-value metric-text">{classroom.githubOrg || 'manual'}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Repo Prefix</div>
            <div className="metric-value metric-text">{classroom.defaultRepoPrefix || 'per assignment'}</div>
          </div>
        </div>

        <div className="two-column-layout">
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Assignments</h2>
              <span className="badge">{classroom.assignments.length}</span>
            </div>
            <div className="panel-body stack">
              {classroom.assignments.length === 0 ? (
                <div className="empty">No assignments yet.</div>
              ) : classroom.assignments.map((assignment) => (
                <Link className="list-item" href={`/classrooms/${classroom.id}/assignments/${assignment.id}`} key={assignment.id}>
                  <span className="list-item-icon"><ClipboardList size={16} aria-hidden="true" /></span>
                  <span>
                    <strong>{assignment.title}</strong>
                    <span>{assignment.repositoryCount} repos · due {new Date(assignment.dueAt).toLocaleDateString()}</span>
                  </span>
                  <span className={`badge ${assignment.status}`}>{assignment.status.replaceAll('_', ' ')}</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Students</h2>
              <span className="badge">{classroom.students.length}</span>
            </div>
            <div className="panel-body">
              {classroom.students.length === 0 ? (
                <div className="empty">Students are imported when you create the first assignment.</div>
              ) : (
                <div className="compact-list">
                  {classroom.students.slice(0, 12).map((student) => (
                    <div className="compact-row" key={student.id}>
                      <span><Users size={15} aria-hidden="true" /> {student.name}</span>
                      <span>{student.githubLogin ? `@${student.githubLogin}` : student.email}</span>
                    </div>
                  ))}
                  {classroom.students.length > 12 && <div className="meta-row">+{classroom.students.length - 12} more students</div>}
                </div>
              )}
            </div>
          </section>
        </div>

        <CreateAssignmentForm classroomId={classroom.id} />
      </div>
    </main>
  )
}
