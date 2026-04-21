import React, { useState, useEffect, useRef, useCallback } from 'react'
import Message from './Message'
import QuoteReply from './QuoteReply'
import { useToast } from './Toast'
import { useNotification } from '../hooks/useNotification'
import { API_BASE, getWebSocketUrl } from '../config'

export default function ChatPanel({ sessionId, agentType = 'claude-code', options = {}, onOptionsChange, onWorkingChange, onStartingChange, isWorking = false, isStarting = false }) {
  const toast = useToast()
  const notification = useNotification()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  
  // 分页状态
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [messageOffset, setMessageOffset] = useState(0)
  const PAGE_SIZE = 50
  
  // 引用回复状态
  const [quoteReply, setQuoteReply] = useState(null)
  
  // 模型和模式选项
  const [modes, setModes] = useState([])
  const [models, setModels] = useState([])
  const [efforts, setEfforts] = useState([])
  const [currentMode, setCurrentMode] = useState(options?.mode || 'auto')
  const [currentModel, setCurrentModel] = useState(options?.model || '')
  const [currentEffort, setCurrentEffort] = useState(options?.effort || 'medium')

  // 当 options prop 变化时（切换session），同步更新内部状态
  useEffect(() => {
    if (options?.mode) setCurrentMode(options.mode)
    if (options?.model) setCurrentModel(options.model)
    if (options?.effort) setCurrentEffort(options.effort)
  }, [options?.mode, options?.model, options?.effort])

  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  // 加载选项
  useEffect(() => {
    loadOptions()
  }, [agentType])

  const loadOptions = async () => {
    try {
      const data = await fetch(`${API_BASE}/options?agentType=${agentType}`).then(r => r.json())
      setModes(data.modes || [])
      setModels(data.models || [])
      setEfforts(data.efforts || [])
    } catch (error) {
      console.error('加载选项失败:', error)
    }
  }

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 加载更多历史消息
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore) return
    
    setLoadingMore(true)
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages?limit=${PAGE_SIZE}&offset=${messageOffset}`)
      const data = await response.json()
      
      if (data.messages && data.messages.length > 0) {
        const formattedMessages = data.messages.map(msg => {
          let displayContent
          let displayType = msg.role === 'user' ? 'user' : 'assistant'
          
          if (msg.role === 'user') {
            displayContent = msg.content
          } else if (typeof msg.content === 'object' && msg.content !== null) {
            displayType = msg.content.type || 'assistant'
            const rawContent = msg.content.content
            if (rawContent === '{}' || rawContent === '' || !rawContent) {
              displayContent = ''
            } else {
              displayContent = rawContent
            }
          } else {
            displayContent = msg.content
          }
          
          return {
            type: displayType,
            content: displayContent,
            timestamp: msg.time
          }
        })
        
        // 将新加载的消息添加到列表前面（过滤掉工具调用和空消息）
        const filtered = formattedMessages.filter(msg => {
          const content = msg.content
          const contentType = typeof content === 'object' && content !== null ? content.type : null
          if (contentType === 'tool_use' || contentType === 'tool_result') return false
          if (msg.type === 'tool_use' || msg.type === 'tool_result') return false
          if (typeof content === 'string' && (content === '{}' || content.trim() === '')) return false
          if (typeof content === 'object' && (content === null || Object.keys(content).length === 0)) return false
          return true
        })
        setMessages(prev => [...filtered, ...prev])
        setMessageOffset(prev => Math.max(0, prev - PAGE_SIZE))
        
        if (data.messages.length < PAGE_SIZE || messageOffset <= 0) {
          setHasMore(false)
        }
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('加载更多消息失败:', error)
      toast.error('加载更多消息失败')
    }
    setLoadingMore(false)
  }

  // WebSocket连接
  useEffect(() => {
    // Clear old messages when switching sessions
    setMessages([])

    // 加载历史消息
    const loadHistory = async () => {
      try {
        const data = await fetch(`${API_BASE}/sessions/${sessionId}/messages?limit=${PAGE_SIZE}&offset=0`).then(r => r.json())
        if (data.messages && data.messages.length > 0) {
          const formattedMessages = data.messages.map(msg => {
            // 用户消息: msg.content 是字符串
            // 助手消息: msg.content 是 { type: 'text', content: '...' } 等结构
            let displayContent
            let displayType = msg.role === 'user' ? 'user' : 'assistant'
            
            if (msg.role === 'user') {
              displayContent = msg.content
            } else if (typeof msg.content === 'object' && msg.content !== null) {
              displayType = msg.content.type || 'assistant'
              const rawContent = msg.content.content
              if (rawContent === '{}' || rawContent === '' || !rawContent) {
                displayContent = ''
              } else {
                displayContent = rawContent
              }
            } else {
              displayContent = msg.content
            }
            
            return {
              type: displayType,
              content: displayContent,
              timestamp: msg.time
            }
          })
          // 过滤掉工具调用历史记录和空消息
          const filteredMessages = formattedMessages.filter(msg => {
            const content = msg.content
            const contentType = typeof content === 'object' && content !== null ? content.type : null
            if (contentType === 'tool_use' || contentType === 'tool_result') return false
            if (msg.type === 'tool_use' || msg.type === 'tool_result') return false
            if (typeof content === 'string' && (content === '{}' || content.trim() === '')) return false
            if (typeof content === 'object' && (content === null || Object.keys(content).length === 0)) return false
            return true
          })
          setMessages(filteredMessages)
          setHasMore(data.messages.length >= PAGE_SIZE)
          setMessageOffset(formattedMessages.length)
        } else {
          setMessages([])
          setHasMore(false)
        }
      } catch (error) {
        console.error('加载历史消息失败:', error)
        toast.error('加载历史消息失败')
      }
    }

    loadHistory()

    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    let reconnectTimeout = null
    let isCleanedUp = false

    const connectWebSocket = () => {
      if (isCleanedUp) return // 已清理，不再创建新连接
      
      // 先关闭已有连接
      if (wsRef.current) {
        wsRef.current.close()
      }
      
      const wsUrl = getWebSocketUrl(sessionId)
      setConnecting(true)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setConnecting(false)
        reconnectAttempts = 0 // 重置重连计数
        console.log('WebSocket已连接')
        
        // 显示连接成功提示
        if (reconnectAttempts > 0) {
          setMessages(prev => [...prev, { 
            type: 'status', 
            content: '✅ 已重新连接到服务器' 
          }])
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          
          // 处理工具调用消息的合并逻辑
          if (msg.type === 'tool_use' || msg.type === 'tool_result') {
            setMessages(prev => {
              // 统计总 tool_use 数量
              let totalToolCalls = 0
              for (const m of prev) {
                if (m.type === 'tool_use') totalToolCalls++
              }
              if (msg.type === 'tool_use') totalToolCalls++

              if (msg.type === 'tool_use') {
                // 从后往前找最近的 tool_use（跳过助手文本和 status 消息）
                let toolSlotIdx = -1
                for (let i = prev.length - 1; i >= 0; i--) {
                  const t = prev[i].type
                  if (t === 'tool_use') {
                    toolSlotIdx = i
                    break
                  }
                  // 遇到用户消息或错误，说明是新响应，没有工具槽
                  if (t === 'user' || t === 'error') {
                    break
                  }
                  // tool_result、status、text 都不打断，继续往前找
                }

                if (toolSlotIdx >= 0) {
                  // 替换已有的工具消息
                  const newMessages = [...prev]
                  newMessages[toolSlotIdx] = { ...msg, toolCount: totalToolCalls, replace: true }
                  return newMessages
                } else {
                  // 新的工具调用，添加
                  return [...prev, { ...msg, toolCount: totalToolCalls, replace: false }]
                }
              } else {
                // tool_result: 不单独显示，直接丢弃
                return prev
              }
            })
          } else {
            // 内部状态消息：不显示在聊天中
            if (msg.type === 'status' && (msg.content === 'task_started' || msg.content === 'task_done')) {
              if (onWorkingChange) {
                onWorkingChange(msg.content === 'task_started')
              }
            } else if (msg.type === 'status' && (msg.content === 'agent_starting' || msg.content === 'agent_started')) {
              if (onStartingChange) {
                onStartingChange(msg.content === 'agent_starting')
              }
            } else {
              // 非工具调用消息正常添加
              setMessages(prev => [...prev, msg])
            }
          }
          
          // 处理对话ID保存
          if (msg.type === 'conversation_id' && msg.conversationId) {
            fetch(`${API_BASE}/sessions/${sessionId}/conversation`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationId: msg.conversationId })
            }).catch(err => console.error('保存对话ID失败:', err))
          }
          
          // 处理Token统计
          if (msg.type === 'token_usage' && msg.content) {
            fetch(`${API_BASE}/tokens/${sessionId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ usage: msg.content })
            }).catch(err => console.error('记录Token失败:', err))
          }
          
          // Agent回复时发送通知（如果页面不在前台）
          if (msg.type === 'assistant' && document.hidden) {
            const content = typeof msg.content === 'string' 
              ? msg.content 
              : JSON.stringify(msg.content)
            notification.notifyAgentReply('Agent回复', content)
          }
          
          // 错误消息通知
          if (msg.type === 'error') {
            notification.notifyError(msg.content)
          }
        } catch (e) {
          console.error('解析消息失败:', e)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        console.log('WebSocket已断开')
        
        // 自动重连
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000) // 指数退避，最大30秒
          console.log(`${delay}ms后尝试重连 (${reconnectAttempts + 1}/${maxReconnectAttempts})`)
          
          setMessages(prev => [...prev, { 
            type: 'status', 
            content: `⚠️ 连接断开，${delay/1000}秒后自动重连...` 
          }])
          
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++
            connectWebSocket()
          }, delay)
        } else {
          setMessages(prev => [...prev, { 
            type: 'error', 
            content: '❌ 连接失败，请刷新页面重试' 
          }])
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket错误:', error)
      }
    }

    connectWebSocket()

    return () => {
      isCleanedUp = true
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [sessionId])

  // 更新选项
  const updateOption = (type, value) => {
    if (type === 'mode') setCurrentMode(value)
    if (type === 'model') setCurrentModel(value)
    if (type === 'effort') setCurrentEffort(value)

    // 通过WebSocket发送更新
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        command: `set_${type}`,
        params: { [type]: value }
      }))
    }

    // 通知父组件
    if (onOptionsChange) {
      onOptionsChange({
        mode: type === 'mode' ? value : currentMode,
        model: type === 'model' ? value : currentModel,
        effort: type === 'effort' ? value : currentEffort
      })
    }
  }

  // 监听命令面板发送的消息
  useEffect(() => {
    const handleSendMessage = (e) => {
      if (e.detail?.message) {
        setInput(e.detail.message)
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === 1) {
            setMessages(prev => [...prev, { type: 'user', content: e.detail.message }])
            wsRef.current.send(JSON.stringify({
              type: 'user_input',
              content: e.detail.message
            }))
            setInput('')
          }
        }, 100)
      }
    }

    window.addEventListener('send-message', handleSendMessage)
    return () => window.removeEventListener('send-message', handleSendMessage)
  }, [])

  // 删除消息
  const handleDeleteMessage = async (index) => {
    if (!confirm('确定要删除这条消息吗？')) return
    
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages/${index}`, {
        method: 'DELETE'
      })
      const data = await response.json()
      if (data.success) {
        // 从本地消息列表中移除
        setMessages(prev => prev.filter((_, i) => i !== index))
      }
    } catch (error) {
      console.error('删除消息失败:', error)
      toast.error('删除失败: ' + error.message)
    }
  }


  // 处理剪切板粘贴
  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    const newAttachments = []

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const uploaded = await uploadFile(file)
          if (uploaded) {
            newAttachments.push({
              type: 'image',
              name: file.name || 'pasted-image.png',
              url: uploaded.url,
              size: file.size
            })
          }
        }
      } else if (item.kind === 'file') {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const uploaded = await uploadFile(file)
          if (uploaded) {
            newAttachments.push({
              type: 'file',
              name: file.name,
              url: uploaded.url,
              size: file.size
            })
          }
        }
      }
    }

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments])
    }
  }, [])

  // 上传单个文件
  const uploadFile = async (file) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('files', file)

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      })

      const data = await response.json()
      if (data.success && data.files?.length > 0) {
        return data.files[0]
      }
    } catch (error) {
      console.error('上传失败:', error)
      toast.error('文件上传失败: ' + error.message)
    } finally {
      setUploading(false)
    }
    return null
  }

  // 处理文件选择
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setUploading(true)
    try {
      const formData = new FormData()
      files.forEach(file => formData.append('files', file))

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      })

      const data = await response.json()
      if (data.success && data.files) {
        const newAttachments = data.files.map(file => ({
          type: file.mimetype.startsWith('image/') ? 'image' : 'file',
          name: file.originalName,
          url: file.url,
          size: file.size
        }))
        setAttachments(prev => [...prev, ...newAttachments])
      }
    } catch (error) {
      console.error('上传失败:', error)
      toast.error('文件上传失败: ' + error.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // 处理拖拽
  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)

    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length === 0) return

    setUploading(true)
    try {
      const formData = new FormData()
      files.forEach(file => formData.append('files', file))

      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      })

      const data = await response.json()
      if (data.success && data.files) {
        const newAttachments = data.files.map(file => ({
          type: file.mimetype.startsWith('image/') ? 'image' : 'file',
          name: file.originalName,
          url: file.url,
          size: file.size
        }))
        setAttachments(prev => [...prev, ...newAttachments])
      }
    } catch (error) {
      console.error('上传失败:', error)
      toast.error('文件上传失败: ' + error.message)
    } finally {
      setUploading(false)
    }
  }

  // 移除附件
  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // 发送消息
  const sendMessage = () => {
    if (isWorking || isStarting) return
    if ((!input.trim() && attachments.length === 0) || !wsRef.current || wsRef.current.readyState !== 1) {
      return
    }

    let messageContent = input
    if (attachments.length > 0) {
      const attachmentText = attachments.map(att => {
        if (att.type === 'image') {
          return `[图片: ${att.name}](${att.url})`
        }
        return `[文件: ${att.name}](${att.url})`
      }).join('\n')
      messageContent = input ? `${input}\n\n${attachmentText}` : attachmentText
    }

    setMessages(prev => [...prev, {
      type: 'user',
      content: messageContent,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      quote: quoteReply || undefined
    }])

    wsRef.current.send(JSON.stringify({
      type: 'user_input',
      content: messageContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      quote: quoteReply || undefined
    }))

    setInput('')
    setAttachments([])
    setQuoteReply(null) // 清除引用
  }

  // 按Enter发送
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 格式化文件大小
  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div
      className={`h-full flex flex-col relative ${dragOver ? 'ring-2 ring-inset' : ''}`}
      style={{
        background: 'var(--bg-primary)',
        '--tw-ring-color': 'var(--accent-primary)'
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
          style={{ background: 'var(--accent-primary-soft)' }}>
          <div className="px-6 py-4 rounded-xl border-2 border-dashed"
            style={{ borderColor: 'var(--accent-primary)', background: 'var(--bg-secondary)' }}>
            <p className="text-lg" style={{ color: 'var(--accent-primary)' }}>📎 松开鼠标上传文件</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center mt-20" style={{ color: 'var(--text-muted)', animation: 'slideUp 0.5s ease' }}>
            <p className="text-4xl mb-3">💬</p>
            <p className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>开始对话吧</p>
            <p className="text-sm mt-2">输入消息与 Agent 交互</p>
            <div className="mt-4 text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
              <p>📎 支持拖拽文件上传</p>
              <p>📋 支持 Ctrl+V 粘贴图片</p>
            </div>
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              onClick={loadMoreMessages}
              disabled={loadingMore}
              className="btn-pill"
            >
              {loadingMore ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin">⏳</span>
                  加载中...
                </span>
              ) : '加载更早的消息'}
            </button>
          </div>
        )}

        {messages.map((msg, idx) => (
          <Message 
            key={idx} 
            message={msg} 
            index={idx}
            onDelete={handleDeleteMessage}
            onQuote={setQuoteReply}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom input area */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="relative group card p-2 flex items-center gap-2 max-w-[200px]"
                >
                  {att.type === 'image' ? (
                    <img src={att.url} alt={att.name} className="w-10 h-10 object-cover rounded-lg" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: 'var(--bg-hover)' }}>📄</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{att.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatSize(att.size)}</p>
                  </div>
                  <button
                    onClick={() => removeAttachment(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    style={{ background: 'var(--error)', color: '#fff' }}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quote preview */}
        {quoteReply && (
          <div className="px-4 pt-2">
            <QuoteReply quote={quoteReply} onRemove={() => setQuoteReply(null)} />
          </div>
        )}

        {/* Input area - 所有控件都在输入框里 */}
        <div className="p-3">
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-primary)' }}>
            {/* Textarea */}
            <div className="px-3 pt-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.json,.js,.ts,.jsx,.tsx,.py,.html,.css"
                onChange={handleFileSelect}
                className="hidden"
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isStarting ? 'Agent启动中，请稍候...' : isWorking ? '任务进行中，请等待完成...' : '输入消息...'}
                disabled={isWorking || isStarting}
                className="w-full bg-transparent text-sm resize-none focus:outline-none"
                style={{ color: 'var(--text-primary)', minHeight: 40, maxHeight: 120, opacity: (isWorking || isStarting) ? 0.5 : 1 }}
                rows={1}
              />
            </div>
            {/* 底部工具栏 */}
            <div className="flex items-center gap-1 px-2 pb-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isWorking || isStarting}
                className="p-1.5 rounded-lg transition-colors text-xs"
                style={{ color: 'var(--text-muted)', opacity: (isWorking || isStarting) ? 0.4 : 1 }}
                title="上传文件"
              >{uploading ? '⏳' : '📎'}</button>
              <select
                value={currentMode}
                onChange={(e) => updateOption('mode', e.target.value)}
                className="text-xs py-1 px-1.5 rounded-lg border-none focus:outline-none"
                style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', maxWidth: 80 }}
              >
                {modes.map(mode => (
                  <option key={mode.id} value={mode.id}>{mode.name}</option>
                ))}
              </select>
              <select
                value={currentModel}
                onChange={(e) => updateOption('model', e.target.value)}
                className="text-xs py-1 px-1.5 rounded-lg border-none focus:outline-none"
                style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', maxWidth: 120 }}
              >
                <option value="">默认模型</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              {efforts.length > 0 && (
                <select
                  value={currentEffort}
                  onChange={(e) => updateOption('effort', e.target.value)}
                  className="text-xs py-1 px-1.5 rounded-lg border-none focus:outline-none"
                  style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', maxWidth: 60 }}
                >
                  {efforts.map(effort => (
                    <option key={effort.id} value={effort.id}>{effort.name}</option>
                  ))}
                </select>
              )}
              <div className="flex-1" />
              {isWorking && (
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`${API_BASE}/sessions/${sessionId}/interrupt`, { method: 'POST' })
                      if (res.ok) {
                        onWorkingChange(false)
                      }
                    } catch (e) {
                      console.error('中断任务失败:', e)
                    }
                  }}
                  className="p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1"
                  style={{ background: 'var(--error, #ef4444)', color: 'white' }}
                  title="中断当前任务"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                </button>
              )}
              <button
                onClick={sendMessage}
                disabled={!connected || isWorking || isStarting || (input.trim() === '' && attachments.length === 0)}
                className="p-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--accent-primary)', color: 'white', opacity: (!connected || isWorking || isStarting || (input.trim() === '' && attachments.length === 0)) ? 0.4 : 1 }}
                title="发送"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>

          {/* Status bar */}
          <div className="mt-1.5 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-center gap-2">
              {connecting ? (
                <span className="loading-dots" style={{ color: 'var(--warning)' }}>
                  <span>●</span><span>●</span><span>●</span>
                </span>
              ) : (
                <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} style={{ width: 6, height: 6 }} />
              )}
              {attachments.length > 0 && (
                <span style={{ color: 'var(--accent-primary)' }}>📎{attachments.length}</span>
              )}
            </div>
            <span>Enter 发送 · Shift+Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  )
}

