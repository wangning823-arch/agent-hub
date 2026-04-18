import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function ContextManager({ sessionId, onClose }) {
  const [contextInfo, setContextInfo] = useState(null)
  const [tokenStats, setTokenStats] = useState(null)
  const [loading, setLoading] = useState(false)

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
      alert('已发送压缩命令')
      setTimeout(loadContextInfo, 1000)
    } catch (error) {
      alert('压缩失败: ' + error.message)
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
      alert('清除失败: ' + error.message)
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
      <div className="bg-gray-900 rounded-lg w-full max-w-md overflow-hidden shadow-2xl border border-gray-700">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">📊 上下文与Token</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-4">
          {/* 上下文信息 */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">💬 上下文信息</h3>
            {contextInfo ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">消息数量</span>
                  <span className="text-white">{contextInfo.messageCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">预估Token</span>
                  <span className="text-white">~{formatTokens(contextInfo.estimatedTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">对话ID</span>
                  <span className="text-white text-xs truncate max-w-[150px]">
                    {contextInfo.conversationId || '无'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">状态</span>
                  <span className={contextInfo.isActive ? 'text-green-400' : 'text-yellow-400'}>
                    {contextInfo.isActive ? '活跃' : '未激活'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">加载中...</div>
            )}

            {/* 上下文操作 */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleCompact}
                disabled={loading}
                className="flex-1 px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 text-sm"
              >
                {loading ? '处理中...' : '🗜️ 压缩上下文'}
              </button>
              <button
                onClick={loadContextInfo}
                className="px-3 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm"
              >
                🔄
              </button>
            </div>
          </div>

          {/* Token统计 */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">🪙 Token统计</h3>
            {tokenStats ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">输入Token</span>
                  <span className="text-white">{formatTokens(tokenStats.totalInputTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">输出Token</span>
                  <span className="text-white">{formatTokens(tokenStats.totalOutputTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">缓存读取</span>
                  <span className="text-blue-400">{formatTokens(tokenStats.totalCacheReadTokens)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">缓存写入</span>
                  <span className="text-purple-400">{formatTokens(tokenStats.totalCacheWriteTokens)}</span>
                </div>
                <div className="border-t border-gray-700 my-2" />
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">总费用</span>
                  <span className="text-green-400 font-medium">{formatCost(tokenStats.totalCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">消息次数</span>
                  <span className="text-white">{tokenStats.messageCount}</span>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">加载中...</div>
            )}

            {/* Token操作 */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleClearStats}
                className="flex-1 px-3 py-2 bg-red-600/50 text-red-300 rounded hover:bg-red-600 text-sm"
              >
                🗑️ 清除统计
              </button>
              <button
                onClick={loadTokenStats}
                className="px-3 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm"
              >
                🔄
              </button>
            </div>
          </div>

          {/* 使用提示 */}
          <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-500">
            <p>💡 <strong>压缩上下文</strong>可以减少token使用，但可能丢失一些对话历史</p>
            <p className="mt-1">💡 <strong>缓存读取</strong>不计入费用，是Claude的提示缓存功能</p>
          </div>
        </div>
      </div>
    </div>
  )
}
