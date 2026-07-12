import React from 'react'

type IterationStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

interface LoopStepResult {
  stepId: string
  status: string
  result: string | null
  error: string | null
}

interface LoopIteration {
  index: number
  status: IterationStatus
  startedAt: number | null
  completedAt: number | null
  results: LoopStepResult[]
  error?: string
}

interface LoopData {
  id: string
  defId: string
  name: string
  status: string
  currentIteration: number
  maxIterations: number
  iterations: LoopIteration[]
  startedAt: number | null
  completedAt: number | null
}

interface LoopPanelProps {
  loop: LoopData
  onPause: (loopId: string) => void
  onCancel: (loopId: string) => void
  onRetry: (loopId: string) => void
  onClose: () => void
}

const statusLabel = (status: string): string => {
  switch (status) {
    case 'idle': return '就绪'
    case 'running': return '执行中'
    case 'paused': return '已暂停'
    case 'completed': return '完成'
    case 'error': return '出错'
    case 'cancelled': return '已取消'
    default: return status
  }
}

const iterationStatusLabel = (status: IterationStatus): string => {
  switch (status) {
    case 'pending': return '等待中'
    case 'running': return '执行中'
    case 'done': return '完成'
    case 'error': return '出错'
    case 'skipped': return '跳过'
    default: return status
  }
}

const statusColor = (status: string): string => {
  switch (status) {
    case 'running': return 'var(--accent-primary)'
    case 'completed': return 'var(--success, #22c55e)'
    case 'error': return 'var(--error, #ef4444)'
    case 'paused': return 'var(--warning, #f59e0b)'
    case 'cancelled': return 'var(--text-muted)'
    default: return 'var(--text-secondary)'
  }
}

const iterationStatusColor = (status: IterationStatus): string => {
  switch (status) {
    case 'running': return 'var(--accent-primary)'
    case 'done': return 'var(--success, #22c55e)'
    case 'error': return 'var(--error, #ef4444)'
    case 'skipped': return 'var(--text-muted)'
    default: return 'var(--text-secondary)'
  }
}

const LoopPanel: React.FC<LoopPanelProps> = ({
  loop,
  onPause,
  onCancel,
  onRetry,
  onClose
}) => {
  const isActive = loop.status === 'running'
  const isPaused = loop.status === 'paused'
  const isError = loop.status === 'error'
  const canPause = isActive
  const canCancel = isActive || isPaused
  const canRetry = isError

  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleTimeString()
  }

  const formatDuration = (start: number | null, end: number | null): string => {
    if (!start) return '-'
    const endTime = end || Date.now()
    const duration = Math.floor((endTime - start) / 1000)
    if (duration < 60) return `${duration}秒`
    return `${Math.floor(duration / 60)}分${duration % 60}秒`
  }

  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 16,
      marginBottom: 12
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>循环</span>
          <span style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            background: statusColor(loop.status),
            color: '#fff'
          }}>
            {statusLabel(loop.status)}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 16
          }}
        >
          ✕
        </button>
      </div>

      {/* Info */}
      <div style={{
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginBottom: 12,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4
      }}>
        <div>名称: {loop.name}</div>
        <div>迭代: {loop.currentIteration + 1} / {loop.maxIterations}</div>
        <div>开始: {formatTime(loop.startedAt)}</div>
        <div>耗时: {formatDuration(loop.startedAt, loop.completedAt)}</div>
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 12
      }}>
        {canPause && (
          <button
            onClick={() => onPause(loop.id)}
            style={{
              flex: 1,
              padding: '6px 12px',
              background: 'var(--warning, #f59e0b)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            暂停
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => onCancel(loop.id)}
            style={{
              flex: 1,
              padding: '6px 12px',
              background: 'var(--error, #ef4444)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            取消
          </button>
        )}
        {canRetry && (
          <button
            onClick={() => onRetry(loop.id)}
            style={{
              flex: 1,
              padding: '6px 12px',
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            重试
          </button>
        )}
      </div>

      {/* Iterations */}
      {loop.iterations.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: 12
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 8,
            color: 'var(--text-primary)'
          }}>
            迭代历史
          </div>
          <div style={{
            maxHeight: 200,
            overflowY: 'auto'
          }}>
            {[...loop.iterations].reverse().map((iteration) => (
              <div
                key={iteration.index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 4,
                  marginBottom: 4,
                  fontSize: 12
                }}
              >
                <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>
                  #{iteration.index + 1}
                </span>
                <span style={{
                  color: iterationStatusColor(iteration.status),
                  fontWeight: 500
                }}>
                  {iterationStatusLabel(iteration.status)}
                </span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {formatDuration(iteration.startedAt, iteration.completedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default LoopPanel
