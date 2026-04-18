import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function RightSidebar({ sessionId, workdir, onViewFile }) {
  const [expandedSection, setExpandedSection] = useState('files') // files | git
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState(workdir || '~')
  const [gitStatus, setGitStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [gitOutput, setGitOutput] = useState('')  // Git命令输出
  const [gitError, setGitError] = useState('')    // Git错误

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

  // 执行Git命令并显示结果
  const runGitCommand = async (command) => {
    if (!workdir) {
      setGitError('未设置工作目录')
      return
    }
    setGitOutput('执行中...')
    setGitError('')
    try {
      const res = await fetch(`${API_BASE}/git/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, command })
      })
      const data = await res.json()
      if (data.error && !data.output) {
        setGitError(data.error)
        setGitOutput('')
      } else {
        setGitOutput(data.output || '命令执行成功（无输出）')
        setGitError('')
      }
      loadGitStatus()
    } catch (error) {
      setGitError('请求失败: ' + error.message)
      setGitOutput('')
    }
  }

  // Git提交
  const runGitCommit = async () => {
    if (!workdir || !commitMessage.trim()) {
      setGitError('请输入提交信息')
      return
    }
    setGitOutput('提交中...')
    setGitError('')
    try {
      const res = await fetch(`${API_BASE}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, message: commitMessage.trim() })
      })
      const data = await res.json()
      if (data.error) {
        setGitError(data.error)
        setGitOutput('')
      } else {
        setGitOutput(data.output || '提交成功')
        setGitError('')
        setCommitMessage('')
      }
      loadGitStatus()
    } catch (error) {
      setGitError('提交失败: ' + error.message)
      setGitOutput('')
    }
  }

  // 安全Git Pull - 有本地修改时先确认
  const safePull = async () => {
    if (!workdir) {
      setGitError('未设置工作目录')
      return
    }
    // 检查是否有本地修改
    const hasChanges = (gitStatus?.modified?.length > 0) || (gitStatus?.staged?.length > 0)
    if (hasChanges) {
      const fileList = [
        ...(gitStatus.modified || []).map(f => `  修改: ${f}`),
        ...(gitStatus.staged || []).map(f => `  暂存: ${f}`)
      ].join('\n')
      const confirmed = confirm(
        `⚠️ 有本地未提交的修改，Pull 可能覆盖这些更改：\n\n${fileList}\n\n确定要继续 Pull 吗？建议先 commit 或 stash。`
      )
      if (!confirmed) return
    }
    runGitCommand('git pull')
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
                onClick={safePull}
                className="px-3 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 text-sm flex items-center justify-center gap-1"
              >
                📥 Pull
              </button>
              <button
                onClick={() => runGitCommand('git push')}
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
                <div className="text-xs text-gray-400 mb-2">📝 已修改 ({gitStatus.modified.length})</div>
                <div className="max-h-32 overflow-y-auto">
                  {gitStatus.modified.map((file, idx) => (
                    <div key={idx} className="px-2 py-1.5 text-sm text-yellow-400 flex items-center gap-2">
                      <span>●</span>
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 暂存的文件 */}
            {gitStatus?.staged?.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">✅ 已暂存 ({gitStatus.staged.length})</div>
                <div className="max-h-32 overflow-y-auto">
                  {gitStatus.staged.map((file, idx) => (
                    <div key={idx} className="px-2 py-1.5 text-sm text-green-400 flex items-center gap-2">
                      <span>●</span>
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* 未跟踪的文件 */}
            {gitStatus?.untracked?.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">❓ 未跟踪 ({gitStatus.untracked.length})</div>
                <div className="max-h-32 overflow-y-auto">
                  {gitStatus.untracked.map((file, idx) => (
                    <div key={idx} className="px-2 py-1.5 text-sm text-gray-500 flex items-center gap-2">
                      <span>●</span>
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
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
                onClick={runGitCommit}
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
                  onClick={() => runGitCommand('git log --oneline -10')}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git log
                </button>
                <button
                  onClick={() => runGitCommand('git diff')}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git diff
                </button>
                <button
                  onClick={() => runGitCommand('git fetch')}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git fetch
                </button>
                <button
                  onClick={() => runGitCommand('git stash')}
                  className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700 hover:text-white"
                >
                  git stash
                </button>
              </div>
            </div>

            {/* Git命令输出 */}
            {(gitOutput || gitError) && (
              <div className="border-t border-gray-800 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">输出</span>
                  <button
                    onClick={() => { setGitOutput(''); setGitError('') }}
                    className="text-xs text-gray-500 hover:text-white"
                  >
                    ✕ 清除
                  </button>
                </div>
                <pre className={`text-xs p-3 rounded overflow-auto max-h-40 whitespace-pre-wrap break-all ${
                  gitError ? 'bg-red-900/30 text-red-300' : 'bg-gray-800 text-gray-300'
                }`}>
                  {gitError || gitOutput}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
