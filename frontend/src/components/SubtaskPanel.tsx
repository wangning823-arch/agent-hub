import React from 'react'

type SubtaskStatus = 'pending' | 'running' | 'done' | 'error'

interface Subtask {
  id: string
  status: SubtaskStatus
  description: string
  complexity: string
  result?: string
  error?: string
}

interface SubtaskPanelProps {
  subtasks: Subtask[]
  show: boolean
  onToggle: () => void
  onExecute: (id: string) => void
  onExecuteAll: () => void
  onCancel: (id: string) => void
  onViewResult: (id: string) => void
  onClose?: () => void
}

const statusIcon = (status: SubtaskStatus): string => {
  switch (status) {
    case 'pending': return '⏳'
    case 'running': return '🔄'
    case 'done': return '✅'
    case 'error': return '❌'
    default: return '❓'
  }
}

export default function SubtaskPanel({ subtasks, show, onToggle, onExecute, onExecuteAll, onCancel, onViewResult, onClose }: SubtaskPanelProps) {
  if (subtasks.length === 0 || !show) return null

  const completed: number = subtasks.filter(s => s.status === 'done').length
  const running: number = subtasks.filter(s => s.status === 'running').length
  const pending: number = subtasks.filter(s => s.status === 'pending').length
  const allDone: boolean = completed === subtasks.length

  return (
    <div className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      {/* 标题栏 - 始终显示，点击切换展开/收起 */}
      <div className="flex items-center justify-between px-3 py-2 cursor-pointer"
           onClick={onToggle}>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          📋 并行任务 ({completed}/{subtasks.length} 完成)
          {running > 0 && <span className="ml-2 text-xs" style={{ color: 'var(--warning)' }}>执行中...</span>}
        </span>
        <div className="flex items-center gap-1">
          {onClose && (
            <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClose(); }}
                    className="px-1 rounded text-xs hover:opacity-80"
                    style={{ color: 'var(--text-muted)' }}
                    title="关闭面板">✕</button>
          )}
          <span style={{ color: 'var(--text-muted)' }}>{show ? '▾' : '▸'}</span>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="px-3 pb-2 space-y-1">
          {subtasks.map(task => (
            <div key={task.id}
                 className="flex items-center justify-between px-2 py-1.5 rounded text-xs"
                 style={{ background: 'var(--bg-primary)' }}>
              <div className="flex items-center gap-2 min-w-0">
                <span>{statusIcon(task.status)}</span>
                <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                  {task.description}
                </span>
                <span className="hidden md:inline px-1 rounded"
                      style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                  {task.complexity}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {task.status === 'pending' && (
                  <button onClick={() => onExecute(task.id)}
                          className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
                          style={{ color: 'var(--accent-primary)' }}>▶</button>
                )}
                {task.status === 'running' && (
                  <>
                    <button onClick={() => onViewResult(task.id)}
                            className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
                            style={{ color: 'var(--accent-primary)' }}>查看</button>
                    <button onClick={() => onCancel(task.id)}
                            className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
                            style={{ color: 'var(--error)' }}>⏹</button>
                  </>
                )}
                {task.status === 'done' && task.result && (
                  <button onClick={() => onViewResult(task.id)}
                          className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
                          style={{ color: 'var(--accent-primary)' }}>查看</button>
                )}
                {task.status === 'error' && (
                  <span style={{ color: 'var(--error)', fontSize: 10 }} title={task.error}>❌</span>
                )}
              </div>
            </div>
          ))}

          {/* 底部操作栏 */}
          <div className="flex items-center gap-2 pt-1">
            {pending > 0 && (
              <button onClick={onExecuteAll}
                      className="px-2 py-1 rounded text-xs hover:opacity-80"
                      style={{ background: 'var(--accent-primary)', color: 'white' }}>
                ▶ 全部执行 ({pending})
              </button>
            )}
          </div>
        </div>
    </div>
  )
}
