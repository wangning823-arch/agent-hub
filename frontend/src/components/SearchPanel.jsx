import React, { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'

export default function SearchPanel({ onSelectSession, onClose }) {
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState('messages') // messages | sessions
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

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
  const highlightMatch = (text, query) => {
    if (!query.trim()) return text
    
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    
    return parts.map((part, i) => 
      regex.test(part) ? (
        <span key={i} className="bg-yellow-500/30 text-yellow-300">{part}</span>
      ) : part
    )
  }

  // 格式化时间
  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now - date
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
    
    return date.toLocaleDateString('zh-CN')
  }

  const handleResultClick = (result) => {
    if (searchType === 'messages') {
      onSelectSession(result.sessionId)
    } else {
      onSelectSession(result.id)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-20">
      <div className="w-full max-w-2xl bg-gray-900 rounded-xl shadow-2xl border border-gray-800 overflow-hidden">
        {/* 搜索框 */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-gray-400">🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索消息或会话..."
              className="flex-1 bg-transparent text-white text-lg outline-none placeholder-gray-500"
            />
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
            >
              ✕
            </button>
          </div>
          
          {/* 搜索类型切换 */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setSearchType('messages')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                searchType === 'messages'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              💬 消息
            </button>
            <button
              onClick={() => setSearchType('sessions')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                searchType === 'sessions'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              📁 会话
            </button>
          </div>
        </div>

        {/* 搜索结果 */}
        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500">
              <div className="animate-spin text-2xl mb-2">⏳</div>
              搜索中...
            </div>
          ) : !query.trim() ? (
            <div className="p-8 text-center text-gray-500">
              输入关键词开始搜索
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              没有找到匹配的结果
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  onClick={() => handleResultClick(result)}
                  className="p-4 hover:bg-gray-800/50 cursor-pointer transition-colors"
                >
                  {searchType === 'messages' ? (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-blue-400">{result.sessionTitle}</span>
                        <span className="text-xs text-gray-500">{formatTime(result.timestamp)}</span>
                      </div>
                      <div className="text-sm text-gray-300">
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded mr-2 ${
                          result.role === 'user' ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-700 text-gray-400'
                        }`}>
                          {result.role === 'user' ? '用户' : '助手'}
                        </span>
                        {highlightMatch(result.snippet, query)}
                      </div>
                      {result.matchCount > 1 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {result.matchCount} 处匹配
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {result.isPinned && <span className="text-yellow-500">📌</span>}
                        <span className="text-white">{highlightMatch(result.title, query)}</span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1 truncate">
                        {highlightMatch(result.workdir, query)}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{result.messageCount} 条消息</span>
                        <span>{formatTime(result.lastMessageAt)}</span>
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
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500 flex items-center justify-between">
            <span>{total} 个结果</span>
            <span>ESC 关闭</span>
          </div>
        )}
      </div>
    </div>
  )
}
