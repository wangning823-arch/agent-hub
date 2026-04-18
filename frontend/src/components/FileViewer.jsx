import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function FileViewer({ file, content, onClose, onSave }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setEditedContent(content)
    setHasChanges(false)
  }, [content])

  // 获取文件扩展名对应的语法高亮提示
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
        alert('保存失败: ' + (data.error || '未知错误'))
      }
    } catch (error) {
      alert('保存失败: ' + error.message)
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

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-xl">{getFileIcon(filename)}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">{filename}</span>
              {hasChanges && (
                <span className="px-1.5 py-0.5 text-xs bg-yellow-600/30 text-yellow-400 rounded">
                  未保存
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500">{file}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded">
            {getLanguage(filename)}
          </span>
          <span className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded">
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
                className="px-3 py-1.5 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
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
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 文件内容 */}
      <div className="flex-1 overflow-hidden flex">
        {/* 行号 */}
        <div className="flex-shrink-0 py-4 px-2 text-right select-none bg-gray-900/50 border-r border-gray-800 overflow-y-auto">
          {lines.map((_, i) => (
            <div key={i} className="text-xs text-gray-600 leading-6">
              {i + 1}
            </div>
          ))}
        </div>
        
        {/* 代码内容 */}
        <div className="flex-1 overflow-auto">
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={handleContentChange}
              className="w-full h-full p-4 bg-transparent text-sm text-gray-300 font-mono leading-6 resize-none focus:outline-none"
              spellCheck={false}
            />
          ) : (
            <pre className="p-4 overflow-x-auto">
              <code className="text-sm text-gray-300 font-mono leading-6 whitespace-pre">
                {content}
              </code>
            </pre>
          )}
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
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
