import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

// ---- 类型定义 ----

interface Credential {
  key: string
  host: string
  type: string
  username?: string
  updatedAt?: string
  [key: string]: any
}

interface Project {
  id: string
  name: string
  workdir: string
  gitHost?: string
  [key: string]: any
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
  remoteUrl: string
  results: ScanResult[]
  message?: string
}

export default function CredentialManager() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<FormData>({ host: '', type: 'token', username: '', secret: '', keyData: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResults | null>(null)
  const [selectedProject, setSelectedProject] = useState('')

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const [creds, projs] = await Promise.all([
        fetch(`${API_BASE}/credentials`).then(r => r.json()),
        fetch(`${API_BASE}/projects`).then(r => r.json())
      ])
      setCredentials(creds)
      setProjects(projs)
    } catch (e) {
      console.error('加载数据失败:', e)
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

      const res = await fetch(`${API_BASE}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '设置失败')

      setFormData({ host: '', type: 'token', username: '', secret: '', keyData: '' })
      setShowForm(false)
      await fetchData()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (key: string) => {
    if (!confirm(`确定删除此凭证？`)) return
    try {
      await fetch(`${API_BASE}/credentials/${encodeURIComponent(key)}`, { method: 'DELETE' })
      await fetchData()
    } catch (e) {
      console.error('删除凭证失败:', e)
    }
  }

  const handleScan = async () => {
    if (!selectedProject) return
    const proj = projects.find(p => p.id === selectedProject)
    if (!proj) return
    setScanning(true)
    setScanResults(null)
    try {
      const res = await fetch(`${API_BASE}/credentials/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir: proj.workdir })
      })
      setScanResults(await res.json())
    } catch (e: any) {
      setError('扫描失败: ' + e.message)
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

      const res = await fetch(`${API_BASE}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      await fetchData()
      setScanResults(null)
    } catch (e: any) {
      setError('保存失败: ' + e.message)
    }
  }

  const typeLabel = (type: string): string => type === 'ssh' ? 'SSH密钥' : 'Token'
  const typeIcon = (type: string): string => type === 'ssh' ? '🔑' : '🎫'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          管理Git远程仓库凭证，自动应用到匹配的项目
        </p>
        <div className="flex gap-2">
          <button onClick={() => { setShowForm(!showForm); setError(''); setScanResults(null) }} className="btn-secondary px-3 py-1.5 text-sm">
            {showForm ? '取消' : '+ 手动添加'}
          </button>
        </div>
      </div>

      {/* 从现有项目扫描 */}
      <div className="card space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>从现有项目读取凭证</label>
        <div className="flex gap-2">
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="select-field flex-1"
          >
            <option value="">选择一个项目...</option>
            {projects.filter(p => p.gitHost).map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.gitHost})</option>
            ))}
          </select>
          <button onClick={handleScan} disabled={!selectedProject || scanning} className="btn-primary px-3 py-1.5 text-sm whitespace-nowrap">
            {scanning ? '扫描中...' : '🔍 扫描'}
          </button>
        </div>
      </div>

      {/* 扫描结果 */}
      {scanResults && (
        <div className="card space-y-2">
          <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            扫描结果: {scanResults.remoteUrl}
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
        </div>
      )}

      {/* 手动添加表单 */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-3">
          {error && (
            <div className="text-sm p-2 rounded" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}>
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Host *</label>
            <input
              type="text"
              placeholder="github.com"
              value={formData.host}
              onChange={e => setFormData(p => ({ ...p, host: e.target.value }))}
              className="input-field w-full"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>凭证类型 *</label>
            <select
              value={formData.type}
              onChange={e => setFormData(p => ({ ...p, type: e.target.value, secret: '', keyData: '' }))}
              className="select-field w-full"
            >
              <option value="token">Token (HTTPS)</option>
              <option value="ssh">SSH密钥</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>用户名 (可选)</label>
            <input
              type="text"
              placeholder={formData.type === 'ssh' ? 'git' : 'oauth2'}
              value={formData.username}
              onChange={e => setFormData(p => ({ ...p, username: e.target.value }))}
              className="input-field w-full"
            />
          </div>
          {formData.type === 'token' ? (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Token *</label>
              <input
                type="password"
                placeholder="***"
                value={formData.secret}
                onChange={e => setFormData(p => ({ ...p, secret: e.target.value }))}
                className="input-field w-full"
                required
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>SSH私钥 *</label>
              <textarea
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={formData.keyData}
                onChange={e => setFormData(p => ({ ...p, keyData: e.target.value }))}
                className="input-field w-full h-24 resize-none font-mono text-xs"
                required
              />
            </div>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full py-2 text-sm">
            {submitting ? '保存中...' : '保存凭证'}
          </button>
        </form>
      )}

      {/* 凭证列表 */}
      {loading ? (
        <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
      ) : credentials.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无已配置的凭证</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>从现有项目扫描或手动添加</p>
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map(cred => (
            <div key={cred.key} className="card flex items-center justify-between">
              <div>
                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  {typeIcon(cred.type)}
                  {cred.username ? (
                    <><span style={{ color: 'var(--accent-primary)' }}>{cred.username}</span>@{cred.host}</>
                  ) : (
                    cred.host
                  )}
                  <span className="badge text-xs" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>
                    {typeLabel(cred.type)}
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {cred.updatedAt ? `更新于 ${new Date(cred.updatedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <button onClick={() => handleDelete(cred.key)} className="text-xs px-2 py-1 rounded hover:bg-red-500/10" style={{ color: 'var(--error)' }}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
