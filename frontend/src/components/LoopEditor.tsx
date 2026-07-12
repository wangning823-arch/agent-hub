import React, { useState, useEffect } from 'react'

interface LoopStepDef {
  id: string
  name: string
  prompt: string
  agentType?: string
  model?: string
  timeout: number
}

interface LoopDefinition {
  id?: string
  name: string
  description: string
  steps: LoopStepDef[]
  maxIterations: number
  exitCondition?: string
  exitConditionType?: 'success' | 'failure' | 'custom'
  delayBetweenIterations: number
}

interface LoopEditorProps {
  definition?: LoopDefinition | null
  onSave: (def: LoopDefinition) => void
  onCancel: () => void
}

const defaultStep: LoopStepDef = {
  id: '',
  name: '',
  prompt: '',
  agentType: 'mimo',
  timeout: 60000
}

const agentTypes = [
  { id: 'mimo', name: 'MiMo' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'codex', name: 'Codex' }
]

const API_BASE = '/api'

const LoopEditor: React.FC<LoopEditorProps> = ({
  definition,
  onSave,
  onCancel
}) => {
  const [name, setName] = useState(definition?.name || '')
  const [description, setDescription] = useState(definition?.description || '')
  const [steps, setSteps] = useState<LoopStepDef[]>(
    definition?.steps || [{ ...defaultStep, id: `step_${Date.now()}` }]
  )
  const [maxIterations, setMaxIterations] = useState(definition?.maxIterations || 10)
  const [exitCondition, setExitCondition] = useState(definition?.exitCondition || '')
  const [exitConditionType, setExitConditionType] = useState<
    'success' | 'failure' | 'custom'
  >(definition?.exitConditionType || 'custom')
  const [delayBetweenIterations, setDelayBetweenIterations] = useState(
    definition?.delayBetweenIterations || 0
  )
  const [modelsByAgent, setModelsByAgent] = useState<Record<string, Array<{id: string, name: string}>>>({})

  // 获取指定 agent 的模型列表
  const fetchModels = async (agentType: string) => {
    if (modelsByAgent[agentType]) return
    try {
      const params = new URLSearchParams({ agentType })
      const data = await fetch(`${API_BASE}/options?${params}`).then(r => r.json())
      setModelsByAgent(prev => ({ ...prev, [agentType]: data.models || [] }))
    } catch (error) {
      console.error('加载模型列表失败:', error)
    }
  }

  // 当步骤的 agentType 变化时加载对应模型列表
  useEffect(() => {
    const agentTypes = [...new Set(steps.map(s => s.agentType || 'mimo'))]
    agentTypes.forEach(fetchModels)
  }, [steps])

  const handleAddStep = () => {
    setSteps([
      ...steps,
      { ...defaultStep, id: `step_${Date.now()}` }
    ])
  }

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) return
    setSteps(steps.filter((_, i) => i !== index))
  }

  const handleStepChange = (index: number, field: keyof LoopStepDef, value: any) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], [field]: value }
    setSteps(newSteps)
  }

  const handleSave = () => {
    if (!name.trim()) {
      alert('请输入循环名称')
      return
    }
    if (steps.some(s => !s.name.trim() || !s.prompt.trim())) {
      alert('请填写所有步骤的名称和提示词')
      return
    }

    onSave({
      id: definition?.id,
      name: name.trim(),
      description: description.trim(),
      steps,
      maxIterations,
      exitCondition: exitCondition.trim() || undefined,
      exitConditionType,
      delayBetweenIterations
    })
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: 8,
        width: '90%',
        maxWidth: 600,
        maxHeight: '80vh',
        overflow: 'auto',
        padding: 24
      }}>
        <h2 style={{
          margin: '0 0 16px 0',
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text-primary)'
        }}>
          {definition ? '编辑循环' : '创建循环'}
        </h2>

        {/* Basic Info */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 4,
            color: 'var(--text-secondary)'
          }}>
            名称 *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：测试修复循环"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              fontSize: 14
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 4,
            color: 'var(--text-secondary)'
          }}>
            描述
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选的描述"
            rows={2}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              fontSize: 14,
              resize: 'vertical'
            }}
          />
        </div>

        {/* Steps */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8
          }}>
            <label style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)'
            }}>
              步骤 *
            </label>
            <button
              onClick={handleAddStep}
              style={{
                padding: '4px 8px',
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              + 添加步骤
            </button>
          </div>

          {steps.map((step, index) => (
            <div
              key={step.id}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: 4,
                padding: 12,
                marginBottom: 8
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  步骤 {index + 1}
                </span>
                {steps.length > 1 && (
                  <button
                    onClick={() => handleRemoveStep(index)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--error, #ef4444)',
                      fontSize: 12
                    }}
                  >
                    删除
                  </button>
                )}
              </div>

              <input
                type="text"
                value={step.name}
                onChange={(e) => handleStepChange(index, 'name', e.target.value)}
                placeholder="步骤名称"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  marginBottom: 8
                }}
              />

              <textarea
                value={step.prompt}
                onChange={(e) => handleStepChange(index, 'prompt', e.target.value)}
                placeholder="提示词"
                rows={3}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  resize: 'vertical',
                  marginBottom: 8
                }}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={step.agentType || 'mimo'}
                  onChange={(e) => handleStepChange(index, 'agentType', e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                    fontSize: 12
                  }}
                >
                  {agentTypes.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>

                <select
                  value={step.model || ''}
                  onChange={(e) => handleStepChange(index, 'model', e.target.value || undefined)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                    fontSize: 12
                  }}
                >
                  <option value="">默认模型</option>
                  {(modelsByAgent[step.agentType || 'mimo'] || []).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>

                <input
                  type="number"
                  value={Math.floor(step.timeout / 1000)}
                  onChange={(e) => handleStepChange(index, 'timeout', parseInt(e.target.value) * 1000 || 60000)}
                  placeholder="超时(秒)"
                  min={10}
                  style={{
                    width: 80,
                    padding: '6px 8px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                    fontSize: 12
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Settings */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16
        }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 500,
              marginBottom: 4,
              color: 'var(--text-secondary)'
            }}>
              最大迭代次数
            </label>
            <input
              type="number"
              value={maxIterations}
              onChange={(e) => setMaxIterations(parseInt(e.target.value) || 10)}
              min={1}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                fontSize: 12
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 500,
              marginBottom: 4,
              color: 'var(--text-secondary)'
            }}>
              迭代间延迟(秒)
            </label>
            <input
              type="number"
              value={Math.floor(delayBetweenIterations / 1000)}
              onChange={(e) => setDelayBetweenIterations(parseInt(e.target.value) * 1000 || 0)}
              min={0}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                fontSize: 12
              }}
            />
          </div>
        </div>

        {/* Exit Condition */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 4,
            color: 'var(--text-secondary)'
          }}>
            退出条件
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select
              value={exitConditionType}
              onChange={(e) => setExitConditionType(e.target.value as any)}
              style={{
                width: 120,
                padding: '6px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                fontSize: 12
              }}
            >
              <option value="custom">自定义</option>
              <option value="success">成功时退出</option>
              <option value="failure">失败时退出</option>
            </select>
            <input
              type="text"
              value={exitCondition}
              onChange={(e) => setExitCondition(e.target.value)}
              placeholder="例如：所有测试通过"
              style={{
                flex: 1,
                padding: '6px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                fontSize: 12
              }}
            />
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export default LoopEditor
