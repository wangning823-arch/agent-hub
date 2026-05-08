import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

interface ModelProvider {
  id: string
  name: string
  modelCount: number
  isPersonal: boolean
}

interface ModelData {
  id: string
  name: string
  contextLimit?: number
  outputLimit?: number
}

interface DiscoveredModel {
  id: string
  name: string
  contextLimit?: number
  outputLimit?: number
  free?: boolean
}

interface PersonalProviderForm {
  id: string
  name: string
  baseUrl: string
  baseUrlAnthropic: string
  apiKey: string
}

interface ProjectData {
  id: string
  name: string
  workdir: string
}

interface FlatModel {
  id: string
  name: string
  providerName: string
}

export default function UserModelView() {
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [personalModels, setPersonalModels] = useState<Record<string, ModelData[]>>({})
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [providerForm, setProviderForm] = useState<PersonalProviderForm>({ id: '', name: '', baseUrl: '', baseUrlAnthropic: '', apiKey: '' })
  const [addingModelTo, setAddingModelTo] = useState<string | null>(null)
  const [modelForm, setModelForm] = useState({ id: '', name: '', contextLimit: 0, outputLimit: 0 })

  // 自动发现相关状态
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [discoverForProvider, setDiscoverForProvider] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // 应用到项目
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [applyProjectId, setApplyProjectId] = useState('')
  const [applyProviderId, setApplyProviderId] = useState('')
  const [modelConfig, setModelConfig] = useState({ model: '', sonnetModel: '', opusModel: '', haikuModel: '' })
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState('')

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    try {
      const [modelsRes, projRes] = await Promise.all([
        fetch(`${API_BASE}/options/my-models`),
        fetch(`${API_BASE}/projects`)
      ])
      const data = await modelsRes.json()
      setProviders(data.providers || [])

      const projData = await projRes.json()
      setProjects(Array.isArray(projData) ? projData : (projData.projects || []))

      // 加载所有 provider 的模型（系统 + 个人）
      for (const p of (data.providers || [])) {
        await fetchProviderModels(p.id, p.isPersonal)
      }
    } catch (error) {
      console.error('加载模型失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchProviderModels = async (providerId: string, _isPersonal: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/my-models/providers/${providerId}/models`)
      const data = await res.json()
      setPersonalModels(prev => ({ ...prev, [providerId]: data.models || [] }))
    } catch (error) {
      console.error('加载模型失败:', error)
    }
  }

  // 选中 Provider 后的可用模型列表
  const providerModels: FlatModel[] = applyProviderId
    ? (personalModels[applyProviderId] || []).map(m => ({ id: m.id, name: m.name, providerName: '' }))
    : []

  // 切换 Provider 时确保模型已加载
  useEffect(() => {
    if (applyProviderId && (!personalModels[applyProviderId] || personalModels[applyProviderId].length === 0)) {
      const p = providers.find(p => p.id === applyProviderId)
      if (p) fetchProviderModels(applyProviderId, p.isPersonal)
    }
  }, [applyProviderId])

  const addProvider = async () => {
    if (!providerForm.id || !providerForm.name || !providerForm.baseUrl) return
    try {
      const res = await fetch(`${API_BASE}/my-models/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerForm),
      })
      if (res.ok) {
        setShowAddProvider(false)
        setProviderForm({ id: '', name: '', baseUrl: '', baseUrlAnthropic: '', apiKey: '' })
        fetchData()
      }
    } catch (error) {
      console.error('添加 Provider 失败:', error)
    }
  }

  const deleteProvider = async (providerId: string) => {
    if (!confirm('确定删除此 Provider 及其所有模型？')) return
    try {
      const res = await fetch(`${API_BASE}/my-models/providers/${providerId}`, { method: 'DELETE' })
      if (res.ok) fetchData()
    } catch (error) {
      console.error('删除 Provider 失败:', error)
    }
  }

  const addModel = async (providerId: string) => {
    if (!modelForm.id || !modelForm.name) return
    try {
      const res = await fetch(`${API_BASE}/my-models/providers/${providerId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelForm),
      })
      if (res.ok) {
        setAddingModelTo(null)
        setModelForm({ id: '', name: '', contextLimit: 0, outputLimit: 0 })
        fetchProviderModels(providerId, true)
      }
    } catch (error) {
      console.error('添加模型失败:', error)
    }
  }

  const deleteModel = async (providerId: string, modelId: string) => {
    try {
      const res = await fetch(`${API_BASE}/my-models/providers/${providerId}/models/${modelId}`, { method: 'DELETE' })
      if (res.ok) fetchProviderModels(providerId, true)
    } catch (error) {
      console.error('删除模型失败:', error)
    }
  }

  const handleApplyModel = async () => {
    if (!applyProjectId) return
    const { model, sonnetModel, opusModel, haikuModel } = modelConfig
    if (!model && !sonnetModel && !opusModel && !haikuModel) {
      setApplyMsg('请至少选择一个模型')
      return
    }
    setApplying(true)
    setApplyMsg('')
    try {
      const res = await fetch(`${API_BASE}/projects/${applyProjectId}/apply-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...modelConfig, providerId: applyProviderId })
      })
      let data: any
      try { data = await res.json() } catch { setApplyMsg('服务器返回异常'); return }
      if (!res.ok) { setApplyMsg(data.error || '应用失败'); return }
      setApplyMsg(data.message || '应用成功')
      setShowApplyModal(false)
      setApplyProjectId('')
      setApplyProviderId('')
      setModelConfig({ model: '', sonnetModel: '', opusModel: '', haikuModel: '' })
      setTimeout(() => setApplyMsg(''), 3000)
    } catch (error: any) {
      setApplyMsg(error?.message || '网络请求失败')
    } finally {
      setApplying(false)
    }
  }

  // ── 自动发现 ──

  const startDiscover = (providerId: string | null) => {
    setDiscoverForProvider(providerId)
    setDiscoveredModels([])
    setSelectedModels(new Set())
    setDiscoverError(null)
  }

  const cancelDiscover = () => {
    setDiscoverForProvider(null)
    setDiscoveredModels([])
    setSelectedModels(new Set())
    setDiscoverError(null)
  }

  const doDiscover = async () => {
    setDiscovering(true)
    setDiscoverError(null)
    try {
      let res: Response
      if (discoverForProvider !== null) {
        res = await fetch(`${API_BASE}/my-models/providers/${discoverForProvider}/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        if (!providerForm.baseUrl) {
          setDiscoverError('请先填写 Base URL')
          setDiscovering(false)
          return
        }
        res = await fetch(`${API_BASE}/my-models/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: providerForm.baseUrl, apiKey: providerForm.apiKey }),
        })
      }
      let data: any
      try {
        data = await res.json()
      } catch {
        setDiscoverError(`服务器返回异常 (HTTP ${res.status})`)
        return
      }
      if (!res.ok) {
        setDiscoverError(data.error || '发现模型失败')
        return
      }
      setDiscoveredModels(data.models || [])
      setSelectedModels(new Set((data.models || []).map((m: DiscoveredModel) => m.id)))
    } catch (error: any) {
      console.error('模型发现请求失败:', error)
      setDiscoverError(error?.message || '网络请求失败')
    } finally {
      setDiscovering(false)
    }
  }

  const toggleDiscoveredModel = (modelId: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (next.has(modelId)) next.delete(modelId)
      else next.add(modelId)
      return next
    })
  }

  const importSelectedModels = async () => {
    if (discoverForProvider === null) return
    setImporting(true)
    try {
      const modelsToImport = discoveredModels
        .filter(m => selectedModels.has(m.id))
        .map(m => ({ id: m.id, name: m.name, contextLimit: m.contextLimit || 0, outputLimit: m.outputLimit || 0 }))

      const res = await fetch(`${API_BASE}/my-models/providers/${discoverForProvider}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: modelsToImport }),
      })
      const data = await res.json()
      if (res.ok) {
        cancelDiscover()
        fetchProviderModels(discoverForProvider, true)
        fetchData()
      }
    } catch (error) {
      console.error('导入模型失败:', error)
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
  }

  const systemProviders = providers.filter(p => !p.isPersonal)
  const personalProviders = providers.filter(p => p.isPersonal)

  const renderModelSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="select-field text-xs w-full">
        <option value="">不设置</option>
        {providerModels.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-6">
      {applyMsg && (
        <div className="text-sm p-2 rounded" style={{
          background: applyMsg.includes('失败') || applyMsg.includes('异常') ? 'var(--error-soft)' : 'var(--success-soft)',
          color: applyMsg.includes('失败') || applyMsg.includes('异常') ? 'var(--error)' : 'var(--success)',
        }}>
          {applyMsg}
        </div>
      )}

      {/* 应用模型到项目 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Claude Code 模型配置</h3>
        <button
          onClick={() => { setShowApplyModal(true); setApplyMsg(''); setApplyProviderId(''); setModelConfig({ model: '', sonnetModel: '', opusModel: '', haikuModel: '' }) }}
          className="text-sm px-3 py-1.5 rounded"
          style={{ background: 'var(--success)', color: 'white', border: 'none', cursor: 'pointer' }}
        >
          应用到项目
        </button>
      </div>

      {/* 应用到项目弹窗 */}
      {showApplyModal && (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>将模型应用到项目（Claude Code）</h4>
            <button
              onClick={() => setShowApplyModal(false)}
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer' }}
            >
              关闭
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>目标项目</label>
              <select
                value={applyProjectId}
                onChange={e => setApplyProjectId(e.target.value)}
                className="select-field text-xs w-full"
              >
                <option value="">选择项目...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Provider</label>
              <select
                value={applyProviderId}
                onChange={e => {
                  setApplyProviderId(e.target.value)
                  setModelConfig({ model: '', sonnetModel: '', opusModel: '', haikuModel: '' })
                }}
                className="select-field text-xs w-full"
              >
                <option value="">选择 Provider...</option>
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                ))}
              </select>
            </div>
            {applyProviderId && providerModels.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {renderModelSelect('默认模型 (ANTHROPIC_MODEL)', modelConfig.model, v => setModelConfig(c => ({ ...c, model: v })))}
                {renderModelSelect('Sonnet 模型', modelConfig.sonnetModel, v => setModelConfig(c => ({ ...c, sonnetModel: v })))}
                {renderModelSelect('Opus 模型', modelConfig.opusModel, v => setModelConfig(c => ({ ...c, opusModel: v })))}
                {renderModelSelect('Haiku 模型', modelConfig.haikuModel, v => setModelConfig(c => ({ ...c, haikuModel: v })))}
              </div>
            ) : applyProviderId ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>该 Provider 暂无模型</p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>请先选择 Provider</p>
            )}
            <button
              onClick={handleApplyModel}
              disabled={!applyProjectId || !applyProviderId || applying}
              className="btn-primary w-full py-2 text-sm"
              style={{
                cursor: (!applyProjectId || !applyProviderId || applying) ? 'not-allowed' : 'pointer',
                opacity: (!applyProjectId || !applyProviderId || applying) ? 0.5 : 1,
              }}
            >
              {applying ? '应用中...' : '应用到项目'}
            </button>
          </div>
        </div>
      )}

      {/* 系统 Provider（只读） */}
      {systemProviders.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>系统 Provider（管理员分配）</h3>
          <div className="space-y-2">
            {systemProviders.map(p => (
              <div key={p.id} className="card" style={{ borderColor: 'var(--accent-primary)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.modelCount} 个模型</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>系统</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 个人 Provider */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>个人 Provider</h3>
          <button
            onClick={() => { setShowAddProvider(!showAddProvider); cancelDiscover() }}
            className="text-sm px-3 py-1.5 rounded"
            style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            {showAddProvider ? '取消' : '+ 添加 Provider'}
          </button>
        </div>

        {/* 新建 Provider 表单 */}
        {showAddProvider && (
          <div className="card mb-3 space-y-3">
            <input type="text" placeholder="Provider ID (如 my-deepseek)" value={providerForm.id}
              onChange={e => setProviderForm(prev => ({ ...prev, id: e.target.value }))} className="input-field w-full" />
            <input type="text" placeholder="显示名称" value={providerForm.name}
              onChange={e => setProviderForm(prev => ({ ...prev, name: e.target.value }))} className="input-field w-full" />
            <input type="text" placeholder="Base URL (OpenAI 兼容)" value={providerForm.baseUrl}
              onChange={e => setProviderForm(prev => ({ ...prev, baseUrl: e.target.value }))} className="input-field w-full" />
            <input type="text" placeholder="Base URL (Anthropic 兼容，可选)" value={providerForm.baseUrlAnthropic}
              onChange={e => setProviderForm(prev => ({ ...prev, baseUrlAnthropic: e.target.value }))} className="input-field w-full" />
            <input type="password" placeholder="API Key" value={providerForm.apiKey}
              onChange={e => setProviderForm(prev => ({ ...prev, apiKey: e.target.value }))} className="input-field w-full" />

            <div className="flex gap-2">
              <button onClick={addProvider} className="btn-primary flex-1 py-2 text-sm">创建</button>
              <button
                onClick={() => startDiscover(null)}
                disabled={!providerForm.baseUrl || discovering}
                className="py-2 px-4 text-sm rounded"
                style={{
                  background: 'var(--success-soft)', color: 'var(--success)',
                  border: '1px solid var(--success)', cursor: (!providerForm.baseUrl || discovering) ? 'not-allowed' : 'pointer',
                  opacity: (!providerForm.baseUrl || discovering) ? 0.5 : 1,
                }}
              >
                {discovering ? '发现中...' : '🔍 发现模型'}
              </button>
            </div>
          </div>
        )}

        {/* 发现模型面板 */}
        {discoverForProvider !== null && (
          <DiscoverPanel
            providerName={providers.find(p => p.id === discoverForProvider)?.name || ''}
            discoveredModels={discoveredModels}
            selectedModels={selectedModels}
            discovering={discovering}
            discoverError={discoverError}
            importing={importing}
            onDiscover={doDiscover}
            onToggle={toggleDiscoveredModel}
            onImport={importSelectedModels}
            onCancel={cancelDiscover}
          />
        )}

        {/* 新建 Provider 时的发现面板 */}
        {discoverForProvider === null && discoveredModels.length > 0 && (
          <DiscoverPanel
            providerName={providerForm.name || '新 Provider'}
            discoveredModels={discoveredModels}
            selectedModels={selectedModels}
            discovering={discovering}
            discoverError={discoverError}
            importing={false}
            onDiscover={doDiscover}
            onToggle={toggleDiscoveredModel}
            onImport={() => {}}
            onCancel={cancelDiscover}
            note="请先创建 Provider，然后在 Provider 中导入模型"
          />
        )}

        {discoverForProvider === null && discoverError && !discoveredModels.length && (
          <div className="card mb-3" style={{ background: 'var(--error-soft)', borderColor: 'var(--error)' }}>
            <p className="text-sm" style={{ color: 'var(--error)' }}>{discoverError}</p>
          </div>
        )}

        {/* Provider 列表 */}
        {personalProviders.length === 0 && !showAddProvider ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无个人 Provider，点击上方按钮添加。</p>
        ) : (
          <div className="space-y-2">
            {personalProviders.map(p => (
              <div key={p.id} className="card">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedProvider(expandedProvider === p.id ? null : p.id)}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {personalModels[p.id]?.length || p.modelCount} 个模型
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>个人</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); startDiscover(p.id) }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: 'var(--success)', background: 'var(--success-soft)', border: 'none', cursor: 'pointer' }}
                    >
                      🔍 发现
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteProvider(p.id) }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: 'var(--error)', background: 'var(--error-soft)', border: 'none', cursor: 'pointer' }}
                    >
                      删除
                    </button>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ transform: expandedProvider === p.id ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {expandedProvider === p.id && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {(personalModels[p.id] || []).map(m => (
                      <div key={m.id} className="flex items-center justify-between py-1.5">
                        <div>
                          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                          <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{m.id}</span>
                          {m.contextLimit ? <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>上下文: {(m.contextLimit / 1000).toFixed(0)}k</span> : null}
                        </div>
                        <button onClick={() => deleteModel(p.id, m.id)}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ color: 'var(--error)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                          删除
                        </button>
                      </div>
                    ))}

                    {addingModelTo === p.id ? (
                      <div className="mt-2 space-y-2">
                        <input type="text" placeholder="模型 ID" value={modelForm.id}
                          onChange={e => setModelForm(prev => ({ ...prev, id: e.target.value }))} className="input-field w-full" />
                        <input type="text" placeholder="模型名称" value={modelForm.name}
                          onChange={e => setModelForm(prev => ({ ...prev, name: e.target.value }))} className="input-field w-full" />
                        <div className="flex gap-2">
                          <input type="number" placeholder="上下文限制" value={modelForm.contextLimit || ''}
                            onChange={e => setModelForm(prev => ({ ...prev, contextLimit: parseInt(e.target.value) || 0 }))}
                            className="input-field flex-1" />
                          <input type="number" placeholder="输出限制" value={modelForm.outputLimit || ''}
                            onChange={e => setModelForm(prev => ({ ...prev, outputLimit: parseInt(e.target.value) || 0 }))}
                            className="input-field flex-1" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => addModel(p.id)} className="btn-primary px-4 py-1.5 text-sm">添加</button>
                          <button onClick={() => setAddingModelTo(null)} className="btn-secondary px-4 py-1.5 text-sm">取消</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setAddingModelTo(p.id); setModelForm({ id: '', name: '', contextLimit: 0, outputLimit: 0 }) }}
                        className="mt-2 text-xs px-3 py-1.5 rounded"
                        style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)', border: 'none', cursor: 'pointer' }}>
                        + 手动添加模型
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 发现模型面板组件 ──

function DiscoverPanel({
  providerName, discoveredModels, selectedModels, discovering, discoverError,
  importing, onDiscover, onToggle, onImport, onCancel, note
}: {
  providerName: string
  discoveredModels: DiscoveredModel[]
  selectedModels: Set<string>
  discovering: boolean
  discoverError: string | null
  importing: boolean
  onDiscover: () => void
  onToggle: (id: string) => void
  onImport: () => void
  onCancel: () => void
  note?: string
}) {
  return (
    <div className="card mb-3" style={{ borderColor: 'var(--success)' }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          发现模型 — {providerName}
        </h4>
        <button onClick={onCancel} className="text-xs px-2 py-1 rounded"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: 'none', cursor: 'pointer' }}>
          关闭
        </button>
      </div>

      {discoveredModels.length === 0 && !discovering && (
        <div className="text-center py-4">
          <button onClick={onDiscover} disabled={discovering}
            className="px-4 py-2 text-sm rounded"
            style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer' }}>
            {discovering ? '发现中...' : '🔍 开始发现模型'}
          </button>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>将调用 Provider 的 /v1/models 接口获取模型列表</p>
        </div>
      )}

      {discovering && (
        <div className="text-center py-4" style={{ color: 'var(--text-muted)' }}>
          <div className="inline-block w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
          <p className="text-sm mt-2">正在查询模型列表...</p>
        </div>
      )}

      {discoverError && (
        <div className="mb-3 p-2 rounded text-sm" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}>
          {discoverError}
        </div>
      )}

      {discoveredModels.length > 0 && (
        <>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            发现 {discoveredModels.length} 个模型，已选择 {selectedModels.size} 个
          </p>
          <div className="max-h-60 overflow-y-auto space-y-1 mb-3">
            {[...discoveredModels].sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0)).map(m => (
              <label key={m.id} className="flex items-center gap-2 p-2 rounded cursor-pointer"
                style={{ background: selectedModels.has(m.id) ? 'var(--accent-primary-soft)' : 'var(--bg-secondary)' }}>
                <input type="checkbox" checked={selectedModels.has(m.id)}
                  onChange={() => onToggle(m.id)}
                  style={{ accentColor: 'var(--accent-primary)' }} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm" style={{ color: m.free ? '#22c55e' : 'var(--text-primary)' }}>{m.name}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{m.id}</span>
                </div>
                {m.free && (
                  <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>免费</span>
                )}
                <div className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {m.contextLimit ? `${(m.contextLimit / 1000).toFixed(0)}k` : ''}
                  {m.outputLimit ? ` / ${(m.outputLimit / 1000).toFixed(0)}k out` : ''}
                </div>
              </label>
            ))}
          </div>

          {note ? (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>{note}</p>
          ) : (
            <button onClick={onImport} disabled={importing || selectedModels.size === 0}
              className="w-full py-2 text-sm rounded"
              style={{
                background: 'var(--accent-primary)', color: 'white', border: 'none',
                cursor: (importing || selectedModels.size === 0) ? 'not-allowed' : 'pointer',
                opacity: (importing || selectedModels.size === 0) ? 0.5 : 1,
              }}>
              {importing ? '导入中...' : `导入选中的 ${selectedModels.size} 个模型`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
