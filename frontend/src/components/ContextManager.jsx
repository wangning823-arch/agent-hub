import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'

const API_BASE = '/api'

export default function ContextManager({ sessionId, onClose }) {
  const [contextInfo, setContextInfo] = useState(null)
  const [tokenStats, setTokenStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (sessionId) {
      loadContextInfo()
      loadTokenStats()
    }
  }, [sessionId])

  const loadContextInfo = async () => {
    try {
      const data = await fetch(`${API_BASE}/sessions/${sessionId}/context`).then(r => r.json())
      setContextInfo(data)
    } catch (error) {
      console.error('加载上下文信息失败:', error)
    }
  }

  const loadTokenStats = async () => {
    try {
      const data = await fetch(`${API_BASE}/tokens/${sessionId}`).then(r => r.json())
      setTokenStats(data)
    } catch (error) {
      console.error('加载Token统计失败:', error)
    }
  }

  const handleCompact = async () => {
    if (!confirm('确定要压缩上下文？这将减少token使用但可能丢失一些对话历史。')) {
      return
    }
    
    setLoading(true)
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}/compact`, { method: 'POST' })
      toast.success('已发送压缩命令')
      setTimeout(loadContextInfo, 1000)
    } catch (error) {
      toast.error('压缩失败: ' + error.message)
    }
    setLoading(false)
  }

  const handleClearStats = async () => {
    if (!confirm('确定要清除Token统计？')) {
      return
    }
    
    try {
      await fetch(`${API_BASE}/tokens/${sessionId}`, { method: 'DELETE' })
      loadTokenStats()
    } catch (error) {
      toast.error('清除失败: ' + error.message)
    }
  }

  const formatTokens = (count) => {
    if (count >= 1000000) return (count / 1000000).toFixed(2) + 'M'
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K'
    return count.toString()
  }

  const formatCost = (cost) => '$' + (cost || 0).toFixed(4)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="rounded-lg w-full max-w-md overflow-hidden shadow-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>📊 上下文与Token</h2>
          <button
            onClick={onClose}
            className="text-xl"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-4">
          {/* 上下文信息 */}
          <div className="rounded-lg p-4" style={{ background: 'var(--bg-tertiary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>💬 上下文信息</h3>
            {contextInfo ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>消息数量</span>
                  <span style={{ color: 'var(--text-primary)' }}>{contextInfo.messageCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>预估Token</span>
                  <span style={{ color: 'var(--text-primary)' }}>~{formatTokens(contextInfo.estimatedTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>对话ID</span>
                  <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--text-primary)' }}>
                    {contextInfo.conversationId || '无'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>状态</span>
                  <span style={{ color: contextInfo.isActive ? 'var(--success)' : 'var(--warning)' }}>
                    {contextInfo.isActive ? '活跃' : '未激活'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</div>
            )}

            {/* 上下文操作 */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleCompact}
                disabled={loading}
                className="flex-1 px-3 py-2 rounded disabled:opacity-50 text-sm"
                style={{ background: 'var(--warning)', color: '#fff' }}
              >
                {loading ? '处理中...' : '🗜️ 压缩上下文'}
              </button>
              <button
                onClick={loadContextInfo}
                className="px-3 py-2 rounded text-sm"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                🔄
              </button>
            </div>
          </div>

          {/* Token统计 */}
          <div className="rounded-lg p-4" style={{ background: 'var(--bg-tertiary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>🪙 Token统计</h3>
            {tokenStats ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>输入Token</span>
                  <span style={{ color: 'var(--text-primary)' }}>{formatTokens(tokenStats.totalInputTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>输出Token</span>
                  <span style={{ color: 'var(--text-primary)' }}>{formatTokens(tokenStats.totalOutputTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>缓存读取</span>
                  <span style={{ color: 'var(--accent-secondary)' }}>{formatTokens(tokenStats.totalCacheReadTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>缓存写入</span>
                  <span style={{ color: 'var(--accent-primary)' }}>{formatTokens(tokenStats.totalCacheWriteTokens)}</span>
                </div>
                <div className="my-2" style={{ borderTop: '1px solid var(--border-subtle)' }} />
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>总费用</span>
                  <span style={{ color: 'var(--success)', fontWeight: 'medium' }}>{formatCost(tokenStats.totalCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>消息次数</span>
                  <span style={{ color: 'var(--text-primary)' }}>{tokenStats.messageCount}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</div>
            )}

            {/* Token操作 */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleClearStats}
                className="flex-1 px-3 py-2 rounded text-sm"
                style={{ background: 'var(--error-soft)', color: 'var(--error)' }}
              >
                🗑️ 清除统计
              </button>
              <button
                onClick={loadTokenStats}
                className="px-3 py-2 rounded text-sm"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                🔄
              </button>
            </div>
          </div>

          {/* 使用提示 */}
          <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
            <p>💡 <strong style={{ color: 'var(--text-secondary)' }}>压缩上下文</strong>可以减少token使用，但可能丢失一些对话历史</p>
            <p className="mt-1">💡 <strong style={{ color: 'var(--text-secondary)' }}>缓存读取</strong>不计入费用，是Claude的提示缓存功能</p>
          </div>
        </div>
      </div>
    </div>
  )
}
