'use client'

import { FormEvent, useState } from 'react'
import { LogIn } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Brand } from '@/components/Brand'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Authentication failed.')
      router.push('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-layout">
      <form className="auth-panel stack" aria-label={mode === 'login' ? 'Sign in' : 'Create account'} onSubmit={submit}>
        <div>
          <div className="brand">
            <Brand heading />
          </div>
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </div>

        <button className="button" type="submit" disabled={submitting}>
          <LogIn size={16} aria-hidden="true" />
          {submitting ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <button className="button secondary" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Create an account' : 'Use an existing account'}
        </button>
      </form>
    </main>
  )
}
