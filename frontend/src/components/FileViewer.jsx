import React from 'react'

export default function FileViewer({ file, content, onClose }) {
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

  const filename = file.split('/').pop()
  const lines = content.split('\n')

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-xl">{getFileIcon(filename)}</span>
          <div>
            <div className="text-white font-medium">{filename}</div>
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
      <div className="flex-1 overflow-auto">
        <div className="flex">
          {/* 行号 */}
          <div className="flex-shrink-0 py-4 px-2 text-right select-none bg-gray-900/50 border-r border-gray-800">
            {lines.map((_, i) => (
              <div key={i} className="text-xs text-gray-600 leading-6">
                {i + 1}
              </div>
            ))}
          </div>
          
          {/* 代码内容 */}
          <pre className="flex-1 py-4 px-4 overflow-x-auto">
            <code className="text-sm text-gray-300 font-mono leading-6 whitespace-pre">
              {content}
            </code>
          </pre>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <span>UTF-8</span>
        <span>{content.length} 字符</span>
      </div>
    </div>
  )
}
