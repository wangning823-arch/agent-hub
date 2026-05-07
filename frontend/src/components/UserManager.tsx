import { useState, useEffect } from 'react'

interface User {
  id: string
  username: string
  role: string
  homeDir: string
  displayName: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface UserManagerProps {
  onClose: () => void
  fullPage?: boolean
}

const API_BASE = '/api'

export default function UserManager({ onClose, fullPage }: UserManagerProps) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('user')
  const [error, setError] = useState('')

  const loadUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/users`)
      const data = await res.json()
      setUsers(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Load users failed:', e)
    }
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setShowCreate(false)
      setNewUsername('')
      setNewPassword('')
      setNewRole('user')
      loadUsers()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      await fetch(`${API_BASE}/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })
      loadUsers()
    } catch (e) {
      console.error('Toggle active failed:', e)
    }
  }

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await fetch(`${API_BASE}/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      loadUsers()
    } catch (e) {
      console.error('Change role failed:', e)
    }
  }

  const handleResetPassword = async (userId: string) => {
    const newPass = prompt('输入新密码（至少 6 字符）:')
    if (!newPass || newPass.length < 6) return
    try {
      await fetch(`${API_BASE}/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPass }),
      })
      alert('密码已重置')
    } catch (e) {
      alert('重置失败: ' + (e as Error).message)
    }
  }

  const content = (
    <>
      {!fullPage && (
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>用户管理</h2>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      <div style={{ overflowY: 'auto', padding: fullPage ? '24px 32px' : undefined, maxHeight: fullPage ? undefined : 'calc(80vh - 120px)' }}>
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>共 {users.length} 个用户</span>
            <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm py-1.5 px-3">
              + 创建用户
            </button>
          </div>

          {showCreate && (
            <form onSubmit={handleCreate} className="mb-4 p-4 rounded-xl" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <input
                  type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                  placeholder="用户名" className="input-field text-sm"
                />
                <input
                  type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="密码" className="input-field text-sm"
                />
                <select value={newRole} onChange={e => setNewRole(e.target.value)} className="input-field text-sm">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              {error && <p className="text-xs mb-2" style={{ color: 'var(--error)' }}>{error}</p>}
              <div className="flex gap-2">
                <button type="submit" className="btn-primary text-sm py-1.5 px-3">创建</button>
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm py-1.5 px-3">取消</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
          ) : (
            <div className="space-y-2">
              {users.map(u => (
                <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl" style={{
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                  opacity: u.isActive ? 1 : 0.6,
                }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{u.username}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{
                        background: u.role === 'admin' ? 'var(--accent-primary-soft)' : 'var(--bg-secondary)',
                        color: u.role === 'admin' ? 'var(--accent-primary)' : 'var(--text-muted)',
                      }}>{u.role}</span>
                      {!u.isActive && <span className="text-xs" style={{ color: 'var(--error)' }}>已停用</span>}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{u.homeDir}</div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <select
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>

                    <button
                      onClick={() => handleToggleActive(u.id, u.isActive)}
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        background: u.isActive ? 'var(--success-soft)' : 'var(--error-soft)',
                        color: u.isActive ? 'var(--success)' : 'var(--error)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      {u.isActive ? '已启用' : '已停用'}
                    </button>

                    <button
                      onClick={() => handleResetPassword(u.id)}
                      className="text-xs px-2 py-1 rounded"
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)', border: '1px solid var(--border-primary)', cursor: 'pointer' }}
                    >
                      重置密码
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </>
  )

  if (fullPage) return content

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-content" style={{ maxWidth: 700, maxHeight: '80vh' }} onMouseDown={e => e.stopPropagation()}>
        {content}
      </div>
    </div>
  )
}
