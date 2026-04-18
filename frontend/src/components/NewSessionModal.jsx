import React, { useState } from 'react'

export default function NewSessionModal({ agents, onCreate, onClose, currentWorkdir }) {
  const [mode, setMode] = useState('local')
  const [workdir, setWorkdir] = useState(currentWorkdir || '~')
  const [gitUrl, setGitUrl] = useState('')
  const [agentType, setAgentType] = useState('claude-code')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (mode === 'local') {
      if (workdir.trim()) onCreate(workdir.trim(), agentType)
      return
    }
    if (!gitUrl.trim()) { setError('请输入 GitHub 仓库地址'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/projects/import-git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitUrl: gitUrl.trim(), agentType })
      })
      const result = await res.json()
      if (!res.ok) { setError(result.error || '导入失败'); setLoading(false); return }
      onCreate(result.project.workdir, agentType)
    } catch (err) { setError('导入失败: ' + err.message) }
    setLoading(false)
  }

  const quickDirs = [
    { label: 'Home', path: '~' },
    { label: 'Downloads', path: '~/storage/downloads' },
    { label: 'Documents', path: '~/storage/shared' }
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>创建新会话</h2>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Mode toggle */}
          <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: 'var(--bg-primary)' }}>
            {[
              { key: 'local', icon: '📁', label: '本地目录' },
              { key: 'github', icon: '🔗', label: 'GitHub' },
            ].map(m => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`btn-segment flex-1 py-2.5 ${mode === m.key ? 'active' : ''}`}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {mode === 'local' ? (
              <div className="mb-5">
                <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>项目目录</label>
                <input
                  type="text"
                  value={workdir}
                  onChange={(e) => setWorkdir(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="input-field"
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  {quickDirs.map(dir => (
                    <button key={dir.path} type="button" onClick={() => setWorkdir(dir.path)} className="btn-pill text-xs">
                      {dir.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-5">
                <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>GitHub 仓库地址</label>
                <input
                  type="text"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  className="input-field"
                  autoFocus
                />
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  支持 HTTPS/SSH 格式。本地已有则直接导入，没有则自动 clone。
                </p>
              </div>
            )}

            {/* Agent type */}
            <div className="mb-5">
              <label className="block text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Agent 类型</label>
              <div className="grid grid-cols-2 gap-2">
                {agents.map(agent => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setAgentType(agent.id)}
                    className="p-3 rounded-xl text-left transition-all text-sm"
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

            {/* Error */}
            {error && (
              <div className="mb-4 px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--error-soft)', color: 'var(--error)', border: '1px solid var(--error)' }}>
                {error}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5">取消</button>
              <button
                type="submit"
                disabled={loading || (mode === 'local' ? !workdir.trim() : !gitUrl.trim())}
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
