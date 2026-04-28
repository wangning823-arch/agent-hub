import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

// ---- Type Definitions ----

interface Project {
  id: string
  name: string
  workdir: string
  gitHost?: string
  gitConfigured?: boolean
}

interface Agent {
  id: string
  name: string
}

interface NewSessionModalProps {
  agents: Agent[]
  onCreate: (workdir: string, agentType: string, options: { title: string }) => void
  onClose: () => void
  preselectedProject?: Project | null
}

export default function NewSessionModal({ agents, onCreate, onClose, preselectedProject }: NewSessionModalProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(preselectedProject || null)
  const [agentType, setAgentType] = useState('claude-code')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await fetch(`${API_BASE}/projects`).then(r => r.json())
        const list: Project[] = Array.isArray(data) ? data : (data.projects || [])
        setProjects(list)
        // 如果有预选项目，用预选的；否则选第一个
        if (preselectedProject) {
          const found = list.find(p => p.id === preselectedProject.id) || preselectedProject
          setSelectedProject(found)
          generateTitle(found.name)
        } else if (list.length > 0) {
          setSelectedProject(list[0])
          generateTitle(list[0].name)
        }
      } catch (err) {
        console.error('加载项目失败:', err)
      }
    }
    loadProjects()
  }, [])

  const generateTitle = (projectName: string) => {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    setTitle(`${projectName} - ${time}`)
  }

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project)
    generateTitle(project.name)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!selectedProject) { setError('请选择一个项目'); return }
    onCreate(selectedProject.workdir, agentType, { title })
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-content" style={{ maxWidth: 480 }} onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}>
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              placeholder="会话名称..."
              className="input-field"
              autoFocus
            />
          </div>

          <form onSubmit={handleSubmit}>
            {/* 项目选择 - 仅在未预选项目时显示 */}
            {!preselectedProject && (
              <div className="mb-4">
                <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>选择项目</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {projects.length === 0 ? (
                    <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
                      暂无项目，请先在项目管理中添加
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
                        {project.gitConfigured ? (
                          <span className="text-xs" style={{ color: 'var(--success)' }}>🔑</span>
                        ) : project.gitHost ? (
                          <span className="text-xs" style={{ color: 'var(--warning)' }}>⚠️</span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
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
                disabled={loading || !selectedProject}
                className="btn-primary flex-1 py-2.5"
              >
                {loading ? '⏳ 创建中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
