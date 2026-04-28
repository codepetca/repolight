'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, GitBranchPlus, Loader2 } from 'lucide-react'

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
  const [submitting, setSubmitting] = useState<'analyze' | 'provision' | null>(null)

  async function provision() {
    setError('')
    setSubmitting('provision')
    try {
      const response = await fetch(`/api/classrooms/${classroomId}/assignments/${assignmentId}/provision`, {
        method: 'POST',
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to provision repositories.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to provision repositories.')
    } finally {
      setSubmitting(null)
    }
  }

  async function analyze() {
    if (analysisRunId) {
      router.push(`/runs/${analysisRunId}`)
      return
    }

    setError('')
    setSubmitting('analyze')
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
      setSubmitting(null)
    }
  }

  return (
    <div className="stack">
      {error && <div className="alert">{error}</div>}
      <div className="toolbar">
        <button className="button secondary" type="button" onClick={provision} disabled={submitting !== null}>
          {submitting === 'provision' ? <Loader2 size={16} aria-hidden="true" /> : <GitBranchPlus size={16} aria-hidden="true" />}
          {submitting === 'provision' ? 'Provisioning...' : 'Provision Repos'}
        </button>
        <button className="button" type="button" onClick={analyze} disabled={submitting !== null}>
          {submitting === 'analyze' ? <Loader2 size={16} aria-hidden="true" /> : <BarChart3 size={16} aria-hidden="true" />}
          {analysisRunId ? 'Open Analysis Run' : 'Create Analysis Run'}
        </button>
      </div>
    </div>
  )
}
