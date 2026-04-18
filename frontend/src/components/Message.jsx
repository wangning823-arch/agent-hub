import React from 'react'

export default function Message({ message, index, onDelete, onCopy }) {
  const { type, content, metadata, attachments } = message

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

  // 用户消息
  if (type === 'user') {
    return (
      <div className="flex justify-end group">
        <div className="max-w-[80%] md:max-w-[70%]">
          {/* 操作按钮 */}
          <div className="flex justify-end gap-1 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded"
              title="复制"
            >
              📋
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded"
              title="删除"
            >
              🗑️
            </button>
          </div>
          <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-3">
            {/* 文本内容 */}
            {content && (
              <div className="whitespace-pre-wrap break-words">{renderContent(content)}</div>
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
          <div className="text-xs text-gray-500 text-right mt-1">
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
      <div className="flex justify-start">
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
      <div className="flex justify-center">
        <div className="bg-gray-800 text-gray-400 rounded-full px-4 py-2 text-sm">
          {content}
        </div>
      </div>
    )
  }

  // 工具调用
  if (type === 'tool_use') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] md:max-w-[70%]">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3">
            <div className="flex items-center gap-2 mb-2 text-gray-400">
              <span>🔧</span>
              <span className="text-sm font-medium">{metadata?.tool || '工具调用'}</span>
            </div>
            <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto">
              {content}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  // Agent文本消息
  return (
    <div className="flex justify-start group">
      <div className="max-w-[80%] md:max-w-[70%]">
        <div className="bg-gray-800 text-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
          <div className="whitespace-pre-wrap break-words">{renderContent(content)}</div>
        </div>
        <div className="flex items-center justify-between mt-1">
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
              className="p-1 text-gray-500 hover:text-white hover:bg-gray-700 rounded"
              title="复制"
            >
              📋
            </button>
            <button
              onClick={handleDelete}
              className="p-1 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded"
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

// 渲染内容（支持Markdown风格的链接和图片）
function renderContent(content) {
  if (!content) return null

  // 处理图片链接 ![name](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  // 处理普通链接 [name](url)
  const linkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g
  // 处理代码块 ```code```
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  // 处理行内代码 `code`
  const inlineCodeRegex = /`([^`]+)`/g

  let parts = []
  let lastIndex = 0
  let match

  // 先处理代码块
  const processedContent = content.replace(codeBlockRegex, (match, lang, code) => {
    return `<CODEBLOCK:${lang || 'text'}:${code}>`
  })

  // 处理图片
  const withImages = processedContent.replace(imageRegex, (match, alt, url) => {
    return `<IMAGE:${alt}:${url}>`
  })

  // 处理链接
  const withLinks = withImages.replace(linkRegex, (match, text, url) => {
    return `<LINK:${text}:${url}>`
  })

  // 分割并渲染
  const segments = withLinks.split(/(<(?:CODEBLOCK|IMAGE|LINK):[^>]+>)/)

  return segments.map((segment, idx) => {
    if (segment.startsWith('<CODEBLOCK:')) {
      const [, lang, code] = segment.match(/<CODEBLOCK:([^:]+):(.+)>/s) || []
      return (
        <pre key={idx} className="bg-gray-900 rounded p-3 my-2 overflow-x-auto">
          <code className="text-sm text-gray-300">{code}</code>
        </pre>
      )
    }
    if (segment.startsWith('<IMAGE:')) {
      const [, alt, url] = segment.match(/<IMAGE:([^:]*):(.+)>/) || []
      return (
        <img
          key={idx}
          src={url}
          alt={alt || '图片'}
          className="max-w-full rounded-lg my-2 cursor-pointer hover:opacity-90"
          onClick={() => window.open(url, '_blank')}
        />
      )
    }
    if (segment.startsWith('<LINK:')) {
      const [, text, url] = segment.match(/<LINK:([^:]*):(.+)>/) || []
      return (
        <a
          key={idx}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline"
        >
          {text || url}
        </a>
      )
    }
    // 普通文本 - 处理行内代码
    return (
      <span key={idx}>
        {segment.split(/(`[^`]+`)/).map((part, i) => {
          if (part.startsWith('`') && part.endsWith('`')) {
            return (
              <code key={i} className="bg-gray-900 px-1.5 py-0.5 rounded text-sm text-pink-400">
                {part.slice(1, -1)}
              </code>
            )
          }
          return part
        })}
      </span>
    )
  })
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
