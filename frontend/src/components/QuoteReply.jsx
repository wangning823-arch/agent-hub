import React from 'react'

export default function QuoteReply({ quote, onRemove }) {
  if (!quote) return null

  const { role, content, timestamp } = quote
  const isUser = role === 'user'

  // 截取内容预览
  const preview = typeof content === 'string' 
    ? (content.length > 100 ? content.slice(0, 100) + '...' : content)
    : JSON.stringify(content).slice(0, 100) + '...'

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-gray-800/50 border-l-4 border-blue-500 rounded-r-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            isUser ? 'bg-blue-900/50 text-blue-400' : 'bg-gray-700 text-gray-400'
          }`}>
            {isUser ? '你' : '助手'}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </div>
        <p className="text-sm text-gray-400 truncate">{preview}</p>
      </div>
      <button
        onClick={onRemove}
        className="p-1 text-gray-500 hover:text-white hover:bg-gray-700 rounded"
        title="取消引用"
      >
        ✕
      </button>
    </div>
  )
}
