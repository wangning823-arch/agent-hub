import { useState, FormEvent, ChangeEvent } from 'react'

interface LoginProps {
  onLogin: (token: string) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [token, setToken] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!token.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/check', {
        headers: { 'x-access-token': token.trim() }
      })
      const data = await res.json()
      if (data.valid) {
        localStorage.setItem('access_token', token.trim())
        onLogin(token.trim())
      } else {
        setError('Token 无效')
      }
    } catch (err) {
      setError('验证失败: ' + (err as Error).message)
    }
    setLoading(false)
  }

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', background: 'var(--bg-primary)'
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--bg-secondary)', padding: '40px', borderRadius: '16px',
        border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)',
        width: 340, display: 'flex', flexDirection: 'column', gap: 16
      }}>
        <h2 style={{ textAlign: 'center', margin: 0, color: 'var(--text-primary)' }}>🔐 AgentPilot</h2>
        <p style={{ textAlign: 'center', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          请输入访问 Token
        </p>
        <input
          type="password"
          autoComplete="one-time-code"
          value={token}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
          placeholder="Token"
          autoFocus
          style={{
            padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-primary)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.9rem',
            outline: 'none'
          }}
        />
        {error && <p style={{ color: 'var(--error)', margin: 0, fontSize: '0.8rem', textAlign: 'center' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{
          padding: '10px', borderRadius: 8, border: 'none',
          background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
          fontWeight: 600, fontSize: '0.9rem'
        }}>{loading ? '验证中...' : '进入'}</button>
      </form>
    </div>
  )
}
