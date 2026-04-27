import React from 'react'

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'

interface WorkflowStep {
  id: string
  name: string
  prompt: string
  agentType: string
  dependsOn: string[]
  status: StepStatus
  result: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

interface WorkflowStepCardProps {
  step: WorkflowStep
  isExpanded: boolean
  onToggleExpand: (stepId: string) => void
  onRetry?: (stepId: string) => void
}

const statusIcon = (status: StepStatus): string => {
  switch (status) {
    case 'pending': return '⏳'
    case 'running': return '🔄'
    case 'done': return '✅'
    case 'error': return '❌'
    case 'skipped': return '⏭'
    case 'cancelled': return '⊘'
    default: return '❓'
  }
}

const statusLabel = (status: StepStatus): string => {
  switch (status) {
    case 'pending': return '等待'
    case 'running': return '执行中'
    case 'done': return '完成'
    case 'error': return '失败'
    case 'skipped': return '跳过'
    case 'cancelled': return '已取消'
    default: return '未知'
  }
}

const formatDuration = (start: number, end: number): string => {
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}m ${remain}s`
}

const agentLabel = (type: string): string => {
  switch (type) {
    case 'claude-code': return 'Claude Code'
    case 'opencode': return 'OpenCode'
    case 'codex': return 'Codex'
    default: return type
  }
}

export default function WorkflowStepCard({ step, isExpanded, onToggleExpand, onRetry }: WorkflowStepCardProps) {
  const duration = step.startedAt && step.completedAt ? formatDuration(step.startedAt, step.completedAt) : null

  return (
    <div className="rounded-lg" style={{ background: 'var(--bg-primary)' }}>
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer rounded-lg transition-colors"
        style={{ background: step.status === 'running' ? 'var(--accent-primary-soft)' : 'transparent' }}
        onClick={() => onToggleExpand(step.id)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0">{statusIcon(step.status)}</span>
          <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {step.name}
          </span>
          <span className="hidden md:inline px-1.5 py-0.5 rounded text-xs flex-shrink-0"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', fontSize: 10 }}>
            {agentLabel(step.agentType)}
          </span>
          {duration && (
            <span className="flex-shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              {duration}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {step.status === 'error' && onRetry && (
            <button
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRetry(step.id) }}
              className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
              style={{ color: 'var(--accent-primary)' }}
            >
              重试
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {statusLabel(step.status)}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{isExpanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-2 pt-1 space-y-2">
          <div className="rounded-md p-2 text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)', fontSize: 10 }}>指令</div>
            <div className="whitespace-pre-wrap break-words">{step.prompt}</div>
          </div>
          {step.result && (
            <div className="rounded-md p-2 text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
              <div className="mb-1" style={{ color: 'var(--text-muted)', fontSize: 10 }}>结果</div>
              <div className="whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{step.result}</div>
            </div>
          )}
          {step.error && (
            <div className="rounded-md p-2 text-xs" style={{ background: 'var(--error-soft)', color: 'var(--error)' }}>
              <div className="mb-1" style={{ fontSize: 10 }}>错误</div>
              <div className="whitespace-pre-wrap break-words">{step.error}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
