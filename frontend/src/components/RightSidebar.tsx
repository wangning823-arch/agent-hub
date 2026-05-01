import React, { useState, useEffect } from 'react'
import {
  IconFolder,
  IconGit,
  IconRefresh,
  IconChevron,
  IconClear,
  IconFile,
  IconUp
} from './Icons'

const API_BASE = '/api'

// ---- Type Definitions ----

interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number | null
}

interface GitStatus {
  branch?: string
  modified?: string[]
  staged?: string[]
  untracked?: string[]
}

interface RightSidebarProps {
  sessionId: string
  workdir?: string
  onViewFile?: (filePath: string) => void
}

interface SectionHeaderProps {
  icon: React.ReactNode
  label: string
  section: string
}

interface IconChevronProps {
  open: boolean
}

export default function RightSidebar({ sessionId, workdir, onViewFile }: RightSidebarProps) {
  const [expandedSection, setExpandedSection] = useState<string>('files')
  const [files, setFiles] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState(workdir || '~')
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [gitOutput, setGitOutput] = useState('')
  const [gitError, setGitError] = useState('')

  useEffect(() => {
    if (workdir) {
      setCurrentPath(workdir)
      loadFiles(workdir)
      loadGitStatus()
    }
  }, [workdir, sessionId])

  const loadFiles = async (dirPath: string) => {
    setLoading(true)
    try {
      const data = await fetch(`${API_BASE}/files?path=${encodeURIComponent(dirPath)}`).then(r => r.json())
      setFiles(data.files || [])
    } catch (error) { console.error('加载文件失败:', error) }
    setLoading(false)
  }

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

  const enterDirectory = (dirPath: string) => {
    if (workdir && !dirPath.startsWith(workdir)) return
    setCurrentPath(dirPath)
    loadFiles(dirPath)
  }
  const goUp = () => {
    if (!workdir) return
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/'
    if (parentPath.length < workdir.length) return
    enterDirectory(parentPath)
  }

  const viewFile = (filePath: string) => { if (onViewFile) onViewFile(filePath) }

  const runGitCommand = async (command: string) => {
    if (!workdir) { setGitError('未设置工作目录'); return }
    setGitOutput('执行中...'); setGitError('')
    try {
      const res = await fetch(`${API_BASE}/git/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, command })
      })
      const data = await res.json()
      if (data.error && !data.output) { setGitError(data.error); setGitOutput('') }
      else { setGitOutput(data.output || '命令执行成功（无输出）'); setGitError('') }
      loadGitStatus()
    } catch (error: any) { setGitError('请求失败: ' + error.message); setGitOutput('') }
  }

  const runGitCommit = async () => {
    if (!workdir || !commitMessage.trim()) { setGitError('请输入提交信息'); return }
    setGitOutput('提交中...'); setGitError('')
    try {
      const res = await fetch(`${API_BASE}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, message: commitMessage.trim() })
      })
      const data = await res.json()
      if (data.error) { setGitError(data.error); setGitOutput('') }
      else { setGitOutput(data.output || '提交成功'); setGitError(''); setCommitMessage('') }
      loadGitStatus()
    } catch (error: any) { setGitError('提交失败: ' + error.message); setGitOutput('') }
  }

  const safePull = async () => {
    if (!workdir) { setGitError('未设置工作目录'); return }
    const hasChanges = (gitStatus?.modified?.length ?? 0) > 0 || (gitStatus?.staged?.length ?? 0) > 0
    if (hasChanges) {
      const fileList = [
        ...(gitStatus?.modified || []).map(f => `  修改: ${f}`),
        ...(gitStatus?.staged || []).map(f => `  暂存: ${f}`)
      ].join('\n')
      if (!confirm(`⚠️ 有本地未提交的修改，Pull 可能覆盖这些更改：\n\n${fileList}\n\n确定要继续 Pull 吗？建议先 commit 或 stash。`)) return
    }
    runGitCommand('git pull')
  }

  const getFileIcon = (name: string, isDirectory: boolean) => {
    if (isDirectory) return '📁'
    const ext = name.split('.').pop()?.toLowerCase()
    const icons: Record<string, string> = {
      js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
      json: '📋', md: '📝', txt: '📄',
      css: '🎨', scss: '🎨', html: '🌐',
      py: '🐍', rb: '💎', go: '🔵',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
      svg: '🎯', git: '📂'
    }
    return icons[ext || ''] || '📄'
  }

  const formatFileSize = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined) return ''
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const truncatePath = (path: string, maxLen = 30) => {
    if (path.length <= maxLen) return path
    return '...' + path.slice(-(maxLen - 3))
  }

  const getRelativePath = (path: string) => {
    if (!workdir) return path
    if (path === workdir) return '/'
    const rel = path.startsWith(workdir + '/') ? path.slice(workdir.length) : path
    return rel || '/'
  }

  const isAtRoot = currentPath === workdir

  const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, label, section }) => (
    <button
      onClick={() => setExpandedSection(expandedSection === section ? '' : section)}
      className="w-full px-4 py-3 flex items-center justify-between"
      style={{ color: 'var(--text-secondary)' }}
    >
      <span className="flex items-center gap-2 text-sm font-medium">{icon} {label}</span>
      <IconChevron open={expandedSection === section} />
    </button>
  )

  return (
    <div className="panel flex flex-col h-full overflow-y-auto" style={{ width: 300 }}>
      {/* File manager */}
      <div className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <SectionHeader icon={<IconFolder />} label="文件管理" section="files" />

        {expandedSection === 'files' && (
          <div className="max-h-[50vh] flex flex-col">
            {/* Path bar */}
            <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              {!isAtRoot && (
                <button onClick={goUp} className="btn-icon w-7 h-7" title="上级目录">
                  <IconUp />
                </button>
              )}
              <span className="text-xs truncate flex-1" style={{ color: 'var(--text-muted)' }} title={currentPath}>
                {truncatePath(getRelativePath(currentPath), 22)}
              </span>
              <button onClick={() => loadFiles(currentPath)} className="btn-icon w-7 h-7" title="刷新">
                <IconRefresh />
              </button>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</div>
              ) : files.length === 0 ? (
                <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>空目录</div>
              ) : (
                files.map((file, idx) => (
                  <div
                    key={idx}
                    onClick={() => file.isDirectory ? enterDirectory(file.path) : viewFile(file.path)}
                    className="px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span className="text-sm">{getFileIcon(file.name, file.isDirectory)}</span>
                    <span className="text-sm truncate flex-1">{file.name}</span>
                    {!file.isDirectory && file.size !== null && file.size !== undefined && (
                      <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                        {formatFileSize(file.size)}
                      </span>
                    )}
                    {file.isDirectory && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>›</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Git controls */}
      <div className="flex-1 flex flex-col">
        <SectionHeader icon={<IconGit />} label="Git 控制" section="git" />

        {expandedSection === 'git' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Current branch */}
            <div className="card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>当前分支</span>
                <button onClick={loadGitStatus} className="btn-icon w-6 h-6">
                  <IconRefresh />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--success)' }}>🌿</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {gitStatus?.branch || 'main'}
                </span>
              </div>
            </div>

            {/* Git action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={safePull} className="btn-secondary py-2 text-sm flex items-center justify-center gap-1.5"
                title="拉取远程更新到本地（有修改时会确认）">
                📥 Pull
              </button>
              <button onClick={() => runGitCommand('git push')} className="btn-secondary py-2 text-sm flex items-center justify-center gap-1.5"
                title="推送本地提交到远程仓库">
                📤 Push
              </button>
              <button onClick={() => runGitCommand('git branch -a')} className="btn-secondary py-2 text-sm flex items-center justify-center gap-1.5"
                title="查看所有分支（本地和远程）">
                🌿 分支
              </button>
              <button onClick={() => runGitCommand('git status')} className="btn-secondary py-2 text-sm flex items-center justify-center gap-1.5"
                title="查看工作区状态">
                📋 状态
              </button>
            </div>

            {/* Modified files */}
            {(gitStatus?.modified?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs mb-2" style={{ color: 'var(--warning)' }}>📝 已修改 ({gitStatus!.modified!.length})</div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {gitStatus!.modified!.map((file, idx) => (
                    <div key={idx} className="px-2 py-1 text-xs flex items-center gap-2 rounded"
                      style={{ color: 'var(--warning)', background: 'var(--warning-soft)' }}>
                      <span>●</span>
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Staged files */}
            {(gitStatus?.staged?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs mb-2" style={{ color: 'var(--success)' }}>✅ 已暂存 ({gitStatus!.staged!.length})</div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {gitStatus!.staged!.map((file, idx) => (
                    <div key={idx} className="px-2 py-1 text-xs flex items-center gap-2 rounded"
                      style={{ color: 'var(--success)', background: 'var(--success-soft)' }}>
                      <span>●</span>
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Untracked files */}
            {(gitStatus?.untracked?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>❓ 未跟踪 ({gitStatus!.untracked!.length})</div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {gitStatus!.untracked!.map((file, idx) => (
                    <div key={idx} className="px-2 py-1 text-xs flex items-center gap-2"
                      style={{ color: 'var(--text-muted)' }}>
                      <span>●</span>
                      <span className="truncate">{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Commit area */}
            <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <textarea
                placeholder="提交信息..."
                value={commitMessage}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCommitMessage(e.target.value)}
                className="input-textarea text-sm"
                rows={2}
              />
              <button onClick={runGitCommit} className="btn-primary w-full py-2 text-sm">
                ✓ 提交更改
              </button>
            </div>

            {/* Quick commands */}
            <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>快捷命令</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { cmd: 'git log --oneline -10', label: 'git log', tip: '查看最近10条提交记录' },
                  { cmd: 'git diff', label: 'git diff', tip: '查看未暂存的文件差异' },
                  { cmd: 'git fetch', label: 'git fetch', tip: '从远程下载更新但不合并' },
                  { cmd: 'git stash', label: 'git stash', tip: '暂存当前修改' },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={() => runGitCommand(item.cmd)}
                    className="btn-pill text-xs"
                    title={item.tip}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Git output */}
            {(gitOutput || gitError) && (
              <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>输出</span>
                  <button onClick={() => { setGitOutput(''); setGitError('') }} className="btn-icon w-6 h-6">
                    <IconClear />
                  </button>
                </div>
                <pre className={`text-xs p-3 rounded-lg overflow-y-auto max-h-60 whitespace-pre-wrap break-all`}
                  style={{
                    background: gitError ? 'var(--error-soft)' : 'var(--bg-primary)',
                    color: gitError ? 'var(--error)' : 'var(--text-secondary)',
                    border: `1px solid ${gitError ? 'var(--error)' : 'var(--border-subtle)'}`
                  }}>
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
