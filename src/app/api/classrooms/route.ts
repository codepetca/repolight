import { z } from 'zod'
import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { createClassroom, listClassrooms } from '@/lib/classroom/service'

const createClassroomSchema = z.object({
  name: z.string().trim().min(1, 'Class name is required.'),
  term: z.string().trim().optional().nullable(),
  githubOrg: z.string().trim().optional().nullable(),
  defaultRepoPrefix: z.string().trim().optional().nullable(),
})

export async function GET() {
  return handleApi(async () => {
    const user = await requireUser()
    return { classrooms: await listClassrooms(user.id) }
  })
}

export async function POST(request: Request) {
  return handleApi(async () => {
    const user = await requireUser()
    const body = createClassroomSchema.parse(await request.json())
    return { classroom: await createClassroom(user.id, body) }
  })
}
