import React, { useState, useEffect, useRef } from 'react'
import { useToast } from './Toast'
import hljs from 'highlight.js'

const API_BASE = '/api'

export default function FileViewer({ file, content, onClose, onSave }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const toast = useToast()
  const codeRef = useRef(null)

  // 代码高亮
  const highlightCode = () => {
    if (codeRef.current) {
      codeRef.current.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block)
      })
    }
  }

  useEffect(() => {
    if (!isEditing) {
      highlightCode()
    }
  }, [content, isEditing])

  useEffect(() => {
    setEditedContent(content)
    setHasChanges(false)
  }, [content])

  // 获取文件扩展名对应的 hljs 语言标识
  const getHljsLanguage = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const langMap = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
      html: 'xml', css: 'css', scss: 'scss',
      json: 'json', yaml: 'yaml', yml: 'yaml',
      md: 'markdown', txt: '',
      sh: 'bash', bash: 'bash',
      sql: 'sql'
    }
    return langMap[ext] || ''
  }
  const getLanguage = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const langMap = {
      js: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
      py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust',
      html: 'HTML', css: 'CSS', scss: 'SCSS',
      json: 'JSON', yaml: 'YAML', yml: 'YAML',
      md: 'Markdown', txt: 'Text',
      sh: 'Shell', bash: 'Bash',
      sql: 'SQL', graphql: 'GraphQL'
    }
    return langMap[ext] || 'Plain Text'
  }

  // 获取文件图标
  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const icons = {
      js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️',
      json: '📋', md: '📝', txt: '📄',
      css: '🎨', scss: '🎨', html: '🌐',
      py: '🐍', rb: '💎', go: '🔵', rs: '🦀',
      sh: '🐚', sql: '🗃️'
    }
    return icons[ext] || '📄'
  }

  // 保存文件
  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file, content: editedContent })
      })
      
      if (response.ok) {
        setHasChanges(false)
        setIsEditing(false)
        if (onSave) {
          onSave(editedContent)
        }
      } else {
        const data = await response.json()
        toast.error('保存失败: ' + (data.error || '未知错误'))
      }
    } catch (error) {
      toast.error('保存失败: ' + error.message)
    }
    setSaving(false)
  }

  // 取消编辑
  const handleCancel = () => {
    if (hasChanges && !confirm('有未保存的更改，确定要取消吗？')) {
      return
    }
    setEditedContent(content)
    setHasChanges(false)
    setIsEditing(false)
  }

  // 内容变化
  const handleContentChange = (e) => {
    setEditedContent(e.target.value)
    setHasChanges(true)
  }

  const filename = file.split('/').pop()
  const lines = (isEditing ? editedContent : content).split('\n')

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isEditing) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (hasChanges && !saving) handleSave()
      }
      if (e.key === 'Escape') {
        handleCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, hasChanges, saving, editedContent])

  // 同步行号和代码的滚动
  const handleCodeScroll = (e) => {
    const lineNumbers = e.target.previousElementSibling
    if (lineNumbers) {
      lineNumbers.scrollTop = e.target.scrollTop
    }
  }

  return (
    <div className="h-full flex flex-col file-viewer" style={{ background: 'var(--bg-secondary)' }}>
      <style>{`
        .file-viewer code.hljs {
          background: transparent !important;
          color: var(--text-primary) !important;
        }
      `}</style>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">{getFileIcon(filename)}</span>
          <div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-primary)' }} className="font-medium">{filename}</span>
              {hasChanges && (
                <span className="px-1.5 py-0.5 text-xs bg-yellow-600/30 text-yellow-400 rounded">
                  未保存
                </span>
              )}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{file}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 text-xs rounded"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
            {getLanguage(filename)}
          </span>
          <span className="px-2 py-1 text-xs rounded"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
            {lines.length} 行
          </span>
          
          {/* 编辑/保存按钮 */}
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '保存中...' : '💾 保存'}
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-sm rounded"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                ✕ 取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              ✏️ 编辑
            </button>
          )}
          
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 文件内容 */}
      <div className="flex-1 overflow-hidden flex">
        {/* 行号 */}
        <div className="flex-shrink-0 py-4 px-2 text-right select-none border-r overflow-hidden"
          style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-subtle)' }}>
          {lines.map((_, i) => (
            <div key={i} className="text-xs leading-6" style={{ color: 'var(--text-muted)' }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* 代码内容 */}
        <div className="flex-1 overflow-auto" onScroll={handleCodeScroll} ref={codeRef}>
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={handleContentChange}
              className="w-full h-full p-4 text-sm font-mono leading-6 resize-none focus:outline-none"
              style={{ background: 'transparent', color: 'var(--text-primary)' }}
              spellCheck={false}
            />
          ) : (
            <pre className="p-4 overflow-x-auto" style={{ background: 'transparent' }}>
              <code className={`text-sm font-mono leading-6 whitespace-pre language-${getHljsLanguage(filename)}`}
                style={{ color: 'var(--text-primary)' }}>
                {content}
              </code>
            </pre>
          )}
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="px-4 py-2 border-t flex items-center justify-between text-xs"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
        <div className="flex items-center gap-4">
          <span>UTF-8</span>
          <span>{content.length} 字符</span>
          {isEditing && <span className="text-yellow-500">编辑模式</span>}
        </div>
        {isEditing && (
          <div className="flex items-center gap-2">
            <span>Ctrl+S 保存</span>
            <span>ESC 取消</span>
          </div>
        )}
      </div>
    </div>
  )
}
