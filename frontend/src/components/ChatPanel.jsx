import React, { useState, useEffect, useRef, useCallback } from 'react'
import Message from './Message'

const API_BASE = '/api'

export default function ChatPanel({ sessionId, options = {}, onOptionsChange }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  
  // 模型和模式选项
  const [modes, setModes] = useState([])
  const [models, setModels] = useState([])
  const [efforts, setEfforts] = useState([])
  const [currentMode, setCurrentMode] = useState(options?.mode || 'auto')
  const [currentModel, setCurrentModel] = useState(options?.model || '')
  const [currentEffort, setCurrentEffort] = useState(options?.effort || 'medium')
  
  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)

  // 加载选项
  useEffect(() => {
    loadOptions()
  }, [])

  const loadOptions = async () => {
    try {
      const data = await fetch(`${API_BASE}/options`).then(r => r.json())
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

  // WebSocket连接
  useEffect(() => {
    // 加载历史消息
    const loadHistory = async () => {
      try {
        const session = await fetch(`${API_BASE}/sessions/${sessionId}`).then(r => r.json())
        if (session.messages && session.messages.length > 0) {
          setMessages(session.messages.map(msg => ({
            type: msg.role === 'user' ? 'user' : 'assistant',
            content: typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content,
            timestamp: msg.time
          })))
        }
      } catch (error) {
        console.error('加载历史消息失败:', error)
      }
    }

    loadHistory()

    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    let reconnectTimeout = null

    const connectWebSocket = () => {
      const wsUrl = `ws://${window.location.hostname}:3001?session=${sessionId}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
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
          setMessages(prev => [...prev, msg])
          
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
      alert('删除失败: ' + error.message)
    }
  }

  // 重新生成回复
  const handleRegenerate = async () => {
    if (messages.length < 2) return
    
    try {
      // 删除最后两条消息（用户消息+助手回复）
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/delete-last`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 2 })
      })
      const data = await response.json()
      if (data.success) {
        // 从本地移除最后两条
        setMessages(prev => prev.slice(0, -2))
        // 获取倒数第二条消息（用户消息）并重新发送
        const lastUserMessage = messages[messages.length - 2]
        if (lastUserMessage && lastUserMessage.type === 'user') {
          setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === 1) {
              setMessages(prev => [...prev, { type: 'user', content: lastUserMessage.content }])
              wsRef.current.send(JSON.stringify({
                type: 'user_input',
                content: lastUserMessage.content
              }))
            }
          }, 100)
        }
      }
    } catch (error) {
      console.error('重新生成失败:', error)
      alert('重新生成失败: ' + error.message)
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
      alert('文件上传失败: ' + error.message)
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
      alert('文件上传失败: ' + error.message)
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
      alert('文件上传失败: ' + error.message)
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
      attachments: attachments.length > 0 ? [...attachments] : undefined
    }])

    wsRef.current.send(JSON.stringify({
      type: 'user_input',
      content: messageContent,
      attachments: attachments.length > 0 ? attachments : undefined
    }))

    setInput('')
    setAttachments([])
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
      className={`h-full flex flex-col bg-gray-950 relative ${dragOver ? 'ring-2 ring-blue-500 ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽提示 */}
      {dragOver && (
        <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-gray-900 px-6 py-4 rounded-lg border-2 border-dashed border-blue-500">
            <p className="text-blue-400 text-lg">📎 松开鼠标上传文件</p>
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">开始对话吧 💬</p>
            <p className="text-sm mt-2">输入消息与Agent交互</p>
            <div className="mt-4 text-xs text-gray-600 space-y-1">
              <p>📎 支持拖拽文件上传</p>
              <p>📋 支持Ctrl+V粘贴图片</p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <Message 
            key={idx} 
            message={msg} 
            index={idx}
            onDelete={handleDeleteMessage}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入区域 */}
      <div className="border-t border-gray-800 bg-gray-900">
        {/* 附件预览 */}
        {attachments.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50">
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="relative group bg-gray-800 rounded-lg p-2 flex items-center gap-2 max-w-[200px]"
                >
                  {att.type === 'image' ? (
                    <img
                      src={att.url}
                      alt={att.name}
                      className="w-10 h-10 object-cover rounded"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-700 rounded flex items-center justify-center">
                      📄
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">{att.name}</p>
                    <p className="text-xs text-gray-500">{formatSize(att.size)}</p>
                  </div>
                  <button
                    onClick={() => removeAttachment(idx)}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 模型和模式选择 */}
        <div className="px-4 py-2 border-b border-gray-800 flex flex-wrap items-center gap-2">
          {/* 模式选择 */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">🛡️</span>
            <div className="flex bg-gray-800 rounded-lg p-0.5">
              {modes.slice(0, 4).map(mode => (
                <button
                  key={mode.id}
                  onClick={() => updateOption('mode', mode.id)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    currentMode === mode.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title={mode.description}
                >
                  {mode.name}
                </button>
              ))}
            </div>
          </div>

          {/* 分隔符 */}
          <div className="w-px h-6 bg-gray-700" />

          {/* 模型选择 */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">🧠</span>
            <select
              value={currentModel}
              onChange={(e) => updateOption('model', e.target.value)}
              className="bg-gray-800 border-0 text-xs text-gray-300 rounded-lg px-2 py-1 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">默认模型</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          {/* 分隔符 */}
          <div className="w-px h-6 bg-gray-700" />

          {/* 努力程度 */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">💪</span>
            <div className="flex bg-gray-800 rounded-lg p-0.5">
              {efforts.map(effort => (
                <button
                  key={effort.id}
                  onClick={() => updateOption('effort', effort.id)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    currentEffort === effort.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title={effort.description}
                >
                  {effort.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 重新生成按钮 */}
        {messages.length >= 2 && messages[messages.length - 1]?.type !== 'user' && (
          <div className="px-4 py-2 border-b border-gray-800">
            <button
              onClick={handleRegenerate}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors flex items-center gap-2"
            >
              🔄 重新生成回复
            </button>
          </div>
        )}

        {/* 输入框 */}
        <div className="p-4">
          <div className="flex gap-2">
            {/* 上传按钮 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.json,.js,.ts,.jsx,.tsx,.py,.html,.css"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg disabled:opacity-50 transition-colors"
              title="上传文件"
            >
              {uploading ? '⏳' : '📎'}
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入消息... (Enter发送, Shift+Enter换行, Ctrl+V粘贴图片)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 resize-none focus:outline-none focus:border-blue-500 text-white placeholder-gray-400"
              rows={2}
            />
            <button
              onClick={sendMessage}
              disabled={!connected || (input.trim() === '' && attachments.length === 0)}
              className="px-6 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>

          {/* 状态栏 */}
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-4">
              {connected ? '🟢 已连接' : '🔴 未连接'}
              {attachments.length > 0 && (
                <span className="text-blue-400">📎 {attachments.length} 个附件</span>
              )}
            </div>
            <div className="text-gray-600">
              按 Enter 发送 · Shift+Enter 换行 · Ctrl+V 粘贴
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
