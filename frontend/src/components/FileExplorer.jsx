import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function FileExplorer({ sessionId, workdir, onClose }) {
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState(workdir)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')

  useEffect(() => {
    fetchFiles(currentPath)
  }, [currentPath])

  const fetchFiles = async (dirPath) => {
    setLoading(true)
    try {
      // 通过后端API获取文件列表
      const res = await fetch(`${API_BASE}/files?path=${encodeURIComponent(dirPath)}`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
      }
    } catch (error) {
      console.error('获取文件列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const openFile = async (filePath) => {
    try {
      const res = await fetch(`${API_BASE}/files/content?path=${encodeURIComponent(filePath)}`)
      if (res.ok) {
        const data = await res.json()
        setFileContent(data.content)
        setSelectedFile(filePath)
      }
    } catch (error) {
      console.error('读取文件失败:', error)
    }
  }

  const navigateUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/'
    setCurrentPath(parentPath)
  }

  const getFileName = (path) => {
    return path.split('/').pop()
  }

  const getFileIcon = (file) => {
    if (file.isDirectory) return '📁'
    const ext = file.name.split('.').pop().toLowerCase()
    const iconMap = {
      js: '📜', jsx: '📜', ts: '📜', tsx: '📜',
      json: '📋', md: '📝', txt: '📄',
      py: '🐍', rb: '💎', go: '🔵',
      html: '🌐', css: '🎨',
      png: '🖼️', jpg: '🖼️', gif: '🖼️',
      default: '📄'
    }
    return iconMap[ext] || iconMap.default
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl w-full max-w-4xl mx-4 border border-border h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">文件浏览器</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* 文件列表 */}
          <div className="w-1/3 border-r border-border overflow-y-auto">
            <div className="p-2 border-b border-border">
              <button
                onClick={navigateUp}
                className="w-full text-left px-3 py-2 text-sm hover:bg-background rounded"
              >
                ⬆️ 上级目录
              </button>
              <div className="text-xs text-gray-500 px-3 py-1 truncate">
                {currentPath}
              </div>
            </div>

            {loading ? (
              <div className="p-4 text-center text-gray-400">加载中...</div>
            ) : (
              <div className="divide-y divide-border">
                {files.map((file, idx) => (
                  <button
                    key={idx}
                    onClick={() => file.isDirectory ? setCurrentPath(file.path) : openFile(file.path)}
                    className={`w-full text-left px-3 py-2 hover:bg-background flex items-center gap-2 ${
                      selectedFile === file.path ? 'bg-accent/20' : ''
                    }`}
                  >
                    <span>{getFileIcon(file)}</span>
                    <span className="truncate text-sm">{file.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 文件内容 */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {selectedFile ? (
              <>
                <div className="px-4 py-2 border-b border-border text-sm text-gray-400">
                  {getFileName(selectedFile)}
                </div>
                <pre className="flex-1 overflow-auto p-4 text-sm font-mono bg-background">
                  {fileContent}
                </pre>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                选择文件查看内容
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}