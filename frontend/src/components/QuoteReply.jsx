import React from 'react'

export default function QuoteReply({ quote, onRemove }) {
  if (!quote) return null
  const { role, content, timestamp } = quote
  const isUser = role === 'user'
  const preview = typeof content === 'string'
    ? (content.length > 100 ? content.slice(0, 100) + '...' : content)
    : JSON.stringify(content).slice(0, 100) + '...'

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-r-lg"
      style={{ background: 'var(--bg-tertiary)', borderLeft: `3px solid var(--accent-primary)` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: isUser ? 'var(--accent-primary-soft)' : 'var(--bg-hover)',
              color: isUser ? 'var(--accent-primary)' : 'var(--text-muted)',
            }}>
            {isUser ? '你' : '助手'}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{preview}</p>
      </div>
      <button onClick={onRemove} className="btn-icon w-6 h-6 text-xs" title="取消引用">✕</button>
    </div>
  )
}
