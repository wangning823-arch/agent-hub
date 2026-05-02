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

interface Credential {
  id: string
  host: string
  type: string
  username?: string
}

export default function AccessControlManager() {
  const [users, setUsers] = useState<User[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [systemCredentials, setSystemCredentials] = useState<Credential[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [assignedProviderIds, setAssignedProviderIds] = useState<Set<string>>(new Set())
  const [assignedCredentialIds, setAssignedCredentialIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [savingProviders, setSavingProviders] = useState(false)
  const [savingCredentials, setSavingCredentials] = useState(false)
  const [providerMessage, setProviderMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [credentialMessage, setCredentialMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (selectedUserId) {
      fetchUserProviders(selectedUserId)
      fetchUserCredentials(selectedUserId)
    }
  }, [selectedUserId])

  const fetchData = async () => {
    try {
      const [usersRes, providersRes, credsRes] = await Promise.all([
        fetch(`${API_BASE}/users`),
        fetch(`${API_BASE}/models/providers`),
        fetch(`${API_BASE}/credentials`),
      ])
      const usersData = await usersRes.json()
      const providersData = await providersRes.json()
      const credsData = await credsRes.json()
      setUsers(usersData.filter((u: User) => u.isActive))
      setProviders(providersData.providers || [])
      setSystemCredentials(credsData.credentials || [])
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

  const fetchUserCredentials = async (userId: string) => {
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/credentials`)
      const data = await res.json()
      setAssignedCredentialIds(new Set(data.credentials.map((c: Credential) => c.id)))
    } catch (error) {
      console.error('加载用户凭证失败:', error)
    }
  }

  // ── Provider 操作 ──

  const toggleProvider = (providerId: string) => {
    setAssignedProviderIds(prev => {
      const next = new Set(prev)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
    setProviderMessage(null)
  }

  const selectAllProviders = () => setAssignedProviderIds(new Set(providers.map(p => p.id)))
  const selectNoneProviders = () => setAssignedProviderIds(new Set())

  const saveProviders = async () => {
    if (!selectedUserId) return
    setSavingProviders(true)
    setProviderMessage(null)
    try {
      const res = await fetch(`${API_BASE}/users/${selectedUserId}/providers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerIds: [...assignedProviderIds] }),
      })
      const data = await res.json()
      if (res.ok) setProviderMessage({ type: 'success', text: '保存成功' })
      else setProviderMessage({ type: 'error', text: data.error || '保存失败' })
    } catch {
      setProviderMessage({ type: 'error', text: '保存失败' })
    } finally {
      setSavingProviders(false)
    }
  }

  // ── Credential 操作 ──

  const toggleCredential = (credId: string) => {
    setAssignedCredentialIds(prev => {
      const next = new Set(prev)
      if (next.has(credId)) next.delete(credId)
      else next.add(credId)
      return next
    })
    setCredentialMessage(null)
  }

  const selectAllCredentials = () => setAssignedCredentialIds(new Set(systemCredentials.map(c => c.id)))
  const selectNoneCredentials = () => setAssignedCredentialIds(new Set())

  const saveCredentials = async () => {
    if (!selectedUserId) return
    setSavingCredentials(true)
    setCredentialMessage(null)
    try {
      const res = await fetch(`${API_BASE}/users/${selectedUserId}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialIds: [...assignedCredentialIds] }),
      })
      const data = await res.json()
      if (res.ok) setCredentialMessage({ type: 'success', text: '保存成功' })
      else setCredentialMessage({ type: 'error', text: data.error || '保存失败' })
    } catch {
      setCredentialMessage({ type: 'error', text: '保存失败' })
    } finally {
      setSavingCredentials(false)
    }
  }

  const typeIcon = (type: string): string => type === 'ssh' ? '🔑' : '🎫'

  if (loading) {
    return <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div className="space-y-6" style={{ maxWidth: 640 }}>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>为用户分配可访问的系统 Provider 和凭证。</p>

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
              <button onClick={selectAllProviders} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)', border: 'none', cursor: 'pointer' }}>全选</button>
              <button onClick={selectNoneProviders} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer' }}>全不选</button>
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

          <div className="flex items-center gap-3 mt-3">
            <button onClick={saveProviders} disabled={savingProviders} className="btn-primary px-4 py-1.5 text-sm" style={{ opacity: savingProviders ? 0.6 : 1 }}>
              {savingProviders ? '保存中...' : '保存 Provider'}
            </button>
            {providerMessage && (
              <span className="text-sm" style={{ color: providerMessage.type === 'success' ? 'var(--success)' : 'var(--error)' }}>
                {providerMessage.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Credential 列表 */}
      {selectedUserId && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              系统凭证（{assignedCredentialIds.size}/{systemCredentials.length} 已选择）
            </label>
            <div className="flex gap-2">
              <button onClick={selectAllCredentials} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)', border: 'none', cursor: 'pointer' }}>全选</button>
              <button onClick={selectNoneCredentials} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer' }}>全不选</button>
            </div>
          </div>

          {systemCredentials.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无系统凭证，请先在"凭证管理"中创建。</p>
          ) : (
            <div className="space-y-2">
              {systemCredentials.map(c => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: assignedCredentialIds.has(c.id) ? 'var(--accent-primary-soft)' : 'var(--bg-secondary)',
                    border: `1px solid ${assignedCredentialIds.has(c.id) ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={assignedCredentialIds.has(c.id)}
                    onChange={() => toggleCredential(c.id)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {typeIcon(c.type)} {c.username ? `${c.username}@${c.host}` : c.host}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {c.type === 'ssh' ? 'SSH密钥' : 'Token'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-3">
            <button onClick={saveCredentials} disabled={savingCredentials} className="btn-primary px-4 py-1.5 text-sm" style={{ opacity: savingCredentials ? 0.6 : 1 }}>
              {savingCredentials ? '保存中...' : '保存凭证'}
            </button>
            {credentialMessage && (
              <span className="text-sm" style={{ color: credentialMessage.type === 'success' ? 'var(--success)' : 'var(--error)' }}>
                {credentialMessage.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
