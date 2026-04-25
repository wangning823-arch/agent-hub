import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'

const API_BASE = '/api'

const formatCtx = (tokens) => {
  if (!tokens) return ''
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

export default function ModelManager() {
  const toast = useToast()
  const [providers, setProviders] = useState([])
  const [models, setModels] = useState({})
  const [syncStatus, setSyncStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [expandedProvider, setExpandedProvider] = useState(null)
  const [editingProvider, setEditingProvider] = useState(null)
  const [addingProvider, setAddingProvider] = useState(false)
  const [addingModel, setAddingModel] = useState(null)
  const [editingModel, setEditingModel] = useState(null)
  const [syncing, setSyncing] = useState({})

  const providerFormInit = { id: '', name: '', npmPackage: '', baseUrl: '', baseUrlAnthropic: '', apiKey: '' }
  const [providerForm, setProviderForm] = useState(providerFormInit)
  const [editingHasApiKey, setEditingHasApiKey] = useState(false)

  const modelFormInit = { id: '', name: '', contextLimit: 0, outputLimit: 0, inputModalities: ['text'], outputModalities: ['text'] }
  const [modelForm, setModelForm] = useState(modelFormInit)

  const fetchData = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/models/providers`),
        fetch(`${API_BASE}/models/sync/status`)
      ])
      const pData = await pRes.json()
      const sData = await sRes.json()
      setProviders(pData.providers || [])
      setSyncStatus(sData.status || {})
      const m = {}
      for (const p of pData.providers || []) {
        try {
          const mr = await fetch(`${API_BASE}/models/providers/${p.id}/models`)
          const md = await mr.json()
          m[p.id] = md.models || []
        } catch { m[p.id] = [] }
      }
      setModels(m)
    } catch (e) {
      console.error('加载模型数据失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const startEditProvider = (p) => {
    setEditingProvider(p.id)
    setProviderForm({ id: p.id, name: p.name, npmPackage: p.npmPackage || '', baseUrl: p.baseUrl, baseUrlAnthropic: p.baseUrlAnthropic || '', apiKey: '' })
    setEditingHasApiKey(!!p.hasApiKey)
    setAddingProvider(false)
  }

  const startAddProvider = () => {
    setAddingProvider(true)
    setEditingProvider(null)
    setProviderForm(providerFormInit)
    setEditingHasApiKey(false)
  }

  const cancelProviderForm = () => {
    setAddingProvider(false)
    setEditingProvider(null)
    setProviderForm(providerFormInit)
    setEditingHasApiKey(false)
  }

  const saveProvider = async (isEdit) => {
    if (!providerForm.id || !providerForm.name || !providerForm.baseUrl) {
      toast.error('ID、名称、Base URL 必填')
      return
    }
    try {
      const url = isEdit
        ? `${API_BASE}/models/providers/${providerForm.id}`
        : `${API_BASE}/models/providers`
      const method = isEdit ? 'PUT' : 'POST'
      const body = { ...providerForm }
      if (isEdit && !body.apiKey) delete body.apiKey
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '保存失败'); return }
      toast.success(isEdit ? 'Provider 已更新' : 'Provider 已添加')
      cancelProviderForm()
      fetchData()
      notifyModelsChanged()
    } catch (e) {
      toast.error('保存失败: ' + e.message)
    }
  }

  const deleteProvider = async (id) => {
    if (!window.confirm(`确定删除 Provider "${id}" 及其所有模型？`)) return
    try {
      const res = await fetch(`${API_BASE}/models/providers/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '删除失败'); return }
      toast.success('Provider 已删除')
      if (expandedProvider === id) setExpandedProvider(null)
      fetchData()
      notifyModelsChanged()
    } catch (e) {
      toast.error('删除失败: ' + e.message)
    }
  }

  const startAddModel = (providerId) => {
    setAddingModel(providerId)
    setEditingModel(null)
    setModelForm(modelFormInit)
  }

  const startEditModel = (providerId, model) => {
    setEditingModel({ providerId, modelId: model.id })
    setAddingModel(null)
    setModelForm({
      id: model.id, name: model.name,
      contextLimit: model.contextLimit || 0, outputLimit: model.outputLimit || 0,
      inputModalities: model.inputModalities || ['text'], outputModalities: model.outputModalities || ['text']
    })
  }

  const cancelModelForm = () => {
    setAddingModel(null)
    setEditingModel(null)
    setModelForm(modelFormInit)
  }

  const saveModel = async (providerId, isEdit) => {
    if (!modelForm.id || !modelForm.name) {
      toast.error('模型 ID、名称必填')
      return
    }
    try {
      const modelId = isEdit ? `/${editingModel.modelId}` : ''
      const url = `${API_BASE}/models/providers/${providerId}/models${modelId}`
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelForm)
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '保存失败'); return }
      toast.success(isEdit ? '模型已更新' : '模型已添加')
      cancelModelForm()
      fetchData()
      notifyModelsChanged()
    } catch (e) {
      toast.error('保存失败: ' + e.message)
    }
  }

  const deleteModel = async (providerId, modelId) => {
    if (!window.confirm(`确定删除模型 "${modelId}"？`)) return
    try {
      const res = await fetch(`${API_BASE}/models/providers/${providerId}/models/${modelId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '删除失败'); return }
      toast.success('模型已删除')
      fetchData()
      notifyModelsChanged()
    } catch (e) {
      toast.error('删除失败: ' + e.message)
    }
  }

  const notifyModelsChanged = () => {
    window.dispatchEvent(new CustomEvent('models-changed'))
  }

  const handleSync = async (tool, body) => {
    setSyncing(prev => ({ ...prev, [tool]: true }))
    try {
      const res = await fetch(`${API_BASE}/models/sync/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '同步失败'); return }
      toast.success(data.message || '同步成功')
      await fetch(`${API_BASE}/models/refresh-cache`, { method: 'POST' }).catch(() => {})
      fetchData()
      notifyModelsChanged()
    } catch (e) {
      toast.error('同步失败: ' + e.message)
    } finally {
      setSyncing(prev => ({ ...prev, [tool]: false }))
    }
  }

  const toggleModality = (field, mod) => {
    setModelForm(prev => {
      const current = prev[field] || []
      const next = current.includes(mod) ? current.filter(m => m !== mod) : [...current, mod]
      return { ...prev, [field]: next.length > 0 ? next : ['text'] }
    })
  }

  if (loading) {
    return <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Provider 列表</h3>
          <button onClick={startAddProvider} className="btn-primary text-xs py-1 px-3">+ 添加 Provider</button>
        </div>

        {addingProvider && (
          <ProviderForm form={providerForm} setForm={setProviderForm} onSave={() => saveProvider(false)} onCancel={cancelProviderForm} isNew hasApiKey={editingHasApiKey} />
        )}

        {providers.length === 0 && !addingProvider && (
          <div className="card text-center py-6">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无 Provider，点击上方按钮添加</p>
          </div>
        )}

        {providers.map(p => (
          <div key={p.id} className="card mb-2">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedProvider(expandedProvider === p.id ? null : p.id)}>
              <div className="flex items-center gap-2 min-w-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: expandedProvider === p.id ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {p.id} · {p.modelCount} 个模型 · {p.baseUrl}{p.baseUrlAnthropic ? ' / ' + p.baseUrlAnthropic : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={(e) => { e.stopPropagation(); startEditProvider(p) }} className="btn-icon-sm" title="编辑">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteProvider(p.id) }} className="btn-icon-sm" title="删除" style={{ color: 'var(--error)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>

            {editingProvider === p.id && (
              <ProviderForm form={providerForm} setForm={setProviderForm} onSave={() => saveProvider(true)} onCancel={cancelProviderForm} hasApiKey={editingHasApiKey} />
            )}

            {expandedProvider === p.id && editingProvider !== p.id && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                {addingModel === p.id && (
                  <ModelForm form={modelForm} setForm={setModelForm} onSave={() => saveModel(p.id, false)} onCancel={cancelModelForm} isNew toggleModality={toggleModality} />
                )}
                {(models[p.id] || []).map(m => (
                  <div key={m.id} className="mb-1">
                    {editingModel?.providerId === p.id && editingModel?.modelId === m.id ? (
                      <ModelForm form={modelForm} setForm={setModelForm} onSave={() => saveModel(p.id, true)} onCancel={cancelModelForm} toggleModality={toggleModality} />
                    ) : (
                      <div className="flex items-center justify-between py-1.5 px-2 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="min-w-0">
                          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                          <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                            {m.id} · {formatCtx(m.contextLimit)} ctx · {formatCtx(m.outputLimit)} out
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => startEditModel(p.id, m)} className="btn-icon-sm" title="编辑">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button onClick={() => deleteModel(p.id, m.id)} className="btn-icon-sm" title="删除" style={{ color: 'var(--error)' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {(models[p.id] || []).length === 0 && addingModel !== p.id && (
                  <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>暂无模型</p>
                )}
                {addingModel !== p.id && (
                  <button onClick={() => startAddModel(p.id)} className="text-xs mt-2 py-1 px-2 rounded-lg"
                    style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)' }}>
                    + 添加模型
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <ToolSyncSection providers={providers} models={models} syncStatus={syncStatus} syncing={syncing} onSync={handleSync} />
    </div>
  )
}

function ProviderForm({ form, setForm, onSave, onCancel, isNew, hasApiKey }) {
  return (
    <div className="p-3 mt-2 rounded-lg space-y-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
      <div className="grid grid-cols-2 gap-2">
        {isNew && (
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Provider ID</label>
            <input value={form.id} onChange={e => setForm(p => ({ ...p, id: e.target.value }))} className="input-field text-xs" placeholder="如 mimo, volcengine-plan" />
          </div>
        )}
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>名称</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="input-field text-xs" placeholder="MiMo" />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>NPM 包</label>
          <input value={form.npmPackage} onChange={e => setForm(p => ({ ...p, npmPackage: e.target.value }))} className="input-field text-xs" placeholder="@ai-sdk/openai-compatible" />
        </div>
      </div>
      <div>
        <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Base URL (OpenAI 协议)</label>
        <input value={form.baseUrl} onChange={e => setForm(p => ({ ...p, baseUrl: e.target.value }))} className="input-field text-xs" placeholder="https://api.example.com/v1" />
      </div>
      <div>
        <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Base URL (Anthropic 协议)</label>
        <input value={form.baseUrlAnthropic} onChange={e => setForm(p => ({ ...p, baseUrlAnthropic: e.target.value }))} className="input-field text-xs" placeholder="https://api.example.com/anthropic" />
      </div>
      <div>
        <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>API Key {!isNew && hasApiKey && <span style={{ color: 'var(--success, #22c55e)' }}>● 已设置</span>}</label>
        <input value={form.apiKey} onChange={e => setForm(p => ({ ...p, apiKey: e.target.value }))} className="input-field text-xs" type="password" placeholder={isNew ? '输入 API Key' : hasApiKey ? '输入新值替换，留空保持原值' : '输入 API Key'} />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-secondary text-xs py-1 px-3">取消</button>
        <button onClick={onSave} className="btn-primary text-xs py-1 px-3">保存</button>
      </div>
    </div>
  )
}

function ModelForm({ form, setForm, onSave, onCancel, isNew, toggleModality }) {
  const mods = ['text', 'image']
  return (
    <div className="p-3 mb-2 rounded-lg space-y-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
      <div className="grid grid-cols-2 gap-2">
        {isNew && (
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>模型 ID</label>
            <input value={form.id} onChange={e => setForm(p => ({ ...p, id: e.target.value }))} className="input-field text-xs" placeholder="如 gpt-4.1, mimo-v2.5" />
          </div>
        )}
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>名称</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="input-field text-xs" placeholder="GPT-4.1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>上下文长度</label>
          <input type="number" value={form.contextLimit} onChange={e => setForm(p => ({ ...p, contextLimit: parseInt(e.target.value) || 0 }))} className="input-field text-xs" placeholder="200000" />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>输出长度</label>
          <input type="number" value={form.outputLimit} onChange={e => setForm(p => ({ ...p, outputLimit: parseInt(e.target.value) || 0 }))} className="input-field text-xs" placeholder="4096" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>输入模态</label>
          <div className="flex gap-1">
            {mods.map(mod => (
              <button key={mod} onClick={() => toggleModality('inputModalities', mod)}
                className="text-xs py-0.5 px-2 rounded-lg"
                style={{
                  background: (form.inputModalities || []).includes(mod) ? 'var(--accent-primary-soft)' : 'var(--bg-hover)',
                  color: (form.inputModalities || []).includes(mod) ? 'var(--accent-primary)' : 'var(--text-muted)',
                  border: '1px solid ' + ((form.inputModalities || []).includes(mod) ? 'var(--accent-primary)' : 'var(--border-subtle)')
                }}>
                {mod === 'text' ? '文本' : '图像'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>输出模态</label>
          <div className="flex gap-1">
            {mods.map(mod => (
              <button key={mod} onClick={() => toggleModality('outputModalities', mod)}
                className="text-xs py-0.5 px-2 rounded-lg"
                style={{
                  background: (form.outputModalities || []).includes(mod) ? 'var(--accent-primary-soft)' : 'var(--bg-hover)',
                  color: (form.outputModalities || []).includes(mod) ? 'var(--accent-primary)' : 'var(--text-muted)',
                  border: '1px solid ' + ((form.outputModalities || []).includes(mod) ? 'var(--accent-primary)' : 'var(--border-subtle)')
                }}>
                {mod === 'text' ? '文本' : '图像'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-secondary text-xs py-1 px-3">取消</button>
        <button onClick={onSave} className="btn-primary text-xs py-1 px-3">保存</button>
      </div>
    </div>
  )
}

function ToolSyncSection({ providers, models, syncStatus, syncing, onSync }) {
  const toast = useToast()
  const [claudeProvider, setClaudeProvider] = useState('')
  const [claudeModelConfig, setClaudeModelConfig] = useState({ model: '', sonnetModel: '', opusModel: '', haikuModel: '' })
  const [opencodeProviders, setOpencodeProviders] = useState([])
  const [opencodeDefaultModel, setOpencodeDefaultModel] = useState('')
  const [codexProvider, setCodexProvider] = useState('')
  const [codexModel, setCodexModel] = useState('')
  const [backups, setBackups] = useState({})
  const [undoing, setUndoing] = useState({})
  const [expandedBackup, setExpandedBackup] = useState({})
  const [backupContents, setBackupContents] = useState({})

  const fetchBackups = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/models/sync/backups`)
      const data = await res.json()
      setBackups(data.backups || {})
    } catch {}
  }, [])

  useEffect(() => { fetchBackups() }, [fetchBackups])

  useEffect(() => {
    if (syncStatus['claude-code']) {
      setClaudeProvider(syncStatus['claude-code'].providerId || '')
      try {
        const cfg = syncStatus['claude-code'].config || {}
        setClaudeModelConfig({ model: cfg.model || '', sonnetModel: cfg.sonnetModel || '', opusModel: cfg.opusModel || '', haikuModel: cfg.haikuModel || '' })
      } catch {}
    }
    if (syncStatus['opencode']) {
      try {
        const cfg = syncStatus['opencode'].config || {}
        setOpencodeProviders(cfg.providerIds || [])
        setOpencodeDefaultModel(cfg.defaultModel || '')
      } catch {}
    }
    if (syncStatus['codex']) {
      setCodexProvider(syncStatus['codex'].providerId || '')
      setCodexModel(syncStatus['codex'].modelId || '')
    }
  }, [syncStatus])

  const toggleOpencodeProvider = (pid) => {
    setOpencodeProviders(prev => prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid])
  }

  const syncClaude = () => {
    if (!claudeProvider) return
    onSync('claude-code', { providerId: claudeProvider, modelConfig: claudeModelConfig }).then(() => fetchBackups())
  }

  const syncOpencode = () => {
    if (opencodeProviders.length === 0) return
    onSync('opencode', { providerIds: opencodeProviders, defaultModel: opencodeDefaultModel }).then(() => fetchBackups())
  }

  const syncCodex = () => {
    if (!codexProvider || !codexModel) return
    onSync('codex', { providerId: codexProvider, modelId: codexModel }).then(() => fetchBackups())
  }

  const handleUndo = async (tool) => {
    if (!window.confirm(`确定撤销 ${tool} 的同步？将恢复同步前的配置文件。`)) return
    setUndoing(prev => ({ ...prev, [tool]: true }))
    try {
      const res = await fetch(`${API_BASE}/models/sync/undo/${tool}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '撤销失败'); return }
      toast.success(data.message || '撤销成功')
      setExpandedBackup(prev => ({ ...prev, [tool]: false }))
      setBackupContents(prev => ({ ...prev, [tool]: null }))
      fetchBackups()
      await fetch(`${API_BASE}/models/refresh-cache`, { method: 'POST' }).catch(() => {})
      window.dispatchEvent(new CustomEvent('models-changed'))
    } catch (e) {
      toast.error('撤销失败: ' + e.message)
    } finally {
      setUndoing(prev => ({ ...prev, [tool]: false }))
    }
  }

  const toggleBackupDetail = async (tool) => {
    if (expandedBackup[tool]) {
      setExpandedBackup(prev => ({ ...prev, [tool]: false }))
      return
    }
    try {
      const res = await fetch(`${API_BASE}/models/sync/backups/${tool}`)
      const data = await res.json()
      setBackupContents(prev => ({ ...prev, [tool]: data.backup }))
      setExpandedBackup(prev => ({ ...prev, [tool]: true }))
    } catch {
      toast.error('获取备份详情失败')
    }
  }

  const renderBackupInfo = (tool) => {
    const toolBackups = backups[tool]
    if (!toolBackups || Object.keys(toolBackups).length === 0) return null
    const backupEntries = Object.entries(toolBackups)
    return (
      <div className="mt-2 p-2 rounded-lg" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium" style={{ color: 'var(--warning)' }}>已有备份</span>
          <div className="flex gap-1">
            <button onClick={() => toggleBackupDetail(tool)} className="text-xs py-0.5 px-2 rounded"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              {expandedBackup[tool] ? '收起' : '查看备份'}
            </button>
            <button onClick={() => handleUndo(tool)} disabled={undoing[tool]}
              className="text-xs py-0.5 px-2 rounded font-medium"
              style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>
              {undoing[tool] ? '恢复中...' : '撤销同步'}
            </button>
          </div>
        </div>
        {backupEntries.map(([filePath, info]) => (
          <div key={filePath} className="text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="truncate block" title={filePath}>{filePath.split('/').pop()}</span>
            <span>备份于 {new Date(info.backedUpAt).toLocaleString()}</span>
            {!info.hasContent && <span className="ml-1">(原文件不存在)</span>}
          </div>
        ))}
        {expandedBackup[tool] && backupContents[tool] && (
          <div className="mt-2 p-2 rounded" style={{ background: 'var(--bg-tertiary)', maxHeight: '200px', overflow: 'auto' }}>
            <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>备份内容：</div>
            {Object.entries(backupContents[tool]).map(([filePath, info]) => (
              <div key={filePath}>
                <div className="text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>{filePath}</div>
                <pre className="text-xs p-1.5 rounded overflow-x-auto" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {info.content || '(空)'}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const claudeModels = models[claudeProvider] || []
  const codexModels = models[codexProvider] || []
  const claudeProviderData = providers.find(p => p.id === claudeProvider)
  const claudeProviderHasAnthropicUrl = !!claudeProviderData?.baseUrlAnthropic

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>工具同步</h3>

      <div className="card mb-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Claude Code</span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>单 Provider</span>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Provider</label>
            <select value={claudeProvider} onChange={e => setClaudeProvider(e.target.value)} className="select-field text-xs w-full">
              <option value="">选择 Provider</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
          </div>
          {claudeProvider && claudeModels.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>默认模型</label>
                <select value={claudeModelConfig.model} onChange={e => setClaudeModelConfig(c => ({ ...c, model: e.target.value }))} className="select-field text-xs w-full">
                  <option value="">不设置</option>
                  {claudeModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Sonnet 模型</label>
                <select value={claudeModelConfig.sonnetModel} onChange={e => setClaudeModelConfig(c => ({ ...c, sonnetModel: e.target.value }))} className="select-field text-xs w-full">
                  <option value="">不设置</option>
                  {claudeModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Opus 模型</label>
                <select value={claudeModelConfig.opusModel} onChange={e => setClaudeModelConfig(c => ({ ...c, opusModel: e.target.value }))} className="select-field text-xs w-full">
                  <option value="">不设置</option>
                  {claudeModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Haiku 模型</label>
                <select value={claudeModelConfig.haikuModel} onChange={e => setClaudeModelConfig(c => ({ ...c, haikuModel: e.target.value }))} className="select-field text-xs w-full">
                  <option value="">不设置</option>
                  {claudeModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {claudeProvider && !claudeProviderHasAnthropicUrl && (
            <div className="text-xs py-1.5 px-3 rounded-lg" style={{ color: 'var(--warning)', background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
              该 Provider 未设置 Base URL (Anthropic 协议)，无法同步到 Claude Code
            </div>
          )}
          <button onClick={syncClaude} disabled={!claudeProvider || !claudeProviderHasAnthropicUrl || syncing['claude-code']} className="btn-primary text-xs py-1.5 px-4 w-full">
            {syncing['claude-code'] ? '同步中...' : '同步到 Claude Code'}
          </button>
          {renderBackupInfo('claude-code')}
        </div>
      </div>

      <div className="card mb-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>OpenCode</span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>多 Provider</span>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>启用的 Provider</label>
            <div className="flex flex-wrap gap-1">
              {providers.map(p => (
                <button key={p.id} onClick={() => toggleOpencodeProvider(p.id)} className="text-xs py-0.5 px-2 rounded-lg"
                  style={{
                    background: opencodeProviders.includes(p.id) ? 'var(--accent-primary-soft)' : 'var(--bg-hover)',
                    color: opencodeProviders.includes(p.id) ? 'var(--accent-primary)' : 'var(--text-muted)',
                    border: '1px solid ' + (opencodeProviders.includes(p.id) ? 'var(--accent-primary)' : 'var(--border-subtle)')
                  }}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          {opencodeProviders.length > 0 && (
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>默认模型</label>
              <select value={opencodeDefaultModel} onChange={e => setOpencodeDefaultModel(e.target.value)} className="select-field text-xs w-full">
                <option value="">不设置</option>
                {opencodeProviders.flatMap(pid => {
                  const prov = providers.find(pr => pr.id === pid)
                  return (models[pid] || []).map(m => ({
                    id: `${pid}/${m.id}`, name: `${prov?.name || pid}/${m.name}`, pid, mid: m.id
                  }))
                }).map(item => {
                  const p = providers.find(pr => pr.id === item.pid)
                  return <option key={item.id} value={item.id}>{p?.name || item.pid}/{item.name}</option>
                })}
              </select>
            </div>
          )}
          <button onClick={syncOpencode} disabled={opencodeProviders.length === 0 || syncing['opencode']} className="btn-primary text-xs py-1.5 px-4 w-full">
            {syncing['opencode'] ? '同步中...' : '同步到 OpenCode'}
          </button>
          {renderBackupInfo('opencode')}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Codex</span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>单 Provider</span>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Provider</label>
            <select value={codexProvider} onChange={e => { setCodexProvider(e.target.value); setCodexModel('') }} className="select-field text-xs w-full">
              <option value="">选择 Provider</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
          </div>
          {codexProvider && (
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>默认模型</label>
              <select value={codexModel} onChange={e => setCodexModel(e.target.value)} className="select-field text-xs w-full">
                <option value="">选择模型</option>
                {codexModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={syncCodex} disabled={!codexProvider || !codexModel || syncing['codex']} className="btn-primary text-xs py-1.5 px-4 w-full">
            {syncing['codex'] ? '同步中...' : '同步到 Codex'}
          </button>
          {renderBackupInfo('codex')}
        </div>
      </div>
    </div>
  )
}
