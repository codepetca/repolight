import Link from 'next/link'
import { ClipboardList, Plus, School, Users } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { requireUser } from '@/lib/auth/session'
import { listClassrooms } from '@/lib/classroom/service'

export default async function ClassroomsPage() {
  const user = await requireUser()
  const classrooms = await listClassrooms(user.id)

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">RepoLight Classroom</h1>
            <p className="page-subtitle">Manage coding classes, assignment repositories, activity status, and RepoLight analysis runs.</p>
          </div>
          <Link className="button" href="/classrooms/new">
            <Plus size={16} aria-hidden="true" />
            New Class
          </Link>
        </div>

        {classrooms.length === 0 ? (
          <div className="empty">No classes yet. Create a class, paste a student repo CSV, then turn it into a RepoLight analysis run.</div>
        ) : (
          <div className="run-grid">
            {classrooms.map((classroom) => (
              <Link className="run-card" href={`/classrooms/${classroom.id}`} key={classroom.id}>
                <div>
                  <div className="badge">class</div>
                  <h2 className="panel-title" style={{ marginTop: 12 }}>{classroom.name}</h2>
                  <p className="page-subtitle">{classroom.term || classroom.githubOrg || 'No term set'}</p>
                </div>
                <div className="classroom-stat-row">
                  <span><Users size={15} aria-hidden="true" /> {classroom.studentCount} students</span>
                  <span><ClipboardList size={15} aria-hidden="true" /> {classroom.assignmentCount} assignments</span>
                  {classroom.githubOrg && <span><School size={15} aria-hidden="true" /> {classroom.githubOrg}</span>}
                </div>
                <div className="meta-row">
                  <span>Created {new Date(classroom.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
