import React, { useMemo } from 'react'

interface StepDef {
  id: string
  name: string
  prompt: string
  model?: string
  dependsOn: string[]
  timeout: number
}

interface Props {
  steps: StepDef[]
  onClose: () => void
}

const NODE_W = 180
const NODE_H = 56
const GAP_X = 60
const GAP_Y = 24
const PADDING = 32

/**
 * 根据依赖关系计算步骤的布局层级
 * 没有依赖的步骤在第0层，依赖第N层的步骤在第N+1层
 */
function computeLayout(steps: StepDef[]) {
  const idToStep = new Map(steps.map(s => [s.id, s]))
  const levelMap = new Map<string, number>()

  const getLevel = (id: string, visited = new Set<string>()): number => {
    if (levelMap.has(id)) return levelMap.get(id)!
    if (visited.has(id)) return 0 // 循环依赖保护
    visited.add(id)
    const step = idToStep.get(id)
    if (!step || step.dependsOn.length === 0) {
      levelMap.set(id, 0)
      return 0
    }
    const maxDepLevel = Math.max(...step.dependsOn.map(depId => getLevel(depId, visited)))
    const level = maxDepLevel + 1
    levelMap.set(id, level)
    return level
  }

  steps.forEach(s => getLevel(s.id))

  // 按层级分组
  const levels: string[][] = []
  for (const [id, level] of levelMap) {
    if (!levels[level]) levels[level] = []
    levels[level].push(id)
  }

  return { levels, levelMap }
}

export default function WorkflowFlowchart({ steps, onClose }: Props) {
  const { levels, levelMap } = useMemo(() => computeLayout(steps), [steps])
  const idToStep = useMemo(() => new Map(steps.map(s => [s.id, s])), [steps])

  const cols = levels.length
  const maxRows = Math.max(...levels.map(l => l.length), 1)
  const svgW = PADDING * 2 + cols * NODE_W + (cols - 1) * GAP_X
  const svgH = PADDING * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * GAP_Y

  // 计算每个步骤的位置
  const positions = new Map<string, { x: number; y: number }>()
  levels.forEach((levelIds, col) => {
    const totalH = levelIds.length * NODE_H + (levelIds.length - 1) * GAP_Y
    const startY = PADDING + (svgH - PADDING * 2 - totalH) / 2
    levelIds.forEach((id, row) => {
      positions.set(id, {
        x: PADDING + col * (NODE_W + GAP_X),
        y: startY + row * (NODE_H + GAP_Y),
      })
    })
  })

  // 绘制依赖箭头
  const arrows: React.ReactNode[] = []
  steps.forEach(step => {
    const target = positions.get(step.id)
    if (!target) return
    step.dependsOn.forEach(depId => {
      const source = positions.get(depId)
      if (!source) return
      const x1 = source.x + NODE_W / 2
      const y1 = source.y + NODE_H
      const x2 = target.x + NODE_W / 2
      const y2 = target.y
      const midY = (y1 + y2) / 2
      arrows.push(
        <path
          key={`${depId}-${step.id}`}
          d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
          opacity={0.7}
        />
      )
    })
  })

  // 绘制节点
  const nodes: React.ReactNode[] = []
  steps.forEach(step => {
    const pos = positions.get(step.id)
    if (!pos) return
    const depCount = step.dependsOn.length
    const isRoot = depCount === 0
    nodes.push(
      <g key={step.id}>
        <rect
          x={pos.x}
          y={pos.y}
          width={NODE_W}
          height={NODE_H}
          rx={8}
          fill={isRoot ? 'var(--accent-primary-soft, rgba(99,102,241,0.15))' : 'var(--bg-secondary)'}
          stroke={isRoot ? 'var(--accent-primary)' : 'var(--border-subtle)'}
          strokeWidth={1.5}
        />
        <text
          x={pos.x + NODE_W / 2}
          y={pos.y + NODE_H / 2 - 6}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--text-primary)"
          fontSize={13}
          fontWeight={600}
        >
          {step.name.length > 14 ? step.name.slice(0, 13) + '…' : step.name}
        </text>
        {depCount > 0 && (
          <text
            x={pos.x + NODE_W / 2}
            y={pos.y + NODE_H / 2 + 14}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--text-muted)"
            fontSize={11}
          >
            依赖 {depCount} 个步骤
          </text>
        )}
        {isRoot && (
          <text
            x={pos.x + NODE_W / 2}
            y={pos.y + NODE_H / 2 + 14}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--accent-primary)"
            fontSize={11}
          >
            起始步骤
          </text>
        )}
      </g>
    )
  })

  // 检测并行步骤（同一层级有多个步骤）
  const parallelGroups = levels
    .map((ids, idx) => ({ level: idx, ids }))
    .filter(g => g.ids.length > 1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.5)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto"
           style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
           onMouseDown={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b"
             style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            工作流流程图 ({steps.length} 个步骤)
          </h3>
          <div className="flex items-center gap-3">
            {parallelGroups.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded"
                    style={{ background: 'var(--accent-primary-soft, rgba(99,102,241,0.15))', color: 'var(--accent-primary)' }}>
                {parallelGroups.length} 组并行
              </span>
            )}
            <button onClick={onClose}
                    className="px-2 py-0.5 rounded text-xs hover:opacity-80"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              关闭
            </button>
          </div>
        </div>

        {/* SVG 流程图 */}
        <div className="p-4 overflow-auto" style={{ minHeight: 200 }}>
          <svg width={svgW} height={svgH} style={{ display: 'block', margin: '0 auto' }}>
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7"
                      refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-primary)" opacity={0.7} />
              </marker>
            </defs>
            {arrows}
            {nodes}
          </svg>
        </div>

        {/* 步骤列表 */}
        <div className="px-4 pb-3">
          <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>执行顺序：</div>
          <div className="flex flex-wrap gap-1.5">
            {levels.map((ids, level) => (
              <React.Fragment key={level}>
                {ids.map(id => {
                  const step = idToStep.get(id)!
                  return (
                    <span key={id}
                          className="px-2 py-0.5 rounded text-xs"
                          style={{ background: level === 0 ? 'var(--accent-primary-soft, rgba(99,102,241,0.15))' : 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                      {step.name}
                    </span>
                  )
                })}
                {level < levels.length - 1 && (
                  <span className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
