import React, { useState } from 'react'

export default function NewSessionModal({ agents, onCreate, onClose, currentWorkdir }) {
  const [workdir, setWorkdir] = useState(currentWorkdir || '~')
  const [agentType, setAgentType] = useState('claude-code')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (workdir.trim()) {
      onCreate(workdir.trim(), agentType)
    }
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
        
        <form onSubmit={handleSubmit}>
          {/* 工作目录 */}
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

          {/* Agent类型 */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Agent类型</label>
            <div className="grid grid-cols-2 gap-2">
              {agents.map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setAgentType(agent.id)}
                  className={`
                    px-4 py-3 rounded-lg border text-left
                    ${agent.id === agentType 
                      ? 'border-accent bg-accent/20' 
                      : 'border-border hover:border-accent/50'}
                  `}
                >
                  <div className="font-medium">{agent.name}</div>
                </button>
              ))}
            </div>
          </div>

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
              disabled={!workdir.trim()}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}