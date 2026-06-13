/**
 * GoalStatusBar - 目标监控状态栏
 * 显示在聊天面板顶部，展示监控状态和进度
 */
import React, { useState, useEffect } from 'react'
import { API_BASE } from '../config'
import { Target, RotateCw, CheckCircle, XCircle, Trash2, Settings } from 'lucide-react'

interface Goal {
  id: string
  sessionId: string
  originalPrompt: string
  status: 'active' | 'completed' | 'cancelled' | 'error'
  attemptCount: number
  maxAttempts: number
  progress: string
  startedAt: number
  lastAttemptAt: number
  completedAt?: number
  error?: string
  agentType: string
  workdir: string
}

interface GoalStatusBarProps {
  sessionId: string
  onGoalUpdate?: (goal: Goal | null) => void
}

export default function GoalStatusBar({ sessionId, onGoalUpdate }: GoalStatusBarProps) {
  const [goal, setGoal] = useState<Goal | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [newPrompt, setNewPrompt] = useState('')
  const [maxAttempts, setMaxAttempts] = useState(10)
  const [loading, setLoading] = useState(false)

  // 加载当前会话的目标
  useEffect(() => {
    loadGoal()
  }, [sessionId])

  // 监听 WebSocket 的 goal_status 消息
  useEffect(() => {
    const handleWsMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'goal_status' && msg.goal) {
          setGoal(msg.goal)
          if (msg.goal.status === 'active') {
            sessionStorage.removeItem(`goal_dismissed_${sessionId}`)
          }
          onGoalUpdate?.(msg.goal)
        }
      } catch (e) {}
    }

    // 这里需要从父组件获取 WebSocket 连接
    // 暂时使用轮询
    const interval = setInterval(loadGoal, 5000)
    return () => clearInterval(interval)
  }, [sessionId])

  const loadGoal = async () => {
    if (sessionStorage.getItem(`goal_dismissed_${sessionId}`) === '1') return
    try {
      const token = localStorage.getItem('access_token') || ''
      const res = await fetch(`${API_BASE}/goals/session/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setGoal(data)
        onGoalUpdate?.(data)
      }
    } catch (e) {}
  }

  const createGoal = async () => {
    if (!newPrompt.trim()) return
    setLoading(true)
    try {
      const token = localStorage.getItem('access_token') || ''
      console.log('[GoalStatusBar] 创建目标:', { sessionId, originalPrompt: newPrompt, maxAttempts })
      console.log('[GoalStatusBar] Token:', token ? '存在' : '不存在')
      
      const res = await fetch(`${API_BASE}/goals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          sessionId,
          originalPrompt: newPrompt,
          maxAttempts
        })
      })
      
      console.log('[GoalStatusBar] 响应状态:', res.status)
      
      if (res.ok) {
        const data = await res.json()
        console.log('[GoalStatusBar] 创建成功:', data)
        setGoal(data)
        sessionStorage.removeItem(`goal_dismissed_${sessionId}`)
        setShowCreateModal(false)
        setNewPrompt('')
      } else {
        const error = await res.json()
        console.error('[GoalStatusBar] 创建失败:', error)
      }
    } catch (e) {
      console.error('[GoalStatusBar] 网络错误:', e)
    }
    setLoading(false)
  }

  const cancelGoal = async () => {
    if (!goal) return
    setLoading(true)
    try {
      const token = localStorage.getItem('access_token') || ''
      await fetch(`${API_BASE}/goals/${goal.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setGoal(null)
    } catch (e) {}
    setLoading(false)
  }

  const updateMaxAttempts = async () => {
    if (!goal) return
    setLoading(true)
    try {
      const token = localStorage.getItem('access_token') || ''
      await fetch(`${API_BASE}/goals/${goal.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ maxAttempts })
      })
      setGoal({ ...goal, maxAttempts })
      setShowSettings(false)
    } catch (e) {}
    setLoading(false)
  }

  // 如果没有活跃目标，显示创建按钮
  if (!goal || goal.status === 'cancelled') {
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
          <Target size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>目标监控</span>
          <button
            onClick={() => setShowCreateModal(true)}
            className="ml-auto text-xs px-2 py-1 rounded"
            style={{ background: 'var(--accent-primary)', color: 'white' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-primary-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent-primary)'}
          >
            启动监控
          </button>
        </div>

        {showCreateModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="rounded-lg p-4 w-full max-w-4xl max-h-[80vh] overflow-auto mx-4" style={{ background: 'var(--bg-elevated)' }}>
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>启动目标监控</h3>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                输入任务描述，agent 会在聊天窗口中执行并显示输出。当 agent 意外退出时自动重启继续。
              </p>
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="请输入任务描述，例如：重构 src/utils.ts 中的函数..."
                className="w-full h-40 px-3 py-2 text-sm rounded-lg resize-y"
                style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              />
              <div className="flex items-center gap-2 mt-3">
                <label className="text-xs" style={{ color: 'var(--text-muted)' }}>最大重试次数:</label>
                <input
                  type="number"
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(parseInt(e.target.value) || 10)}
                  min={1}
                  max={100}
                  className="w-16 px-2 py-1 text-sm rounded"
                  style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs rounded"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  取消
                </button>
                <button
                  onClick={createGoal}
                  disabled={loading || !newPrompt.trim()}
                  className="px-3 py-1.5 text-xs rounded"
                  style={{ background: 'var(--accent-primary)', color: 'white', opacity: loading || !newPrompt.trim() ? 0.5 : 1 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-primary-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent-primary)'}
                >
                  {loading ? '创建中...' : '启动'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // 渲染状态图标
  const renderStatusIcon = () => {
    switch (goal.status) {
      case 'active':
        return <RotateCw size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
      case 'completed':
        return <CheckCircle size={14} style={{ color: 'var(--success)' }} />
      case 'error':
        return <XCircle size={14} style={{ color: 'var(--error)' }} />
      default:
        return <Target size={14} style={{ color: 'var(--text-muted)' }} />
    }
  }

  // 渲染状态文本
  const renderStatusText = () => {
    switch (goal.status) {
      case 'active':
        return `监控中 (第${goal.attemptCount}/${goal.maxAttempts}次尝试)`
      case 'completed':
        return '任务已完成'
      case 'error':
        return `失败: ${goal.error || '未知错误'}`
      case 'cancelled':
        return '已取消'
      default:
        return '未知状态'
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ background: 'var(--accent-primary-soft)', borderColor: 'var(--accent-primary)' }}>
      {renderStatusIcon()}
      <span className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>
        {renderStatusText()}
      </span>
      {goal.status === 'active' && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          · 输出在聊天窗口
        </span>
      )}
      {goal.status === 'active' && (
        <>
          <span className="text-xs truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }} title={goal.originalPrompt}>
            {goal.originalPrompt}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 rounded"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-primary-soft)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              title="设置"
            >
              <Settings size={12} />
            </button>
            <button
              onClick={cancelGoal}
              disabled={loading}
              className="p-1 rounded"
              style={{ color: 'var(--error)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--error-soft)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              title="取消监控"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </>
      )}
      {goal.status === 'completed' && (
        <button
          onClick={() => { sessionStorage.setItem(`goal_dismissed_${sessionId}`, '1'); setGoal(null) }}
          className="ml-auto text-xs"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          关闭
        </button>
      )}

      {showSettings && goal.status === 'active' && (
        <div className="absolute top-full left-0 right-0 p-3 shadow-lg z-10" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)' }}>
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>最大重试次数:</label>
            <input
              type="number"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(parseInt(e.target.value) || 10)}
              min={1}
              max={100}
              className="w-16 px-2 py-1 text-sm rounded"
              style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={updateMaxAttempts}
              disabled={loading}
              className="px-2 py-1 text-xs rounded"
              style={{ background: 'var(--accent-primary)', color: 'white' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-primary-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent-primary)'}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
