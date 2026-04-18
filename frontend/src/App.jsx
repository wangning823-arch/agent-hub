import React, { useState, useEffect } from 'react'
import ChatPanel from './components/ChatPanel'
import NewSessionModal from './components/NewSessionModal'
import SettingsPanel from './components/SettingsPanel'
import ProjectManager from './components/ProjectManager'
import Sidebar from './components/Sidebar'
import RightSidebar from './components/RightSidebar'
import ContextManager from './components/ContextManager'
import FileViewer from './components/FileViewer'
import SearchPanel from './components/SearchPanel'

const API_BASE = '/api'

export default function App() {
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [sessionOptions, setSessionOptions] = useState({})
  const [showNewModal, setShowNewModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [showContextManager, setShowContextManager] = useState(false)
  const [agents, setAgents] = useState([])
  
  // 文件查看状态
  const [viewingFile, setViewingFile] = useState(null) // { path, content }
  
  // 搜索状态
  const [showSearch, setShowSearch] = useState(false)
  
  // 侧边栏状态
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // 监听窗口大小
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      // 桌面端默认打开侧边栏
      if (!mobile) {
        setLeftSidebarOpen(true)
        setRightSidebarOpen(true)
      }
      // 移动端不自动关闭侧边栏（避免键盘弹出时关闭）
    }

    window.addEventListener('resize', handleResize)
    handleResize() // 初始化
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 获取可用的Agent类型
  useEffect(() => {
    fetch(`${API_BASE}/agents`)
      .then(res => res.json())
      .then(data => setAgents(data.agents || []))
      .catch(console.error)
  }, [])

  // 获取现有会话
  useEffect(() => {
    fetch(`${API_BASE}/sessions`)
      .then(res => res.json())
      .then(data => {
        setSessions(data)
        if (data.length > 0 && !activeSession) {
          setActiveSession(data[0].id)
          if (data[0].options) {
            setSessionOptions(prev => ({
              ...prev,
              [data[0].id]: data[0].options
            }))
          }
        }
      })
      .catch(console.error)
  }, [])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K 或 Cmd+K 打开搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
      }
      // ESC 关闭搜索
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSearch])

  // 创建新会话
  const createSession = async (workdir, agentType = 'claude-code', options = {}) => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, agentType, ...options })
      })
      const session = await res.json()
      setSessions(prev => [...prev, session])
      setActiveSession(session.id)
      setSessionOptions(prev => ({
        ...prev,
        [session.id]: options
      }))
      setShowNewModal(false)
      // 手机端自动关闭侧边栏
      if (isMobile) setLeftSidebarOpen(false)
    } catch (error) {
      alert('创建会话失败: ' + error.message)
    }
  }

  // 删除会话
  const removeSession = async (sessionId) => {
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      setSessionOptions(prev => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
      if (activeSession === sessionId) {
        const remaining = sessions.filter(s => s.id !== sessionId)
        setActiveSession(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (error) {
      alert('删除会话失败: ' + error.message)
    }
  }

  // 继续已保存的会话
  const resumeSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/resume`, {
        method: 'POST'
      })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => {
          const index = prev.findIndex(s => s.id === sessionId)
          if (index >= 0) {
            const next = [...prev]
            next[index] = result.session
            return next
          }
          return [...prev, result.session]
        })
        setActiveSession(result.session.id)
        if (isMobile) setLeftSidebarOpen(false)
      }
    } catch (error) {
      alert('恢复会话失败: ' + error.message)
    }
  }

  // 选择项目
  const handleSelectProject = (result) => {
    const { session, project } = result
    setSessions(prev => [...prev, session])
    setActiveSession(session.id)
    setSessionOptions(prev => ({
      ...prev,
      [session.id]: {
        mode: project.mode,
        model: project.model,
        effort: project.effort
      }
    }))
    setShowProjectManager(false)
    if (isMobile) setLeftSidebarOpen(false)
  }

  // 更新会话选项
  const handleUpdateOptions = (sessionId, options) => {
    setSessionOptions(prev => ({
      ...prev,
      [sessionId]: options
    }))
  }

  // 查看文件
  const handleViewFile = async (filePath) => {
    try {
      const data = await fetch(`${API_BASE}/files/content?path=${encodeURIComponent(filePath)}`).then(r => r.json())
      setViewingFile({ path: filePath, content: data.content || '' })
    } catch (error) {
      alert('加载文件失败: ' + error.message)
    }
  }

  // 重命名会话
  const renameSession = async (sessionId, title) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      alert('重命名失败: ' + error.message)
    }
  }

  // 置顶/取消置顶会话
  const pinSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/pin`, {
        method: 'POST'
      })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      alert('置顶操作失败: ' + error.message)
    }
  }

  // 归档/取消归档会话
  const archiveSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/archive`, {
        method: 'POST'
      })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      alert('归档操作失败: ' + error.message)
    }
  }

  const currentOptions = activeSession ? sessionOptions[activeSession] || {} : {}
  const currentSession = sessions.find(s => s.id === activeSession)

  return (
    <div className="h-screen flex bg-gray-950 relative">
      {/* 遮罩层（手机端点击关闭侧边栏） */}
      {isMobile && (leftSidebarOpen || rightSidebarOpen) && (
        <div
          className="absolute inset-0 bg-black/50 z-40"
          onClick={() => {
            setLeftSidebarOpen(false)
            setRightSidebarOpen(false)
          }}
        />
      )}

      {/* 左侧边栏 */}
      <div className={`
        ${isMobile ? 'absolute left-0 top-0 h-full z-50' : 'relative'}
        transition-transform duration-300 ease-in-out
        ${leftSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar
          sessions={sessions}
          activeSession={activeSession}
          sessionOptions={sessionOptions}
          onSelectSession={(id) => {
            setActiveSession(id)
            if (isMobile) setLeftSidebarOpen(false)
          }}
          onCloseSession={removeSession}
          onResumeSession={resumeSession}
          onNewSession={() => setShowNewModal(true)}
          onOpenProject={() => setShowProjectManager(true)}
          onUpdateOptions={handleUpdateOptions}
          onRenameSession={renameSession}
          onPinSession={pinSession}
          onArchiveSession={archiveSession}
        />
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between px-2 md:px-4 py-2 bg-gray-900 border-b border-gray-800">
          <div className="flex items-center gap-1 md:gap-4">
            {/* 左侧边栏开关 */}
            <button
              onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
              title={leftSidebarOpen ? '关闭菜单' : '打开菜单'}
            >
              {leftSidebarOpen ? '✕' : '☰'}
            </button>

            {activeSession && (
              <div className="text-sm text-gray-400 truncate max-w-[150px] md:max-w-none">
                📁 {currentSession?.workdir?.split('/').pop() || '未知'}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            {/* 上下文管理 */}
            <button
              onClick={() => setShowContextManager(true)}
              disabled={!activeSession}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg disabled:opacity-50"
              title="上下文与Token"
            >
              📊
            </button>

            {/* 设置 */}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
              title="设置"
            >
              ⚙️
            </button>

            {/* 搜索 */}
            <button
              onClick={() => setShowSearch(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
              title="搜索 (Ctrl+K)"
            >
              🔍
            </button>

            {/* 右侧边栏开关 */}
            <button
              onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
              className={`p-2 rounded-lg ${
                rightSidebarOpen
                  ? 'text-white bg-gray-800'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
              title={rightSidebarOpen ? '关闭文件面板' : '打开文件面板'}
            >
              📂
            </button>
          </div>
        </div>

        {/* 聊天区域 */}
        <div className="flex-1 overflow-hidden">
          {viewingFile ? (
            <FileViewer
              file={viewingFile.path}
              content={viewingFile.content}
              onClose={() => setViewingFile(null)}
              onSave={(newContent) => {
                setViewingFile(prev => ({ ...prev, content: newContent }))
              }}
            />
          ) : activeSession ? (
            <ChatPanel
              sessionId={activeSession}
              options={currentOptions}
              onOptionsChange={(opts) => handleUpdateOptions(activeSession, opts)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 p-4">
              <div className="text-center max-w-md">
                <p className="text-4xl mb-4">🤖</p>
                <p className="text-xl font-medium text-gray-300 mb-2">Agent Hub</p>
                <p className="text-gray-500 mb-6">开始使用</p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => setShowProjectManager(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                  >
                    📁 打开项目
                  </button>
                  <button
                    onClick={() => setShowNewModal(true)}
                    className="px-6 py-3 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 flex items-center justify-center gap-2"
                  >
                    ➕ 新建会话
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧边栏 */}
      <div className={`
        ${isMobile ? 'absolute right-0 top-0 h-full z-50' : 'relative'}
        transition-transform duration-300 ease-in-out
        ${rightSidebarOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        <RightSidebar
          sessionId={activeSession}
          workdir={currentSession?.workdir}
          onViewFile={handleViewFile}
        />
      </div>

      {/* 弹窗 */}
      {showNewModal && (
        <NewSessionModal
          agents={agents}
          onCreate={createSession}
          onClose={() => setShowNewModal(false)}
          currentWorkdir={currentSession?.workdir}
        />
      )}

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {showProjectManager && (
        <ProjectManager
          onSelectProject={handleSelectProject}
          onClose={() => setShowProjectManager(false)}
        />
      )}

      {showContextManager && activeSession && (
        <ContextManager
          sessionId={activeSession}
          onClose={() => setShowContextManager(false)}
        />
      )}

      {/* 搜索面板 */}
      {showSearch && (
        <SearchPanel
          onSelectSession={(id) => {
            setActiveSession(id)
            if (isMobile) setLeftSidebarOpen(false)
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  )
}
