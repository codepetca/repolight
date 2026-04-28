'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, Loader2 } from 'lucide-react'

export function AssignmentActions({
  classroomId,
  assignmentId,
  analysisRunId,
}: {
  classroomId: string
  assignmentId: string
  analysisRunId: string | null
}) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function analyze() {
    if (analysisRunId) {
      router.push(`/runs/${analysisRunId}`)
      return
    }

    setError('')
    setSubmitting(true)
    try {
      const response = await fetch(`/api/classrooms/${classroomId}/assignments/${assignmentId}/analyze`, {
        method: 'POST',
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to prepare analysis.')
      router.push(`/runs/${payload.run.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare analysis.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="stack">
      {error && <div className="alert">{error}</div>}
      <div className="toolbar">
        <button className="button" type="button" onClick={analyze} disabled={submitting}>
          {submitting ? <Loader2 size={16} aria-hidden="true" /> : <BarChart3 size={16} aria-hidden="true" />}
          {analysisRunId ? 'Open Analysis Run' : 'Create Analysis Run'}
        </button>
      </div>
    </div>
  )
}
