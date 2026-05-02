import { useState, useEffect, FormEvent, ChangeEvent } from 'react'

interface LoginProps {
  onLogin: (token: string) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasUsers, setHasUsers] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setHasUsers(data.hasUsers))
      .catch(() => setHasUsers(true))
  }, [])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '登录失败')
        setLoading(false)
        return
      }

      localStorage.setItem('access_token', data.accessToken)
      localStorage.setItem('refresh_token', data.refreshToken)
      onLogin(data.accessToken)
    } catch (err) {
      setError('连接失败: ' + (err as Error).message)
    }
    setLoading(false)
  }

  if (hasUsers === false) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100vh', background: 'var(--bg-primary)'
      }}>
        <div style={{
          background: 'var(--bg-secondary)', padding: '40px', borderRadius: '16px',
          border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)',
          width: 360, textAlign: 'center'
        }}>
          <h2 style={{ margin: '0 0 16px', color: 'var(--text-primary)' }}>AgentPilot</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            系统暂无用户，请联系管理员创建账户
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', background: 'var(--bg-primary)'
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--bg-secondary)', padding: '40px', borderRadius: '16px',
        border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-md)',
        width: 360, display: 'flex', flexDirection: 'column', gap: 16
      }}>
        <h2 style={{ textAlign: 'center', margin: 0, color: 'var(--text-primary)' }}>AgentPilot</h2>

        <input
          type="text"
          value={username}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
          placeholder="用户名"
          autoFocus
          style={{
            padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-primary)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none'
          }}
        />

        <input
          type="password"
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          placeholder="密码"
          style={{
            padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-primary)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none'
          }}
        />

        {error && (
          <p style={{ color: 'var(--error)', margin: 0, fontSize: '0.8rem', textAlign: 'center' }}>{error}</p>
        )}

        <button type="submit" disabled={loading} style={{
          padding: '10px', borderRadius: 8, border: 'none',
          background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
          fontWeight: 600, fontSize: '0.9rem'
        }}>
          {loading ? '处理中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
