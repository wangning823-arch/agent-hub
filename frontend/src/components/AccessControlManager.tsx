import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

interface User {
  id: string
  username: string
  role: string
  isActive: boolean
}

interface Provider {
  id: string
  name: string
  modelCount?: number
}

export default function AccessControlManager() {
  const [users, setUsers] = useState<User[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [assignedProviderIds, setAssignedProviderIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (selectedUserId) {
      fetchUserProviders(selectedUserId)
    }
  }, [selectedUserId])

  const fetchData = async () => {
    try {
      const [usersRes, providersRes] = await Promise.all([
        fetch(`${API_BASE}/users`),
        fetch(`${API_BASE}/models/providers`),
      ])
      const usersData = await usersRes.json()
      const providersData = await providersRes.json()
      setUsers(usersData.filter((u: User) => u.isActive))
      setProviders(providersData.providers || [])
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUserProviders = async (userId: string) => {
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/providers`)
      const data = await res.json()
      setAssignedProviderIds(new Set(data.providers.map((p: Provider) => p.id)))
    } catch (error) {
      console.error('加载用户 Provider 失败:', error)
    }
  }

  const toggleProvider = (providerId: string) => {
    setAssignedProviderIds(prev => {
      const next = new Set(prev)
      if (next.has(providerId)) {
        next.delete(providerId)
      } else {
        next.add(providerId)
      }
      return next
    })
    setMessage(null)
  }

  const selectAll = () => {
    setAssignedProviderIds(new Set(providers.map(p => p.id)))
    setMessage(null)
  }

  const selectNone = () => {
    setAssignedProviderIds(new Set())
    setMessage(null)
  }

  const save = async () => {
    if (!selectedUserId) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`${API_BASE}/users/${selectedUserId}/providers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerIds: [...assignedProviderIds] }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({ type: 'success', text: '保存成功' })
      } else {
        setMessage({ type: 'error', text: data.error || '保存失败' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div className="space-y-6" style={{ maxWidth: 640 }}>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>为用户分配可访问的系统 Provider，用户将获得该 Provider 下所有模型的访问权限。</p>

      {/* 用户选择 */}
      <div className="card">
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>选择用户</label>
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="select-field w-full"
        >
          <option value="">-- 请选择用户 --</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>
              {u.username} {u.role === 'admin' ? '(管理员)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Provider 列表 */}
      {selectedUserId && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              系统 Provider（{assignedProviderIds.size}/{providers.length} 已选择）
            </label>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)', border: 'none', cursor: 'pointer' }}>全选</button>
              <button onClick={selectNone} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer' }}>全不选</button>
            </div>
          </div>

          {providers.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无系统 Provider，请先在"模型管理"中创建。</p>
          ) : (
            <div className="space-y-2">
              {providers.map(p => (
                <label
                  key={p.id}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: assignedProviderIds.has(p.id) ? 'var(--accent-primary-soft)' : 'var(--bg-secondary)',
                    border: `1px solid ${assignedProviderIds.has(p.id) ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={assignedProviderIds.has(p.id)}
                    onChange={() => toggleProvider(p.id)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.modelCount || 0} 个模型</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 保存按钮 */}
      {selectedUserId && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary px-6 py-2 text-sm"
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
          {message && (
            <span className="text-sm" style={{ color: message.type === 'success' ? 'var(--success)' : 'var(--error)' }}>
              {message.text}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
