import React, { useEffect, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

// 配置marked
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch (err) {}
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true,
  sanitize: true
})

export default function Message({ message, index, onDelete, onCopy, onQuote }) {
  const { type, content, metadata, attachments } = message
  const contentRef = useRef(null)

  // 复制消息内容
  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content)
        .then(() => {
          if (onCopy) onCopy()
        })
        .catch(err => console.error('复制失败:', err))
    }
  }

  // 删除消息
  const handleDelete = () => {
    if (onDelete && index !== undefined) {
      onDelete(index)
    }
  }

  // 引用回复
  const handleQuote = () => {
    if (onQuote) {
      onQuote({
        role: type,
        content,
        timestamp: message.timestamp || Date.now()
      })
    }
  }

  // 渲染Markdown内容
  const renderMarkdown = (text) => {
    if (!text) return null
    if (typeof text !== 'string') {
      text = JSON.stringify(text, null, 2)
    }
    
    try {
      const html = marked.parse(text)
      return <div dangerouslySetInnerHTML={{ __html: html }} />
    } catch (err) {
      console.error('Markdown渲染失败:', err)
      return <div>{text}</div>
    }
  }

  // token统计和conversation_id消息 - 不渲染或极简渲染
  if (type === 'token_usage' || type === 'conversation_id') {
    return null
  }

  // 用户消息
  if (type === 'user') {
    return (
      <div className="flex justify-end group message">
        <div className="max-w-[80%] md:max-w-[70%]">
          {/* 操作按钮 */}
          <div className="flex justify-end gap-1 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700/80 rounded-lg backdrop-blur-sm"
              title="复制"
            >
              📋
            </button>
            <button
              onClick={handleQuote}
              className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-gray-700/80 rounded-lg backdrop-blur-sm"
              title="引用回复"
            >
              💬
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700/80 rounded-lg backdrop-blur-sm"
              title="删除"
            >
              🗑️
            </button>
          </div>
          <div className="bubble-user text-white px-4 py-3 shadow-lg">
            {/* 文本内容 */}
            {content && (
              <div className="whitespace-pre-wrap break-words">{content}</div>
            )}

            {/* 附件 */}
            {attachments && attachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {attachments.map((att, idx) => (
                  <AttachmentPreview key={idx} attachment={att} isUser={true} />
                ))}
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 text-right mt-1.5">
            {new Date(message.timestamp || Date.now()).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>
      </div>
    )
  }

  // 错误消息
  if (type === 'error') {
    return (
      <div className="flex justify-start message">
        <div className="max-w-[80%] md:max-w-[70%]">
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-2xl rounded-bl-sm px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span>❌</span>
              <span className="text-sm font-medium">错误</span>
            </div>
            <div className="text-sm">{content}</div>
          </div>
        </div>
      </div>
    )
  }

  // 状态消息
  if (type === 'status') {
    return (
      <div className="flex justify-center message">
        <div className="bg-gray-800 text-gray-400 rounded-full px-4 py-2 text-sm">
          {content}
        </div>
      </div>
    )
  }

  // 工具调用
  if (type === 'tool_use') {
    return (
      <div className="flex justify-start message">
        <div className="max-w-[80%] md:max-w-[70%]">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
            <div className="flex items-center gap-2 mb-2 text-gray-400">
              <span>🔧</span>
              <span className="text-sm font-medium">{metadata?.tool || '工具调用'}</span>
            </div>
            <pre className="text-xs text-gray-300 bg-gray-900 rounded p-3 overflow-x-auto">
              <code>{content}</code>
            </pre>
          </div>
        </div>
      </div>
    )
  }

  // Agent文本消息（支持Markdown渲染）
  return (
    <div className="flex justify-start group message">
      <div className="max-w-[80%] md:max-w-[70%]">
        <div className="bubble-assistant text-gray-200 px-4 py-3 shadow-lg">
          <div 
            ref={contentRef}
            className="markdown-content"
          >
            {renderMarkdown(content)}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <div className="text-xs text-gray-500">
            {new Date(message.timestamp || Date.now()).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
          {/* 操作按钮 */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700/80 rounded-lg backdrop-blur-sm"
              title="复制"
            >
              📋
            </button>
            <button
              onClick={handleQuote}
              className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-gray-700/80 rounded-lg backdrop-blur-sm"
              title="引用回复"
            >
              💬
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700/80 rounded-lg backdrop-blur-sm"
              title="删除"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 附件预览组件
function AttachmentPreview({ attachment, isUser }) {
  const { type, name, url, size } = attachment

  if (type === 'image') {
    return (
      <div className="rounded-lg overflow-hidden">
        <img
          src={url}
          alt={name}
          className="max-w-[200px] max-h-[150px] object-cover cursor-pointer hover:opacity-90"
          onClick={() => window.open(url, '_blank')}
        />
      </div>
    )
  }

  // 文件附件
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 p-2 rounded-lg ${
        isUser ? 'bg-blue-700/50 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
      } transition-colors`}
    >
      <span className="text-2xl">{getFileIcon(name)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{name}</p>
        <p className="text-xs opacity-70">{formatSize(size)}</p>
      </div>
      <span className="text-sm opacity-70">⬇️</span>
    </a>
  )
}

// 获取文件图标
function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase()
  const icons = {
    pdf: '📕',
    doc: '📘', docx: '📘',
    xls: '📗', xlsx: '📗',
    txt: '📄',
    json: '📋',
    js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
    py: '🐍',
    html: '🌐', css: '🎨',
    zip: '📦', rar: '📦',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️'
  }
  return icons[ext] || '📄'
}

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
