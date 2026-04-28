import React, { useState } from 'react'

interface StepDef {
  id: string
  name: string
  prompt: string
  model?: string
  dependsOn: string[]
  timeout: number
}

interface WorkflowDef {
  id: string
  name: string
  description: string
  steps: StepDef[]
}

interface OptionItem {
  id: string
  name: string
}

interface WorkflowEditorProps {
  initialDef?: WorkflowDef
  models: OptionItem[]
  onSave: (def: { name: string; description: string; steps: StepDef[] }) => void
  onSaveAndRun: (def: { name: string; description: string; steps: StepDef[] }) => void
  onSaveAsTemplate: (def: { name: string; description: string; steps: StepDef[] }) => void
  onCancel: () => void
}

const generateStepId = (index: number): string => `step_${Date.now()}_${index}`

const hasCycle = (steps: StepDef[], stepId: string, newDep: string): boolean => {
  const visited = new Set<string>()
  const queue = [newDep]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === stepId) return true
    if (visited.has(current)) continue
    visited.add(current)
    const step = steps.find(s => s.id === current)
    if (step) {
      step.dependsOn.forEach(dep => queue.push(dep))
    }
  }
  return false
}

export default function WorkflowEditor({ initialDef, models, onSave, onSaveAndRun, onSaveAsTemplate, onCancel }: WorkflowEditorProps) {
  const [name, setName] = useState(initialDef?.name || '')
  const [description, setDescription] = useState(initialDef?.description || '')
  const [steps, setSteps] = useState<StepDef[]>(
    initialDef?.steps?.map(s => ({ ...s })) || [
      { id: generateStepId(0), name: '', prompt: '', model: '', dependsOn: [], timeout: 600 }
    ]
  )

  const addStep = () => {
    setSteps(prev => [
      ...prev,
      { id: generateStepId(prev.length), name: '', prompt: '', model: '', dependsOn: [], timeout: 600 }
    ])
  }

  const removeStep = (stepId: string) => {
    if (steps.length <= 1) return
    setSteps(prev => {
      const filtered = prev.filter(s => s.id !== stepId)
      return filtered.map(s => ({
        ...s,
        dependsOn: s.dependsOn.filter(dep => dep !== stepId)
      }))
    })
  }

  const updateStep = (stepId: string, field: keyof StepDef, value: any) => {
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, [field]: value } : s))
  }

  const toggleDependency = (stepId: string, depId: string) => {
    setSteps(prev => {
      const step = prev.find(s => s.id === stepId)
      if (!step) return prev
      if (step.dependsOn.includes(depId)) {
        return prev.map(s => s.id === stepId ? { ...s, dependsOn: s.dependsOn.filter(d => d !== depId) } : s)
      }
      if (hasCycle(prev, stepId, depId)) return prev
      return prev.map(s => s.id === stepId ? { ...s, dependsOn: [...s.dependsOn, depId] } : s)
    })
  }

  const getBuildDef = () => ({ name, description, steps })

  const isValid = name.trim() && steps.length > 0 && steps.every(s => s.name.trim() && s.prompt.trim())

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      <div className="px-4 py-3 border-b"
           style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          🔧 工作流编辑器
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="工作流名称..."
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>描述</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="工作流描述..."
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((step, idx) => (
            <div key={step.id}
                 className="rounded-lg border p-3 space-y-2"
                 style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  步骤 {idx + 1}
                </span>
                <button
                  onClick={() => removeStep(step.id)}
                  disabled={steps.length <= 1}
                  className="px-1.5 py-0.5 rounded text-xs hover:opacity-80 disabled:opacity-30"
                  style={{ color: 'var(--error)' }}
                >
                  删除
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>名称</label>
                  <input
                    type="text"
                    value={step.name}
                    onChange={e => updateStep(step.id, 'name', e.target.value)}
                    placeholder="步骤名称..."
                    className="w-full px-2 py-1.5 rounded text-xs border focus:outline-none"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>模型</label>
                  <select
                    value={step.model || ''}
                    onChange={e => updateStep(step.id, 'model', e.target.value)}
                    className="w-full px-2 py-1.5 rounded text-xs border focus:outline-none"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                  >
                    <option value="">默认模型</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>指令</label>
                <textarea
                  value={step.prompt}
                  onChange={e => updateStep(step.id, 'prompt', e.target.value)}
                  placeholder="发送给 Agent 的指令..."
                  className="w-full px-2 py-1.5 rounded text-xs border focus:outline-none resize-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)', minHeight: 60 }}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>依赖</label>
                  <div className="flex flex-wrap gap-1">
                    {steps.filter(s => s.id !== step.id).map(s => {
                      const isChecked = step.dependsOn.includes(s.id)
                      const wouldCycle = !isChecked && hasCycle(steps, step.id, s.id)
                      return (
                        <label key={s.id}
                               className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer ${wouldCycle ? 'opacity-40 cursor-not-allowed' : ''}`}
                               style={{ background: isChecked ? 'var(--accent-primary-soft)' : 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={wouldCycle}
                            onChange={() => toggleDependency(step.id, s.id)}
                            className="rounded"
                            style={{ accentColor: 'var(--accent-primary)' }}
                          />
                          {s.name || `步骤${steps.indexOf(s) + 1}`}
                        </label>
                      )
                    })}
                    {steps.length <= 1 && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>无</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>超时 (秒)</label>
                  <input
                    type="number"
                    value={step.timeout}
                    onChange={e => updateStep(step.id, 'timeout', Math.max(10, parseInt(e.target.value) || 600))}
                    className="w-full px-2 py-1.5 rounded text-xs border focus:outline-none"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
                    min={10}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addStep}
          className="w-full py-2 rounded-lg text-xs border-2 border-dashed transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
        >
          + 添加步骤
        </button>
      </div>

      <div className="px-4 py-3 border-t flex items-center justify-end gap-2"
           style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          取消
        </button>
        <button
          onClick={() => onSaveAsTemplate(getBuildDef())}
          disabled={!isValid}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          保存为模板
        </button>
        <button
          onClick={() => onSave(getBuildDef())}
          disabled={!isValid}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--accent-primary)', color: 'white' }}
        >
          保存
        </button>
        <button
          onClick={() => onSaveAndRun(getBuildDef())}
          disabled={!isValid}
          className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary, #8b5cf6))', color: 'white' }}
        >
          保存并执行
        </button>
      </div>
    </div>
  )
}
