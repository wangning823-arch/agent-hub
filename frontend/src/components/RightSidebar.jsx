import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function RightSidebar({ sessionId, workdir, onViewFile }) {
  const [expandedSection, setExpandedSection] = useState('files') // files | git
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState(workdir || '~')
  const [gitStatus, setGitStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')

  useEffect(() => {
    if (workdir) {
      setCurrentPath(workdir)
      loadFiles(workdir)
      loadGitStatus()
    }
  }, [workdir, sessionId])

  // 加载文件列表
  const loadFiles = async (dirPath) => {
    setLoading(true)
    try {
      const data = await fetch(`${API_BASE}/files?path=${encodeURIComponent(dirPath)}`).then(r => r.json())
      setFiles(data.files || [])
    } catch (error) {
      console.error('加载文件失败:', error)
    }
    setLoading(false)
  }

  // 加载Git状态
  const loadGitStatus = async () => {
    if (!workdir) return
    try {
      const data = await fetch(`${API_BASE}/git/status?path=${encodeURIComponent(workdir)}`).then(r => r.json())
      setGitStatus(data)
    } catch (error) {
      console.error('加载Git状态失败:', error)
      setGitStatus({ branch: 'main', modified: [], staged: [], untracked: [] })
    }
  }

  // 进入目录
  const enterDirectory = (dirPath) => {
    setCurrentPath(dirPath)
    loadFiles(dirPath)
  }

  // 返回上级目录
  const goUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/'
    enterDirectory(parentPath)
  }

  // 查看文件内容
  const viewFile = (filePath) => {
    if (onViewFile) {
      onViewFile(filePath)
    }
  }

  // 获取文件图标
  const getFileIcon = (name, isDirectory) => {
    if (isDirectory) return '📁'
    const ext = name.split('.').pop()?.toLowerCase()
    const icons = {
      js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
      json: '📋', md: '📝', txt: '📄',
      css: '🎨', scss: '🎨', html: '🌐',
      py: '🐍', rb: '💎', go: '🔵',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
      svg: '🎯', git: '📂'
    }
    return icons[ext] || '📄'
  }

  // 截断路径显示
  const truncatePath = (path, maxLen = 30) => {
    if (path.length <= maxLen) return path
    return '...' + path.slice(-(maxLen - 3))
  }

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* 文件管理器 */}
      <div className="border-b border-gray-800">
        <button
          onClick={() => setExpandedSection(expandedSection === 'files' ? '' : 'files')}
          className="w-full px-4 py-3 flex items-center justify-between text-gray-300 hover:bg-gray-800"
        >
          <span className="flex items-center gap-2">📂 文件管理</span>
          <span className="text-gray-500">{expandedSection === 'files' ? '▼' : '▶'}</span>
        </button>

        {expandedSection === 'files' && (
          <div className="max-h-[50vh] flex flex-col">
            {/* 路径栏 */}
            <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
              <button
                onClick={goUp}
                className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-sm"
                title="上级目录"
              >
                ⬆️
              </button>
              <span className="text-xs text-gray-400 truncate flex-1" title={currentPath}>
                {truncatePath(currentPath, 25)}
              </span>
              <button
                onClick={() => loadFiles(currentPath)}
                className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-sm"
                title="刷新"
              >
                🔄
              </button>
            </div>

            {/* 文件列表 */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-gray-500">加载中...</div>
              ) : files.length === 0 ? (
                <div className="p-4 text-center text-gray-500">空目录</div>
              ) : (
                files.map((file, idx) => (
                  <div
                    key={idx}
                    onClick={() => file.isDirectory ? enterDirectory(file.path) : viewFile(file.path)}
                    className="px-3 py-2 cursor-pointer flex items-center gap-2 hover:bg-gray-800"
                  >
                    <span>{getFileIcon(file.name, file.isDirectory)}</span>
                    <span className="text-sm text-gray-300 truncate flex-1">
                      {file.name}
                    </span>
                    {file.isDirectory && <span className="text-gray-500 text-xs">▶</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Git控制 */}
      <div className="flex-1 flex flex-col">
        <button
          onClick={() => setExpandedSection(expandedSection === 'git' ? '' : 'git')}
          className="w-full px-4 py-3 flex items-center justify-between text-gray-300 hover:bg-gray-800"
        >
          <span className="flex items-center gap-2">🔀 Git 控制</span>
          <span className="text-gray-500">{expandedSection === 'git' ? '▼' : '▶'}</span>
        </button>

        {expandedSection === 'git' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* 当前分支 */}
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">当前分支</span>
                <button
                  onClick={loadGitStatus}
                  className="text-xs text-gray-500 hover:text-white"
                >
                  🔄
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400">🌿</span>
                <span className="text-sm text-white font-medium">
                  {gitStatus?.branch || 'main'}
                </span>
              </div>
            </div>

            {/* Git操作按钮 */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  try {
                    await fetch(`${API_BASE}/git/command`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workdir, command: 'git pull' })
                    })
                    loadGitStatus()
                  } catch (error) {
                    alert('Pull失败: ' + error.message)
                  }
                }}
                className="px-3 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm flex items-center justify-center gap-1"
              >
                📥 Pull
              </button>
              <button
                onClick={async () => {
                  try {
                    await fetch(`${API_BASE}/git/command`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workdir, command: 'git push' })
                    })
                    loadGitStatus()
                  } catch (error) {
                    alert('Push失败: ' + error.message)
                  }
                }}
                className="px-3 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm flex items-center justify-center gap-1"
              >
                📤 Push
              </button>
              <button
                onClick={() => {/* TODO: 分支管理 */}}
                className="px-3 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm flex items-center justify-center gap-1"
              >
                🌿 分支
              </button>
              <button
                onClick={loadGitStatus}
                className="px-3 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm flex items-center justify-center gap-1"
              >
                📋 状态
              </button>
            </div>

            {/* 修改的文件 */}
            {gitStatus?.modified?.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">📝 已修改</div>
                {gitStatus.modified.map((file, idx) => (
                  <div key={idx} className="px-2 py-1.5 text-sm text-yellow-400 flex items-center gap-2">
                    <span>●</span>
                    <span className="truncate">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 暂存的文件 */}
            {gitStatus?.staged?.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">✅ 已暂存</div>
                {gitStatus.staged.map((file, idx) => (
                  <div key={idx} className="px-2 py-1.5 text-sm text-green-400 flex items-center gap-2">
                    <span>●</span>
                    <span className="truncate">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 未跟踪的文件 */}
            {gitStatus?.untracked?.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">❓ 未跟踪</div>
                {gitStatus.untracked.map((file, idx) => (
                  <div key={idx} className="px-2 py-1.5 text-sm text-gray-500 flex items-center gap-2">
                    <span>●</span>
                    <span className="truncate">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 提交区域 */}
            <div className="border-t border-gray-800 pt-3">
              <textarea
                placeholder="提交信息..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm resize-none focus:outline-none focus:border-blue-500"
                rows={2}
              />
              <button
                onClick={async () => {
                  if (!commitMessage.trim()) {
                    alert('请输入提交信息')
                    return
                  }
                  try {
                    await fetch(`${API_BASE}/git/commit`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workdir, message: commitMessage })
                    })
                    setCommitMessage('')
                    loadGitStatus()
                  } catch (error) {
                    alert('提交失败: ' + error.message)
                  }
                }}
                className="w-full mt-2 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
              >
                ✓ 提交更改
              </button>
            </div>

            {/* 快捷命令 */}
            <div className="border-t border-gray-800 pt-3">
              <div className="text-xs text-gray-400 mb-2">快捷命令</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={async () => {
                    try {
                      const data = await fetch(`${API_BASE}/git/command`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workdir, command: 'git log --oneline -10' })
                      }).then(r => r.json())
                      alert(data.output || '无日志')
                    } catch (error) {
                      alert('获取日志失败')
                    }
                  }}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git log
                </button>
                <button
                  onClick={async () => {
                    try {
                      const data = await fetch(`${API_BASE}/git/command`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workdir, command: 'git diff' })
                      }).then(r => r.json())
                      alert(data.output || '无差异')
                    } catch (error) {
                      alert('获取差异失败')
                    }
                  }}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git diff
                </button>
                <button
                  onClick={async () => {
                    try {
                      await fetch(`${API_BASE}/git/command`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workdir, command: 'git stash' })
                      })
                      loadGitStatus()
                    } catch (error) {
                      alert('Stash失败')
                    }
                  }}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git stash
                </button>
                <button
                  onClick={() => {
                    if (confirm('确定要重置所有更改吗？')) {
                      // TODO: git reset
                    }
                  }}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git reset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>{files.length} 个项目</span>
          <span>{currentPath.split('/').length} 层深度</span>
        </div>
      </div>
    </div>
  )
}
