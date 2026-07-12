import React, { useState, useEffect } from 'react'
import LoopPanel from './LoopPanel'
import LoopEditor from './LoopEditor'

interface LoopStepDef {
  id: string
  name: string
  prompt: string
  agentType?: string
  model?: string
  timeout: number
}

interface LoopDefinition {
  id: string
  name: string
  description: string
  steps: LoopStepDef[]
  maxIterations: number
  exitCondition?: string
  exitConditionType?: 'success' | 'failure' | 'custom'
  delayBetweenIterations: number
  createdAt: number
  updatedAt: number
}

interface LoopIteration {
  index: number
  status: string
  startedAt: number | null
  completedAt: number | null
  results: any[]
  error?: string
}

interface LoopRun {
  id: string
  defId: string
  name: string
  status: string
  currentIteration: number
  maxIterations: number
  iterations: LoopIteration[]
  startedAt: number | null
  completedAt: number | null
  createdAt: number
}

interface LoopListPanelProps {
  sessionId: string
}

const LoopListPanel: React.FC<LoopListPanelProps> = ({ sessionId }) => {
  const [definitions, setDefinitions] = useState<LoopDefinition[]>([])
  const [runs, setRuns] = useState<LoopRun[]>([])
  const [showEditor, setShowEditor] = useState(false)
  const [editingDef, setEditingDef] = useState<LoopDefinition | null>(null)
  const [loading, setLoading] = useState(false)

  const authHeaders = () => {
    const token = localStorage.getItem('access_token') || ''
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }

  const fetchDefinitions = async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/loop-defs`, {
        headers: authHeaders()
      })
      const data = await response.json()
      setDefinitions(data.defs || [])
    } catch (error) {
      console.error('获取循环定义失败:', error)
    }
  }

  const fetchRuns = async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/loops`, {
        headers: authHeaders()
      })
      const data = await response.json()
      setRuns(data.loops || [])
    } catch (error) {
      console.error('获取循环运行失败:', error)
    }
  }

  useEffect(() => {
    fetchDefinitions()
    fetchRuns()
  }, [sessionId])

  const handleCreate = () => {
    setEditingDef(null)
    setShowEditor(true)
  }

  const handleEdit = (def: LoopDefinition) => {
    setEditingDef(def)
    setShowEditor(true)
  }

  const handleSave = async (def: LoopDefinition) => {
    setLoading(true)
    try {
      const url = def.id
        ? `/api/sessions/${sessionId}/loop-defs/${def.id}`
        : `/api/sessions/${sessionId}/loop-defs`
      const method = def.id ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(def)
      })

      if (response.ok) {
        setShowEditor(false)
        setEditingDef(null)
        fetchDefinitions()
      } else {
        const error = await response.json()
        alert(error.error || '保存失败')
      }
    } catch (error) {
      alert('保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (defId: string) => {
    if (!confirm('确定要删除这个循环定义吗？')) return

    try {
      const response = await fetch(`/api/sessions/${sessionId}/loop-defs/${defId}`, {
        method: 'DELETE',
        headers: authHeaders()
      })

      if (response.ok) {
        fetchDefinitions()
      }
    } catch (error) {
      alert('删除失败')
    }
  }

  const handleLaunch = async (defId: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/loops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ defId })
      })

      if (response.ok) {
        fetchRuns()
      } else {
        const error = await response.json()
        alert(error.error || '启动失败')
      }
    } catch (error) {
      alert('启动失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePause = async (loopId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/loops/${loopId}/pause`, {
        method: 'POST',
        headers: authHeaders()
      })
      fetchRuns()
    } catch (error) {
      alert('暂停失败')
    }
  }

  const handleCancel = async (loopId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/loops/${loopId}/cancel`, {
        method: 'POST',
        headers: authHeaders()
      })
      fetchRuns()
    } catch (error) {
      alert('取消失败')
    }
  }

  const handleRetry = async (loopId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/loops/${loopId}/retry`, {
        method: 'POST',
        headers: authHeaders()
      })
      fetchRuns()
    } catch (error) {
      alert('重试失败')
    }
  }

  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'paused')
  const completedRuns = runs.filter(r => r.status !== 'running' && r.status !== 'paused')

  return (
    <div style={{
      padding: 16,
      height: '100%',
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16
      }}>
        <h3 style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--text-primary)'
        }}>
          循环管理
        </h3>
        <button
          onClick={handleCreate}
          style={{
            padding: '6px 12px',
            background: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12
          }}
        >
          + 创建循环
        </button>
      </div>

      {/* Definitions */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{
          margin: '0 0 8px 0',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--text-secondary)'
        }}>
          循环定义
        </h4>
        {definitions.length === 0 ? (
          <div style={{
            padding: 16,
            background: 'var(--bg-secondary)',
            borderRadius: 4,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 12
          }}>
            暂无循环定义
          </div>
        ) : (
          definitions.map((def) => (
            <div
              key={def.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--bg-secondary)',
                borderRadius: 4,
                marginBottom: 4
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {def.name}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-muted)'
                }}>
                  {def.steps.length} 步骤 · 最多 {def.maxIterations} 次迭代
                </div>
              </div>
              <button
                onClick={() => handleLaunch(def.id)}
                disabled={loading}
                style={{
                  padding: '4px 8px',
                  background: 'var(--success, #22c55e)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  opacity: loading ? 0.5 : 1
                }}
              >
                启动
              </button>
              <button
                onClick={() => handleEdit(def)}
                style={{
                  padding: '4px 8px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11
                }}
              >
                编辑
              </button>
              <button
                onClick={() => handleDelete(def.id)}
                style={{
                  padding: '4px 8px',
                  background: 'none',
                  color: 'var(--error, #ef4444)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11
                }}
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>

      {/* Active Runs */}
      {activeRuns.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{
            margin: '0 0 8px 0',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text-secondary)'
          }}>
            运行中的循环
          </h4>
          {activeRuns.map((run) => (
            <LoopPanel
              key={run.id}
              loop={run}
              onPause={handlePause}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onClose={() => {}}
            />
          ))}
        </div>
      )}

      {/* Completed Runs */}
      {completedRuns.length > 0 && (
        <div>
          <h4 style={{
            margin: '0 0 8px 0',
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text-secondary)'
          }}>
            历史记录
          </h4>
          {completedRuns.slice(0, 10).map((run) => (
            <LoopPanel
              key={run.id}
              loop={run}
              onPause={handlePause}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onClose={() => {}}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <LoopEditor
          definition={editingDef}
          onSave={handleSave}
          onCancel={() => {
            setShowEditor(false)
            setEditingDef(null)
          }}
        />
      )}
    </div>
  )
}

export default LoopListPanel
