import { AppHeader } from '@/components/AppHeader'
import { CreateClassroomForm } from '@/components/CreateClassroomForm'
import { requireUser } from '@/lib/auth/session'

export default async function NewClassroomPage() {
  const user = await requireUser()

  return (
    <main className="app-shell">
      <AppHeader email={user.email} />
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">New Class</h1>
            <p className="page-subtitle">Create the container for rosters, assignments, repository mappings, and analytics.</p>
          </div>
        </div>
        <CreateClassroomForm />
      </div>
    </main>
  )
}
