import React, { useState } from 'react'
import WorkflowStepCard from './WorkflowStepCard'

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'

interface WorkflowStep {
  id: string
  name: string
  prompt: string
  model?: string
  dependsOn: string[]
  status: StepStatus
  result: string | null
  error: string | null
  messages: Array<{ type: string; content: string; time: number }>
  startedAt: number | null
  completedAt: number | null
}

interface WorkflowData {
  id: string
  name: string
  status: string
  steps: WorkflowStep[]
  startedAt: number | null
  completedAt: number | null
}

interface WorkflowPanelProps {
  workflow: WorkflowData
  onPause: (workflowId: string) => void
  onCancel: (workflowId: string) => void
  onRetryStep: (workflowId: string, stepId: string) => void
  onClose: () => void
}

interface FlatStep {
  step: WorkflowStep
  depth: number
}

const statusLabel = (status: string): string => {
  switch (status) {
    case 'idle': return '就绪'
    case 'running': return '执行中'
    case 'paused': return '已暂停'
    case 'done': return '完成'
    case 'error': return '出错'
    case 'cancelled': return '已取消'
    default: return status
  }
}

const topologicalSort = (steps: WorkflowStep[]): FlatStep[] => {
  const stepMap = new Map(steps.map(s => [s.id, s]))
  // 每个步骤的最大依赖深度（用于缩进）
  const depthMap = new Map<string, number>()

  steps.forEach(s => {
    const getDepth = (id: string, visited = new Set<string>()): number => {
      if (depthMap.has(id)) return depthMap.get(id)!
      if (visited.has(id)) return 0
      visited.add(id)
      const step = stepMap.get(id)
      if (!step || step.dependsOn.length === 0) {
        depthMap.set(id, 0)
        return 0
      }
      const maxDepDepth = Math.max(...step.dependsOn.map(depId => {
        const dep = stepMap.get(depId)
        return dep ? getDepth(depId, visited) : 0
      }))
      const depth = maxDepDepth + 1
      depthMap.set(id, depth)
      return depth
    }
    getDepth(s.id)
  })

  // BFS 拓扑排序：按依赖层级从浅到深
  const inDegree = new Map<string, number>()
  const childrenMap = new Map<string, string[]>()
  steps.forEach(s => {
    inDegree.set(s.id, s.dependsOn.filter(depId => stepMap.has(depId)).length)
    if (!childrenMap.has(s.id)) childrenMap.set(s.id, [])
  })
  steps.forEach(s => {
    s.dependsOn.forEach(depId => {
      if (childrenMap.has(depId)) {
        childrenMap.get(depId)!.push(s.id)
      }
    })
  })

  const queue: string[] = []
  inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id) })

  const result: FlatStep[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const step = stepMap.get(id)
    if (step) {
      result.push({ step, depth: depthMap.get(id) || 0 })
    }
    const children = childrenMap.get(id) || []
    children.forEach(childId => {
      const deg = inDegree.get(childId)! - 1
      inDegree.set(childId, deg)
      if (deg === 0) queue.push(childId)
    })
  }

  return result
}

interface StepNode {
  step: WorkflowStep
  children: StepNode[]
}

const flattenWithDepth = (nodes: StepNode[], depth: number = 0, ancestorLast: boolean[] = []): Array<{ step: WorkflowStep; depth: number; isLast: boolean; ancestorLast: boolean[] }> => {
  const result: Array<{ step: WorkflowStep; depth: number; isLast: boolean; ancestorLast: boolean[] }> = []
  nodes.forEach((node, idx) => {
    const isLast = idx === nodes.length - 1
    result.push({ step: node.step, depth, isLast, ancestorLast: [...ancestorLast] })
    if (node.children.length > 0) {
      result.push(...flattenWithDepth(node.children, depth + 1, [...ancestorLast, isLast]))
    }
  })
  return result
}

const formatDuration = (start: number, end: number): string => {
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}m ${remain}s`
}

export default function WorkflowPanel({ workflow, onPause, onCancel, onRetryStep, onClose }: WorkflowPanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  const toggleExpand = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  const completed = workflow.steps.filter(s => s.status === 'done').length
  const total = workflow.steps.length
  const running = workflow.steps.some(s => s.status === 'running')
  const isFinished = workflow.status === 'done' || workflow.status === 'error' || workflow.status === 'cancelled'

  const flatSteps = topologicalSort(workflow.steps)

  const connectorPrefix = (depth: number): string => {
    if (depth === 0) return ''
    return '│   '.repeat(depth - 1) + '├──→ '
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="px-3 py-2 border-b flex items-center justify-between"
           style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            🔄 {workflow.name}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  background: isFinished ? 'var(--bg-tertiary)' : running ? 'var(--warning-soft)' : 'var(--bg-tertiary)',
                  color: isFinished ? 'var(--text-muted)' : running ? 'var(--warning)' : 'var(--text-muted)'
                }}>
            {statusLabel(workflow.status)}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {completed}/{total} 完成
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isFinished && (
            <>
              <button
                onClick={() => onPause(workflow.id)}
                className="px-2 py-1 rounded text-xs hover:opacity-80"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                ⏸ 暂停
              </button>
              <button
                onClick={() => onCancel(workflow.id)}
                className="px-2 py-1 rounded text-xs hover:opacity-80"
                style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
              >
                ⏹ 取消
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="px-1 rounded text-xs hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
            title="关闭面板"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0">
        {flatSteps.map((item, idx) => {
          const prefix = connectorPrefix(item.depth)
          return (
            <div key={item.step.id} className="flex items-start">
              {prefix && (
                <span className="flex-shrink-0 select-none whitespace-pre text-xs leading-6"
                      style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {prefix}
                </span>
              )}
              <div className={`flex-1 min-w-0 ${idx > 0 ? 'mt-0.5' : ''}`}>
                <WorkflowStepCard
                  step={item.step}
                  isExpanded={expandedSteps.has(item.step.id)}
                  onToggleExpand={toggleExpand}
                  onRetry={(stepId: string) => onRetryStep(workflow.id, stepId)}
                />
              </div>
            </div>
          )
        })}
        {workflow.steps.length === 0 && (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            <p className="text-sm">没有步骤</p>
          </div>
        )}
      </div>

      {isFinished && workflow.completedAt && workflow.startedAt && (
        <div className="px-3 py-2 border-t text-xs text-center"
             style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
          总耗时: {formatDuration(workflow.startedAt, workflow.completedAt)}
        </div>
      )}
    </div>
  )
}
