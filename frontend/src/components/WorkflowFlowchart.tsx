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
const GAP_X = 80
const GAP_Y = 28
const PADDING = 40

/**
 * 根据依赖关系计算步骤的布局层级
 * 没有依赖的步骤在第0层，依赖第N层的步骤在第N+1层
 */
function computeLayout(steps: StepDef[]) {
  const idSet = new Set(steps.map(s => s.id))
  const idToStep = new Map(steps.map(s => [s.id, s]))
  // 建立 name → id 映射，处理老工作流 dependsOn 中使用名称而非 ID 的情况
  const nameToId = new Map<string, string>()
  steps.forEach(s => { if (s.name) nameToId.set(s.name, s.id) })

  const levelMap = new Map<string, number>()

  const getLevel = (id: string, visited = new Set<string>()): number => {
    if (levelMap.has(id)) return levelMap.get(id)!
    if (visited.has(id)) return 0 // 循环依赖保护
    visited.add(id)
    const step = idToStep.get(id)
    if (!step) return 0
    // 解析依赖：先尝试 ID 匹配，再尝试名称匹配
    const resolvedDeps = step.dependsOn
      .map(dep => idSet.has(dep) ? dep : (nameToId.get(dep) || ''))
      .filter(dep => dep && dep !== id)
    const validDeps = resolvedDeps.filter(dep => idSet.has(dep))
    if (validDeps.length === 0) {
      levelMap.set(id, 0)
      return 0
    }
    const maxDepLevel = Math.max(...validDeps.map(depId => getLevel(depId, visited)))
    const level = maxDepLevel + 1
    levelMap.set(id, level)
    return level
  }

  steps.forEach(s => getLevel(s.id))

  // 按层级分组，只包含存在于 idSet 中的步骤
  const levels: string[][] = []
  for (const [id, level] of levelMap) {
    if (!idSet.has(id)) continue
    if (!levels[level]) levels[level] = []
    levels[level].push(id)
  }

  return { levels, levelMap, idSet }
}

/**
 * 生成平滑的S形贝塞尔曲线路径
 * 从源节点右侧连接到目标节点左侧
 */
function createSmoothPath(
  x1: number, y1: number, x2: number, y2: number,
  curvature: number = 0.5
): string {
  const dx = Math.abs(x2 - x1)
  const dy = Math.abs(y2 - y1)
  // 控制点偏移量：水平距离越大，控制点越远；垂直距离越大，垂直偏移越大
  const ctrl = Math.max(dx * curvature, 30)
  // 从右侧出，左侧入
  if (x2 > x1) {
    // 正常从左到右
    const cx1 = x1 + ctrl
    const cy1 = y1
    const cx2 = x2 - ctrl
    const cy2 = y2
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
  }
  // 回退：上方的节点连到下方
  const cx1 = x1
  const cy1 = y1 + ctrl
  const cx2 = x2
  const cy2 = y2 - ctrl
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
}

export default function WorkflowFlowchart({ steps, onClose }: Props) {
  // 过滤掉无效步骤
  const validSteps = useMemo(() =>
    steps.filter(s => s && s.id && s.name),
    [steps]
  )

  const { levels, levelMap, idSet } = useMemo(() => computeLayout(validSteps), [validSteps])
  const idToStep = useMemo(() => new Map(validSteps.map(s => [s.id, s])), [validSteps])
  const nameToId = useMemo(() => new Map(validSteps.map(s => [s.name, s.id])), [validSteps])

  const cols = levels.length
  const maxRows = Math.max(...levels.map(l => l.length), 1)
  const svgW = PADDING * 2 + cols * NODE_W + Math.max(0, cols - 1) * GAP_X
  const svgH = PADDING * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * GAP_Y

  // 计算每个步骤的位置
  const positions = new Map<string, { x: number; y: number }>()
  levels.forEach((levelIds, col) => {
    const totalH = levelIds.length * NODE_H + Math.max(0, levelIds.length - 1) * GAP_Y
    const startY = PADDING + (svgH - PADDING * 2 - totalH) / 2
    levelIds.forEach((id, row) => {
      positions.set(id, {
        x: PADDING + col * (NODE_W + GAP_X),
        y: startY + row * (NODE_H + GAP_Y),
      })
    })
  })

  // 绘制依赖箭头（连接节点边缘中心）
  const arrows: React.ReactNode[] = []
  validSteps.forEach(step => {
    const target = positions.get(step.id)
    if (!target) return
    // 解析依赖并过滤
    const validDeps = step.dependsOn
      .map(dep => idSet.has(dep) ? dep : (nameToId.get(dep) || ''))
      .filter(dep => dep && dep !== step.id && idSet.has(dep))
    validDeps.forEach(depId => {
      const source = positions.get(depId)
      if (!source) return
      // 源节点右侧中心 → 目标节点左侧中心
      const x1 = source.x + NODE_W
      const y1 = source.y + NODE_H / 2
      const x2 = target.x
      const y2 = target.y + NODE_H / 2
      const path = createSmoothPath(x1, y1, x2, y2, 0.6)
      arrows.push(
        <path
          key={`${depId}-${step.id}`}
          d={path}
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth={1.5}
          markerEnd="url(#arrowhead)"
        />
      )
    })
  })

  // 绘制节点
  const nodes: React.ReactNode[] = []
  validSteps.forEach(step => {
    const pos = positions.get(step.id)
    if (!pos) return
    const validDeps = step.dependsOn
      .map(dep => idSet.has(dep) ? dep : (nameToId.get(dep) || ''))
      .filter(dep => dep && dep !== step.id && idSet.has(dep))
    const depCount = validDeps.length
    const isRoot = depCount === 0
    // 检查是否是并行步骤（同层级有多个）
    const level = levelMap.get(step.id) ?? 0
    const isParallel = (levels[level]?.length ?? 0) > 1

    nodes.push(
      <g key={step.id}>
        <rect
          x={pos.x}
          y={pos.y}
          width={NODE_W}
          height={NODE_H}
          rx={8}
          fill={isRoot ? 'var(--accent-primary-soft, rgba(99,102,241,0.15))' : 'var(--bg-secondary)'}
          stroke={isRoot ? 'var(--accent-primary)' : isParallel ? 'var(--accent-secondary, #8b5cf6)' : 'var(--border-subtle)'}
          strokeWidth={isParallel ? 1.8 : 1.5}
          strokeDasharray={isParallel && !isRoot ? '6 3' : undefined}
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
          {step.name.length > 12 ? step.name.slice(0, 11) + '…' : step.name}
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
      <div className="rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-auto"
           style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
           onMouseDown={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b"
             style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            工作流流程图 ({validSteps.length} 个步骤)
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
              <marker id="arrowhead" markerWidth="8" markerHeight="6"
                      refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="var(--accent-primary)" />
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
                  const step = idToStep.get(id)
                  if (!step) return null
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
