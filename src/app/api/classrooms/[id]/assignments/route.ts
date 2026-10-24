import { z } from 'zod'
import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { createClassroomAssignment } from '@/lib/classroom/service'

const createAssignmentSchema = z.object({
  title: z.string().trim().min(1, 'Assignment title is required.'),
  csvText: z.string().min(1, 'CSV text is required.'),
  startAt: z.string().min(1, 'startAt is required.'),
  dueAt: z.string().min(1, 'dueAt is required.'),
  timezone: z.string().trim().min(1).default('America/Toronto'),
  templateRepoUrl: z.string().trim().optional().nullable(),
  repoPrefix: z.string().trim().optional().nullable(),
  repoVisibility: z.string().trim().optional().nullable(),
  rubric: z.any().optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params
  return handleApi(async () => {
    const user = await requireUser()
    const body = createAssignmentSchema.parse(await request.json())
    return { assignment: await createClassroomAssignment(user.id, routeParams.id, body) }
  })
}
