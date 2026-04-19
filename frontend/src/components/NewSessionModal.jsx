import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function NewSessionModal({ agents, onCreate, onClose, currentWorkdir }) {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [customWorkdir, setCustomWorkdir] = useState('')
  const [useCustomDir, setUseCustomDir] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [mode, setMode] = useState('project') // 'project' | 'custom' | 'github'
  const [agentType, setAgentType] = useState('claude-code')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 加载已有项目
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await fetch(`${API_BASE}/projects`).then(r => r.json())
        const list = Array.isArray(data) ? data : (data.projects || [])
        setProjects(list)
        // 默认选中最近使用的项目
        if (list.length > 0) {
          setSelectedProject(list[0])
          generateTitle(list[0].name)
          if (list[0].agentType) setAgentType(list[0].agentType)
        }
      } catch (err) {
        console.error('加载项目失败:', err)
      }
    }
    loadProjects()
  }, [])

  // 自动生成会话名称
  const generateTitle = (projectName) => {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    setTitle(`${projectName} - ${time}`)
  }

  // 切换项目时更新标题和agent类型
  const handleSelectProject = (project) => {
    setSelectedProject(project)
    generateTitle(project.name)
    if (project.agentType) {
      setAgentType(project.agentType)
    }
  }

  // 切换模式时更新标题
  const handleModeChange = (newMode) => {
    setMode(newMode)
    if (newMode === 'project' && selectedProject) {
      generateTitle(selectedProject.name)
    } else if (newMode === 'custom') {
      setTitle('自定义项目')
    } else if (newMode === 'github') {
      setTitle('GitHub 导入')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (mode === 'project') {
      if (!selectedProject) { setError('请选择一个项目'); return }
      onCreate(selectedProject.workdir, agentType, { title })
      return
    }

    if (mode === 'custom') {
      if (!customWorkdir.trim()) { setError('请输入项目目录'); return }
      onCreate(customWorkdir.trim(), agentType, { title })
      return
    }

    // GitHub 导入
    if (!gitUrl.trim()) { setError('请输入 GitHub 仓库地址'); return }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/projects/import-git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitUrl: gitUrl.trim(), agentType })
      })
      const result = await res.json()
      if (!res.ok) { setError(result.error || '导入失败'); setLoading(false); return }
      onCreate(result.project.workdir, agentType, { title })
    } catch (err) { setError('导入失败: ' + err.message) }
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>创建新会话</h2>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-body">
          {/* 会话名称 */}
          <div className="mb-4">
            <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>会话名称</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="会话名称..."
              className="input-field"
              autoFocus
            />
          </div>

          {/* 项目来源 */}
          <div className="mb-4">
            <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>项目来源</label>
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
              {[
                { key: 'project', icon: '📋', label: '已有项目' },
                { key: 'custom', icon: '📁', label: '自定义' },
                { key: 'github', icon: '🔗', label: 'GitHub' },
              ].map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => handleModeChange(m.key)}
                  className={`btn-segment flex-1 py-2 text-xs ${mode === m.key ? 'active' : ''}`}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* 项目选择 / 自定义目录 / GitHub */}
            {mode === 'project' ? (
              <div className="mb-4">
                <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>选择项目</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {projects.length === 0 ? (
                    <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
                      暂无项目，请使用「自定义」或「GitHub」添加
                    </div>
                  ) : (
                    projects.map(project => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => handleSelectProject(project)}
                        className="w-full p-3 rounded-xl text-left transition-all text-sm flex items-center gap-3"
                        style={{
                          border: `2px solid ${selectedProject?.id === project.id ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
                          background: selectedProject?.id === project.id ? 'var(--accent-primary-soft)' : 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span className="text-lg">📂</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{project.name}</div>
                          <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{project.workdir}</div>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                          {project.agentType}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : mode === 'custom' ? (
              <div className="mb-4">
                <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>项目目录</label>
                <input
                  type="text"
                  value={customWorkdir}
                  onChange={(e) => setCustomWorkdir(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="input-field"
                />
                <div className="flex gap-2 mt-2">
                  {[
                    { label: 'Home', path: '~' },
                    { label: 'Downloads', path: '~/storage/downloads' },
                    { label: 'Documents', path: '~/storage/shared' }
                  ].map(dir => (
                    <button key={dir.path} type="button" onClick={() => setCustomWorkdir(dir.path)} className="btn-pill text-xs">
                      {dir.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>GitHub 仓库地址</label>
                <input
                  type="text"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  className="input-field"
                />
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  支持 HTTPS/SSH 格式。本地已有则直接导入，没有则自动 clone。
                </p>
              </div>
            )}

            {/* Agent 类型 */}
            <div className="mb-4">
              <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Agent 类型</label>
              <div className="grid grid-cols-2 gap-2">
                {agents.map(agent => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setAgentType(agent.id)}
                    className="p-2.5 rounded-xl text-left transition-all text-sm"
                    style={{
                      border: `2px solid ${agent.id === agentType ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
                      background: agent.id === agentType ? 'var(--accent-primary-soft)' : 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <div className="font-medium">{agent.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--error-soft)', color: 'var(--error)', border: '1px solid var(--error)' }}>
                {error}
              </div>
            )}

            {/* 按钮 */}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5">取消</button>
              <button
                type="submit"
                disabled={loading || (mode === 'project' ? !selectedProject : mode === 'custom' ? !customWorkdir.trim() : !gitUrl.trim())}
                className="btn-primary flex-1 py-2.5"
              >
                {loading ? '⏳ 导入中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
