import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

interface Credential {
  id: string
  host: string
  type: string
  username?: string
  updatedAt?: string
  created_at?: string
  updated_at?: string
  key?: string
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

export default function CredentialManager() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<FormData>({ host: '', type: 'token', username: '', secret: '', keyData: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResults | null>(null)
  const [scanWorkdir, setScanWorkdir] = useState('')

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE}/credentials`)
      const data = await res.json()
      // 兼容新格式 { credentials: [...] } 和旧格式 [...]
      const list = Array.isArray(data) ? data : (data.credentials || [])
      setCredentials(list)
    } catch (e) {
      console.error('加载凭证失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({ host: '', type: 'token', username: '', secret: '', keyData: '' })
    setEditingId(null)
    setShowForm(false)
    setError('')
    setScanResults(null)
  }

  const startEdit = (cred: Credential) => {
    setFormData({
      host: cred.host,
      type: cred.type,
      username: cred.username || '',
      secret: '',
      keyData: '',
    })
    setEditingId(cred.id)
    setShowForm(true)
    setError('')
    setScanResults(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const body: Record<string, any> = { host: formData.host.trim(), type: formData.type }
      if (formData.username) body.username = formData.username.trim()
      if (formData.type === 'token' && formData.secret) body.secret = formData.secret
      if (formData.type === 'ssh' && formData.keyData) body.keyData = formData.keyData

      const url = editingId ? `${API_BASE}/credentials/${editingId}` : `${API_BASE}/credentials`
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      let data: any
      try {
        data = await res.json()
      } catch {
        setError(`服务器返回异常 (HTTP ${res.status})`)
        return
      }
      if (!res.ok) {
        setError(data.error || '操作失败')
        return
      }

      resetForm()
      await fetchData()
    } catch (e: any) {
      console.error('保存凭证失败:', e)
      setError(e?.message || '网络请求失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此系统凭证？')) return
    try {
      const res = await fetch(`${API_BASE}/credentials/${id}`, { method: 'DELETE' })
      if (res.ok) fetchData()
    } catch (e) {
      console.error('删除凭证失败:', e)
    }
  }

  const handleScan = async () => {
    if (!scanWorkdir.trim()) {
      setError('请输入项目路径')
      return
    }
    setScanning(true)
    setScanResults(null)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/credentials/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir: scanWorkdir.trim() })
      })
      let data: any
      try {
        data = await res.json()
      } catch {
        setError(`服务器返回异常 (HTTP ${res.status})`)
        return
      }
      if (!res.ok) {
        setError(data.error || '扫描失败')
        return
      }
      setScanResults(data)
    } catch (e: any) {
      console.error('扫描凭证失败:', e)
      setError(e?.message || '网络请求失败')
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
      let data: any
      try {
        data = await res.json()
      } catch {
        setError(`服务器返回异常 (HTTP ${res.status})`)
        return
      }
      if (!res.ok) {
        setError(data.error || '保存失败')
        return
      }
      await fetchData()
      setScanResults(null)
    } catch (e: any) {
      console.error('保存扫描凭证失败:', e)
      setError(e?.message || '网络请求失败')
    }
  }

  const typeLabel = (type: string): string => type === 'ssh' ? 'SSH密钥' : 'Token'
  const typeIcon = (type: string): string => type === 'ssh' ? '🔑' : '🎫'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          管理系统级凭证，可分配给用户使用
        </p>
        <div className="flex gap-2">
          <button onClick={() => showForm ? resetForm() : setShowForm(true)} className="btn-secondary px-3 py-1.5 text-sm">
            {showForm ? '取消' : '+ 手动添加'}
          </button>
        </div>
      </div>

      {/* 扫描区域 */}
      {!showForm && (
        <div className="card space-y-2">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>从现有项目读取凭证</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="项目路径 (如 /home/user/project)"
              value={scanWorkdir}
              onChange={e => setScanWorkdir(e.target.value)}
              className="input-field flex-1"
            />
            <button onClick={handleScan} disabled={scanning || !scanWorkdir.trim()} className="btn-primary px-3 py-1.5 text-sm whitespace-nowrap">
              {scanning ? '扫描中...' : '🔍 扫描'}
            </button>
          </div>
        </div>
      )}

      {/* 扫描结果 */}
      {scanResults && (
        <div className="card space-y-2">
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

      {/* 手动添加/编辑表单 */}
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
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Token {editingId ? '(留空则不更新)' : '*'}</label>
              <input
                type="password"
                autoComplete="one-time-code"
                placeholder="***"
                value={formData.secret}
                onChange={e => setFormData(p => ({ ...p, secret: e.target.value }))}
                className="input-field w-full"
                required={!editingId}
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>SSH私钥 {editingId ? '(留空则不更新)' : '*'}</label>
              <textarea
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={formData.keyData}
                onChange={e => setFormData(p => ({ ...p, keyData: e.target.value }))}
                className="input-field w-full h-24 resize-none font-mono text-xs"
                required={!editingId}
              />
            </div>
          )}
          <button type="submit" disabled={submitting} className="btn-primary w-full py-2 text-sm">
            {submitting ? '保存中...' : editingId ? '更新凭证' : '保存凭证'}
          </button>
        </form>
      )}

      {/* 凭证列表 */}
      {loading ? (
        <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
      ) : credentials.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无系统凭证</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>从现有项目扫描或手动添加</p>
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map(cred => (
            <div key={cred.id} className="card flex items-center justify-between">
              <div>
                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  {typeIcon(cred.type)}
                  {cred.username ? (
                    <><span style={{ color: 'var(--accent-primary)' }}>{cred.username}</span>@{cred.host}</>
                  ) : cred.host}
                  <span className="badge text-xs" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>
                    {typeLabel(cred.type)}
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {cred.updated_at ? `更新于 ${new Date(cred.updated_at).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(cred)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)', border: 'none', cursor: 'pointer' }}
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(cred.id)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--error)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
