import React, { useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

// ---- 类型定义 ----

interface Attachment {
  type: string
  name: string
  url: string
  size?: number
}

interface MessageData {
  type: string
  content?: any
  metadata?: {
    tool?: string
    isError?: boolean
    [key: string]: any
  }
  attachments?: Attachment[]
  replace?: boolean
  toolCount?: number
  result?: string
  resultIsError?: boolean
  time?: number
  timestamp?: number
  [key: string]: any
}

interface MessageProps {
  message: MessageData
  index: number
  onDelete?: (index: number) => void
  onCopy?: () => void
  onQuote?: (quote: { role: string; content: string; timestamp: number }) => void
  onResend?: (content: string) => void
}

interface ActionButtonProps {
  onClick: () => void
  title: string
  hoverColor?: string
  children: React.ReactNode
}

interface AttachmentPreviewProps {
  attachment: Attachment
  isUser: boolean
}

// ---- SVG 图标组件 ----

const IconCopy = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const IconQuote = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
const IconResend = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>

export default function Message({ message, index, onDelete, onCopy, onQuote, onResend }: MessageProps) {
  const { type, content: rawContent, metadata, attachments, replace } = message
  // 确保 content 始终是字符串，防止 React 崩溃
  const content: string = rawContent != null ? (typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent)) : ''
  const contentRef = useRef<HTMLDivElement>(null)

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content)
        .then(() => { if (onCopy) onCopy() })
        .catch((err: any) => console.error('复制失败:', err))
    }
  }

  const handleDelete = () => { if (onDelete && index !== undefined) onDelete(index) }
  const handleQuote = () => {
    if (onQuote) onQuote({ role: type, content, timestamp: message.timestamp || Date.now() })
  }

  const renderMarkdown = (text: any): React.ReactNode => {
    if (!text) return null
    if (typeof text !== 'string') text = JSON.stringify(text, null, 2)
    try {
      const html = marked.parse(text)
      return <div dangerouslySetInnerHTML={{ __html: html }} />
    } catch (err) {
      console.error('Markdown渲染失败:', err)
      return <div>{text}</div>
    }
  }

  const ActionButton = ({ onClick, title, hoverColor, children }: ActionButtonProps) => (
    <button
      onClick={onClick}
      className="btn-icon w-7 h-7 rounded-lg"
      style={{ color: 'var(--text-muted)' }}
      title={title}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = hoverColor || 'var(--text-primary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      {children}
    </button>
  )

  const formatTime = (ts?: number) => new Date(ts || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  // Skip internal messages
  if (type === 'token_usage' || type === 'conversation_id') return null

  // User message
  if (type === 'user') {
    return (
      <div className="flex items-start justify-end gap-2 group message">
        {/* 重新发送按钮 */}
        {onResend && (
          <button
            onClick={() => onResend(content)}
            className="btn-icon w-7 h-7 rounded-lg mt-8 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
            title="重新发送"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--accent-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <IconResend />
          </button>
        )}
        <div className="max-w-[80%] md:max-w-[70%]">
          <div className="flex justify-end gap-0.5 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ActionButton onClick={handleCopy} title="复制"><IconCopy /></ActionButton>
            <ActionButton onClick={handleQuote} title="引用回复" hoverColor="var(--accent-primary)"><IconQuote /></ActionButton>
            <ActionButton onClick={handleDelete} title="删除" hoverColor="var(--error)"><IconTrash /></ActionButton>
          </div>
          <div className="bubble-user">
            {content && <div className="whitespace-pre-wrap break-words">{content}</div>}
            {attachments && attachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {attachments.map((att, idx) => <AttachmentPreview key={idx} attachment={att} isUser={true} />)}
              </div>
            )}
          </div>
          <div className="text-xs mt-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{formatTime(message.time)}</div>
        </div>
      </div>
    )
  }

  // Error message
  if (type === 'error') {
    return (
      <div className="flex justify-start message">
        <div className="max-w-[80%] md:max-w-[70%]">
          <div className="rounded-2xl rounded-bl-sm px-4 py-3" style={{ background: 'var(--error-soft)', border: '1px solid var(--error)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span>❌</span>
              <span className="text-sm font-medium" style={{ color: 'var(--error)' }}>错误</span>
            </div>
            <div className="text-sm" style={{ color: 'var(--error)' }}>{content}</div>
          </div>
        </div>
      </div>
    )
  }

  // Status message
  if (type === 'status') {
    return (
      <div className="flex justify-center message">
        <div className="rounded-full px-4 py-2 text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
          {content}
        </div>
      </div>
    )
  }

  // Tool use - compact
  if (type === 'tool_use') {
    const toolName: string = metadata?.tool || '工具'
    const toolIcons: Record<string, string> = {
      'Bash': '⚡', 'Read': '📖', 'Write': '✏️', 'Edit': '📝',
      'Glob': '🔍', 'Grep': '🔎', 'LS': '📁', 'WebFetch': '🌐',
      'TodoWrite': '✅', 'NotebookEdit': '📓'
    }
    const icon = toolIcons[toolName] || '🔧'
    const toolCount: number = message.toolCount || 1
    const result = message.result
    const resultIsError = message.resultIsError

    let brief = ''
    if (typeof content === 'string') {
      if (toolName === 'Bash') {
        brief = content.match(/command['":\s]*([^\\n"'}]+)/)?.[1] || content.slice(0, 60)
      } else if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
        brief = content.match(/file_path['":\s]*([^\\n"'}]+)/)?.[1] || content.slice(0, 50)
      } else {
        brief = content.slice(0, 60).replace(/\\n/g, ' ')
      }
      brief = brief.trim()
    }
    if (brief.length > 60) brief = brief.slice(0, 57) + '...'

    return (
      <div className={`flex justify-start message my-0.5 ${replace ? 'message-replace' : ''}`}>
        <div className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-default max-w-full transition-all"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title={content}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}>
          <span>{icon}</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{toolName}</span>
          {brief && <span className="truncate" style={{ color: 'var(--text-muted)' }}>{brief}</span>}
          {toolCount > 1 && (
            <span className="flex-shrink-0 text-[10px] font-bold px-1 rounded"
              style={{ color: 'var(--accent)', background: 'var(--accent-soft, rgba(99,102,241,0.15))' }}>
              ×{toolCount}
            </span>
          )}
        </div>
      </div>
    )
  }

  // Tool result - compact
  if (type === 'tool_result') {
    const isError = metadata?.isError
    if (!content) return null
    const preview = typeof content === 'string' ? content.slice(0, 100) : JSON.stringify(content).slice(0, 100)
    if (!preview.trim()) return null
    return (
      <div className="flex justify-start message my-0.5">
        <div className="text-xs px-2.5 py-1 rounded-lg truncate max-w-full"
          style={{
            background: isError ? 'var(--error-soft)' : 'var(--bg-primary)',
            color: isError ? 'var(--error)' : 'var(--text-muted)'
          }}
          title={typeof content === 'string' ? content : JSON.stringify(content, null, 2)}>
          {preview}{preview.length >= 100 ? '...' : ''}
        </div>
      </div>
    )
  }

  // Assistant message (with Markdown)
  return (
    <div className="flex justify-start group message">
      <div className="max-w-[80%] md:max-w-[70%]">
        <div className="bubble-assistant">
          <div ref={contentRef} className="markdown-content">
            {renderMarkdown(content)}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatTime(message.time)}</div>
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <ActionButton onClick={handleCopy} title="复制"><IconCopy /></ActionButton>
            <ActionButton onClick={handleQuote} title="引用回复" hoverColor="var(--accent-primary)"><IconQuote /></ActionButton>
            <ActionButton onClick={handleDelete} title="删除" hoverColor="var(--error)"><IconTrash /></ActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function AttachmentPreview({ attachment, isUser }: AttachmentPreviewProps) {
  const { type, name, url, size } = attachment
  if (type === 'image') {
    return (
      <div className="rounded-lg overflow-hidden">
        <img src={url} alt={name} className="max-w-[200px] max-h-[150px] object-cover cursor-pointer hover:opacity-90"
          onClick={() => window.open(url, '_blank')} />
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 p-2 rounded-lg transition-colors"
      style={{ background: isUser ? 'rgba(255,255,255,0.15)' : 'var(--bg-hover)' }}
      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.85'}
      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}>
      <span className="text-2xl">{getFileIcon(name)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{name}</p>
        <p className="text-xs opacity-70">{formatSize(size)}</p>
      </div>
      <span className="text-sm opacity-70">⬇️</span>
    </a>
  )
}

function getFileIcon(filename: string): string {
  const ext = filename?.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    txt: '📄', json: '📋', js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
    py: '🐍', html: '🌐', css: '🎨', zip: '📦', rar: '📦',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️'
  }
  return icons[ext || ''] || '📄'
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
