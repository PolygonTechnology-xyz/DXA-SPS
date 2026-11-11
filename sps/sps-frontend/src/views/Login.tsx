import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Workflow, LogIn, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('demo@dxa-sps.com')
  const [pw, setPw] = useState('demo1234')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    navigate('/projects')
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontSize: 14,
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    margin: '14px 0 6px',
  }

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'var(--bg)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: 32,
          boxShadow: '0 12px 40px rgba(16,24,40,.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 18 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
            <Workflow size={17} strokeWidth={2} />
          </span>
          SPS
        </div>

        <h2 style={{ margin: '18px 0 4px', fontSize: 22, fontWeight: 600, letterSpacing: '-.02em' }}>Welcome back</h2>
        <p style={{ color: 'var(--muted)', margin: '0 0 22px' }}>Log in to continue to your projects.</p>

        <label style={labelStyle} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={fieldStyle}
        />

        <label style={labelStyle} htmlFor="pw">
          Password
        </label>
        <input
          id="pw"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          style={fieldStyle}
        />

        <Button type="submit" variant="primary" icon={LogIn} style={{ width: '100%', marginTop: 22, height: 42 }}>
          Log in
        </Button>

        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/landing')} style={{ width: '100%', marginTop: 12, color: 'var(--muted)' }}>
          Back to home
        </Button>
      </form>
    </div>
  )
}
