import React, { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'

// ---- 类型定义 ----

interface SearchPanelProps {
  onSelectSession: (sessionId: string) => void
  onClose: () => void
}

interface MessageResult {
  sessionId: string
  sessionTitle: string
  snippet: string
  role: string
  timestamp: number
  matchCount: number
}

interface SessionResult {
  id: string
  title: string
  workdir: string
  isPinned: boolean
  messageCount: number
  lastMessageAt: number
}

type SearchResult = MessageResult | SessionResult

type SearchType = 'messages' | 'sessions'

export default function SearchPanel({ onSelectSession, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<SearchType>('messages')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 防抖搜索
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      setResults([])
      setTotal(0)
      return
    }

    debounceRef.current = setTimeout(() => {
      performSearch()
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, searchType])

  const performSearch = async () => {
    if (!query.trim()) return

    setLoading(true)
    try {
      const endpoint = searchType === 'messages'
        ? `/search/messages?query=${encodeURIComponent(query)}`
        : `/search/sessions?query=${encodeURIComponent(query)}`

      const data = await fetch(`${API_BASE}${endpoint}`).then(r => r.json())
      setResults(data.results || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error('搜索失败:', error)
      setResults([])
    }
    setLoading(false)
  }

  // 高亮匹配文本
  const highlightMatch = (text: string, queryStr: string): React.ReactNode => {
    if (!queryStr.trim()) return text

    const regex = new RegExp(`(${queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part: string, i: number) =>
      regex.test(part) ? (
        <span key={i} className="bg-yellow-500/30 text-yellow-300">{part}</span>
      ) : part
    )
  }

  // 格式化时间
  const formatTime = (timestamp: number): string => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`

    return date.toLocaleDateString('zh-CN')
  }

  const handleResultClick = (result: SearchResult) => {
    if (searchType === 'messages') {
      onSelectSession((result as MessageResult).sessionId)
    } else {
      onSelectSession((result as SessionResult).id)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
        {/* 搜索框 */}
        <div className="p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <span style={{ color: 'var(--text-muted)' }}>🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索消息或会话..."
              className="flex-1 bg-transparent text-lg outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
            >
              ✕
            </button>
          </div>

          {/* 搜索类型切换 */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setSearchType('messages')}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{
                background: searchType === 'messages' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: searchType === 'messages' ? 'white' : 'var(--text-muted)'
              }}
            >
              💬 消息
            </button>
            <button
              onClick={() => setSearchType('sessions')}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{
                background: searchType === 'sessions' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: searchType === 'sessions' ? 'white' : 'var(--text-muted)'
              }}
            >
              📁 会话
            </button>
          </div>
        </div>

        {/* 搜索结果 */}
        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
              <div className="animate-spin text-2xl mb-2">⏳</div>
              搜索中...
            </div>
          ) : !query.trim() ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
              输入关键词开始搜索
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
              没有找到匹配的结果
            </div>
          ) : (
            <div>
              {results.map((result, idx) => (
                <div
                  key={idx}
                  onClick={() => handleResultClick(result)}
                  className="p-4 cursor-pointer transition-colors"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {searchType === 'messages' ? (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm" style={{ color: 'var(--accent-primary)' }}>{(result as MessageResult).sessionTitle}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatTime((result as MessageResult).timestamp)}</span>
                      </div>
                      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded mr-2`}
                          style={{
                            background: (result as MessageResult).role === 'user' ? 'var(--accent-primary-soft)' : 'var(--bg-tertiary)',
                            color: (result as MessageResult).role === 'user' ? 'var(--accent-primary)' : 'var(--text-muted)'
                          }}>
                          {(result as MessageResult).role === 'user' ? '用户' : '助手'}
                        </span>
                        {highlightMatch((result as MessageResult).snippet, query)}
                      </div>
                      {(result as MessageResult).matchCount > 1 && (
                        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          {(result as MessageResult).matchCount} 处匹配
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {(result as SessionResult).isPinned && <span>📌</span>}
                        <span style={{ color: 'var(--text-primary)' }}>{highlightMatch((result as SessionResult).title, query)}</span>
                      </div>
                      <div className="text-sm mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
                        {highlightMatch((result as SessionResult).workdir, query)}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span>{(result as SessionResult).messageCount} 条消息</span>
                        <span>{formatTime((result as SessionResult).lastMessageAt)}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        {query.trim() && !loading && (
          <div className="px-4 py-2 text-xs flex items-center justify-between" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span>{total} 个结果</span>
            <span>ESC 关闭</span>
          </div>
        )}
      </div>
    </div>
  )
}
