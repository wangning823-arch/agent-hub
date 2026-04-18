import React, { useState } from 'react'

export default function NewSessionModal({ agents, onCreate, onClose, currentWorkdir }) {
  const [mode, setMode] = useState('local') // 'local' | 'github'
  const [workdir, setWorkdir] = useState(currentWorkdir || '~')
  const [gitUrl, setGitUrl] = useState('')
  const [agentType, setAgentType] = useState('claude-code')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (mode === 'local') {
      if (workdir.trim()) {
        onCreate(workdir.trim(), agentType)
      }
      return
    }

    // GitHub 导入模式
    if (!gitUrl.trim()) {
      setError('请输入 GitHub 仓库地址')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/projects/import-git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitUrl: gitUrl.trim(), agentType })
      })
      const result = await res.json()

      if (!res.ok) {
        setError(result.error || '导入失败')
        setLoading(false)
        return
      }

      // 用 clone 后的 workdir 创建会话
      onCreate(result.project.workdir, agentType)
    } catch (err) {
      setError('导入失败: ' + err.message)
    }
    setLoading(false)
  }

  // 常用目录快捷方式
  const quickDirs = [
    { label: 'Home', path: '~' },
    { label: 'Downloads', path: '~/storage/downloads' },
    { label: 'Documents', path: '~/storage/shared' }
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-full max-w-md mx-4 border border-border">
        <h2 className="text-xl font-semibold mb-4">创建新会话</h2>

        {/* 模式切换 */}
        <div className="flex gap-1 mb-4 bg-background rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode('local')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'local' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            📁 本地目录
          </button>
          <button
            type="button"
            onClick={() => setMode('github')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'github' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            🔗 GitHub
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'local' ? (
            /* 本地路径 */
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">项目目录</label>
              <input
                type="text"
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                placeholder="/path/to/your/project"
                className="w-full bg-background border border-border rounded-lg px-4 py-2 focus:outline-none focus:border-accent"
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                {quickDirs.map(dir => (
                  <button
                    key={dir.path}
                    type="button"
                    onClick={() => setWorkdir(dir.path)}
                    className="text-xs px-2 py-1 bg-background rounded hover:bg-accent/20"
                  >
                    {dir.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* GitHub URL */
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">GitHub 仓库地址</label>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/user/repo"
                className="w-full bg-background border border-border rounded-lg px-4 py-2 focus:outline-none focus:border-accent"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-2">
                支持 HTTPS/SSH 格式。本地已有则直接导入，没有则自动 clone。
              </p>
            </div>
          )}

          {/* Agent 类型 */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Agent 类型</label>
            <div className="grid grid-cols-2 gap-2">
              {agents.map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setAgentType(agent.id)}
                  className={`px-4 py-3 rounded-lg border text-left ${
                    agent.id === agentType
                      ? 'border-accent bg-accent/20'
                      : 'border-border hover:border-accent/50'
                  }`}
                >
                  <div className="font-medium">{agent.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-background"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || (mode === 'local' ? !workdir.trim() : !gitUrl.trim())}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? '⏳ 导入中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
