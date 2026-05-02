import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

interface CredentialData {
  id: string
  host: string
  type: string
  username?: string
  owner_id?: string | null
  created_at: string
  updated_at: string
  isPersonal: boolean
}

interface ProjectData {
  id: string
  name: string
  workdir: string
  gitHost?: string
}

interface FormData {
  host: string
  type: string
  username: string
  secret: string
  keyData: string
}

interface ScanResult {
  host: string
  type: string
  username?: string
  secret?: string
  keyData?: string
  source?: string
}

interface ScanResults {
  host?: string
  remoteUrl?: string
  isSsh?: boolean
  results: ScanResult[]
  message?: string
}

export default function UserCredentialView() {
  const [credentials, setCredentials] = useState<CredentialData[]>([])
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<FormData>({ host: '', type: 'token', username: '', secret: '', keyData: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResults | null>(null)
  const [scanWorkdir, setScanWorkdir] = useState('')
  const [scanProjectId, setScanProjectId] = useState('')
  const [applyTarget, setApplyTarget] = useState<string | null>(null) // credential id being applied
  const [applyProjectId, setApplyProjectId] = useState('')
  const [applying, setApplying] = useState(false)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const [credRes, projRes] = await Promise.all([
        fetch(`${API_BASE}/my-credentials`),
        fetch(`${API_BASE}/projects`)
      ])
      const credData = await credRes.json()
      const projData = await projRes.json()
      const list = Array.isArray(credData) ? credData : (credData.credentials || [])
      setCredentials(list)
      setProjects(Array.isArray(projData) ? projData : (projData.projects || []))
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const body: Record<string, any> = { host: formData.host.trim(), type: formData.type }
      if (formData.username) body.username = formData.username.trim()
      if (formData.type === 'token') body.secret = formData.secret
      if (formData.type === 'ssh') body.keyData = formData.keyData

      const res = await fetch(`${API_BASE}/my-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      let data: any
      try { data = await res.json() } catch { setError(`服务器返回异常 (HTTP ${res.status})`); return }
      if (!res.ok) { setError(data.error || '设置失败'); return }

      setFormData({ host: '', type: 'token', username: '', secret: '', keyData: '' })
      setShowForm(false)
      await fetchData()
    } catch (error: any) {
      setError(error?.message || '网络请求失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此凭证？')) return
    try {
      const res = await fetch(`${API_BASE}/my-credentials/${id}`, { method: 'DELETE' })
      if (res.ok) fetchData()
    } catch (error) { console.error('删除凭证失败:', error) }
  }

  const handleScan = async () => {
    if (!scanWorkdir.trim()) { setError('请输入项目路径'); return }
    setScanning(true); setScanResults(null); setError('')
    try {
      const res = await fetch(`${API_BASE}/my-credentials/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir: scanWorkdir.trim() })
      })
      let data: any
      try { data = await res.json() } catch { setError(`服务器返回异常 (HTTP ${res.status})`); return }
      if (!res.ok) { setError(data.error || '扫描失败'); return }
      setScanResults(data)
    } catch (error: any) {
      setError(error?.message || '网络请求失败')
    } finally {
      setScanning(false)
    }
  }

  const handleSaveScanned = async (cred: ScanResult) => {
    try {
      const body: Record<string, any> = { host: cred.host, type: cred.type }
      if (cred.username) body.username = cred.username
      if (cred.type === 'token') body.secret = cred.secret
      if (cred.type === 'ssh') body.keyData = cred.keyData

      const res = await fetch(`${API_BASE}/my-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      let data: any
      try { data = await res.json() } catch { setError(`服务器返回异常 (HTTP ${res.status})`); return }
      if (!res.ok) { setError(data.error || '保存失败'); return }
      await fetchData()
      setScanResults(null)
    } catch (error: any) {
      setError(error?.message || '网络请求失败')
    }
  }

  // ── 应用到项目 ──

  const handleApplyToProject = async (cred: CredentialData) => {
    if (!applyProjectId) return
    setApplying(true)
    try {
      const res = await fetch(`${API_BASE}/projects/${applyProjectId}/apply-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: cred.host })
      })
      let data: any
      try { data = await res.json() } catch { setError(`服务器返回异常 (HTTP ${res.status})`); return }
      if (!res.ok) { setError(data.error || '应用失败'); return }
      setApplyTarget(null)
      setApplyProjectId('')
    } catch (error: any) {
      setError(error?.message || '网络请求失败')
    } finally {
      setApplying(false)
    }
  }

  const typeLabel = (type: string): string => type === 'ssh' ? 'SSH密钥' : 'Token'
  const typeIcon = (type: string): string => type === 'ssh' ? '🔑' : '🎫'

  if (loading) {
    return <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  const systemCredentials = credentials.filter(c => !c.isPersonal)
  const personalCredentials = credentials.filter(c => c.isPersonal)

  // 凭证应用到项目的卡片（共用）
  const renderCredentialCard = (c: CredentialData, showDelete: boolean) => (
    <div key={c.id} className="card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            {typeIcon(c.type)}
            {c.username ? (
              <><span style={{ color: 'var(--accent-primary)' }}>{c.username}</span>@{c.host}</>
            ) : c.host}
            <span className="badge text-xs" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>
              {typeLabel(c.type)}
            </span>
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {c.updated_at ? `更新于 ${new Date(c.updated_at).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {applyTarget === c.id ? (
            <div className="flex items-center gap-2">
              <select
                value={applyProjectId}
                onChange={e => setApplyProjectId(e.target.value)}
                className="select-field text-xs"
                style={{ minWidth: 140 }}
              >
                <option value="">选择项目...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={() => handleApplyToProject(c)}
                disabled={!applyProjectId || applying}
                className="text-xs px-2 py-1 rounded"
                style={{
                  color: 'white', background: 'var(--success)',
                  border: 'none', cursor: (!applyProjectId || applying) ? 'not-allowed' : 'pointer',
                  opacity: (!applyProjectId || applying) ? 0.5 : 1,
                }}
              >
                {applying ? '...' : '确认'}
              </button>
              <button
                onClick={() => { setApplyTarget(null); setApplyProjectId('') }}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer' }}
              >
                取消
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => { setApplyTarget(c.id); setApplyProjectId(''); setError('') }}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--success)', background: 'var(--success-soft)', border: 'none', cursor: 'pointer' }}
              >
                应用到项目
              </button>
              {showDelete && (
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--error)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  删除
                </button>
              )}
              {!showDelete && (
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>系统</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* 系统凭证（只读） */}
      {systemCredentials.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>系统凭证（管理员分配）</h3>
          <div className="space-y-2">
            {systemCredentials.map(c => renderCredentialCard(c, false))}
          </div>
        </div>
      )}

      {/* 个人凭证 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>个人凭证</h3>
          <button
            onClick={() => { setShowForm(!showForm); setError(''); setScanResults(null) }}
            className="text-sm px-3 py-1.5 rounded"
            style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            {showForm ? '取消' : '+ 添加凭证'}
          </button>
        </div>

        {/* 扫描区域 */}
        {!showForm && (
          <div className="card mb-3 space-y-2">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>从现有项目读取凭证</label>
            {projects.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无项目，请先创建项目</p>
            ) : (
              <div className="flex gap-2">
                <select
                  value={scanProjectId}
                  onChange={e => {
                    const id = e.target.value
                    setScanProjectId(id)
                    const proj = projects.find(p => p.id === id)
                    setScanWorkdir(proj ? proj.workdir : '')
                  }}
                  className="select-field flex-1 text-sm"
                >
                  <option value="">选择项目...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button onClick={handleScan} disabled={scanning || !scanWorkdir.trim()} className="btn-primary px-3 py-1.5 text-sm whitespace-nowrap">
                  {scanning ? '扫描中...' : '🔍 扫描'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 扫描结果 */}
        {scanResults && (
          <div className="card mb-3 space-y-2">
            <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              扫描结果: {scanResults.remoteUrl || scanResults.host}
            </div>
            {scanResults.results.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {scanResults.message || '未发现可提取的凭证'}
              </p>
            ) : (
              <div className="space-y-2">
                {scanResults.results.map((cred, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                    <div>
                      <div className="text-sm flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        {typeIcon(cred.type)} {cred.host}
                        <span className="badge text-xs" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>
                          {typeLabel(cred.type)}
                        </span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {cred.username} · 来源: {cred.source}
                      </div>
                    </div>
                    <button onClick={() => handleSaveScanned(cred)} className="btn-primary px-2 py-1 text-xs">
                      保存
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setScanResults(null)} className="text-xs" style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
              关闭
            </button>
          </div>
        )}

        {/* 手动添加表单 */}
        {showForm && (
          <form onSubmit={handleSubmit} className="card mb-3 space-y-3">
            {error && (
              <div className="text-sm p-2 rounded" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}>
                {error}
              </div>
            )}
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Host *</label>
              <input type="text" placeholder="github.com" value={formData.host}
                onChange={e => setFormData(p => ({ ...p, host: e.target.value }))} className="input-field w-full" required />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>凭证类型 *</label>
              <select value={formData.type}
                onChange={e => setFormData(p => ({ ...p, type: e.target.value, secret: '', keyData: '' }))}
                className="select-field w-full">
                <option value="token">Token (HTTPS)</option>
                <option value="ssh">SSH密钥</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>用户名 (可选)</label>
              <input type="text" placeholder={formData.type === 'ssh' ? 'git' : 'oauth2'} value={formData.username}
                onChange={e => setFormData(p => ({ ...p, username: e.target.value }))} className="input-field w-full" />
            </div>
            {formData.type === 'token' ? (
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Token *</label>
                <input type="password" autoComplete="one-time-code" placeholder="***" value={formData.secret}
                  onChange={e => setFormData(p => ({ ...p, secret: e.target.value }))} className="input-field w-full" required />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>SSH私钥 *</label>
                <textarea placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={formData.keyData}
                  onChange={e => setFormData(p => ({ ...p, keyData: e.target.value }))}
                  className="input-field w-full h-24 resize-none font-mono text-xs" required />
              </div>
            )}
            <button type="submit" disabled={submitting} className="btn-primary w-full py-2 text-sm">
              {submitting ? '保存中...' : '保存凭证'}
            </button>
          </form>
        )}

        {error && !showForm && !scanResults && (
          <div className="card mb-3" style={{ background: 'var(--error-soft)', borderColor: 'var(--error)' }}>
            <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>
          </div>
        )}

        {/* 个人凭证列表 */}
        {personalCredentials.length === 0 && !showForm ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无个人凭证，点击上方按钮添加或扫描。</p>
        ) : (
          <div className="space-y-2">
            {personalCredentials.map(c => renderCredentialCard(c, true))}
          </div>
        )}
      </div>
    </div>
  )
}
