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
import { useToast } from './components/Toast'
import { useTheme } from './components/ThemeContext'
import Login from './components/Login'

const API_BASE = '/api'

// SVG icons
const IconMenu = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
)
const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
)
const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
)
const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
)
const IconChart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
)
const IconPanel = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
)

export default function App() {
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('access_token') || '')
  const [authChecked, setAuthChecked] = useState(false)
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [sessionOptions, setSessionOptions] = useState({})
  const [showNewModal, setShowNewModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const toast = useToast()
  const { themeName } = useTheme()
  const [showContextManager, setShowContextManager] = useState(false)
  const [agents, setAgents] = useState([])
  
  const [viewingFile, setViewingFile] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // 全局 fetch 拦截，自动加 token
  useEffect(() => {
    const origFetch = window.fetch
    window.fetch = (url, opts = {}) => {
      const headers = { ...opts.headers }
      const token = localStorage.getItem('access_token')
      if (token) headers['x-access-token'] = token
      return origFetch(url, { ...opts, headers })
    }
    return () => { window.fetch = origFetch }
  }, [])

  // 检查 token 有效性
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setAuthChecked(true); return }
    fetch('/api/auth/check', { headers: { 'x-access-token': token } })
      .then(r => r.json())
      .then(data => {
        if (!data.valid) { localStorage.removeItem('access_token'); setAccessToken('') }
        setAuthChecked(true)
      })
      .catch(() => setAuthChecked(true))
  }, [])

  const handleLogin = (token) => { setAccessToken(token) }

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) {
        setLeftSidebarOpen(true)
        setRightSidebarOpen(true)
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/agents`)
      .then(res => res.json())
      .then(data => setAgents(data.agents || []))
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/sessions`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) { setSessions([]); return }
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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSearch])

  const createSession = async (workdir, agentType = 'claude-code', options = {}) => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, agentType, ...options })
      })
      const session = await res.json()
      // 如果传了 title，更新会话标题
      if (options.title && session.id) {
        await fetch(`${API_BASE}/sessions/${session.id}/rename`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: options.title })
        })
        session.title = options.title
      }
      setSessions(prev => [...prev, session])
      setActiveSession(session.id)
      setSessionOptions(prev => ({ ...prev, [session.id]: options }))
      setShowNewModal(false)
      if (isMobile) setLeftSidebarOpen(false)
    } catch (error) {
      toast.error('创建会话失败: ' + error.message)
    }
  }

  const removeSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' })
      const result = await res.json()
      if (!result.success) {
        toast.error('删除失败')
        return
      }
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
      toast.success('会话已删除')
    } catch (error) {
      toast.error('删除会话失败: ' + error.message)
    }
  }

  const resumeSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/resume`, { method: 'POST' })
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
      toast.error('恢复会话失败: ' + error.message)
    }
  }

  const handleSelectProject = (result) => {
    const { session, project } = result
    setSessions(prev => [...prev, session])
    setActiveSession(session.id)
    setSessionOptions(prev => ({
      ...prev,
      [session.id]: { mode: project.mode, model: project.model, effort: project.effort }
    }))
    setShowProjectManager(false)
    if (isMobile) setLeftSidebarOpen(false)
  }

  const handleUpdateOptions = (sessionId, options) => {
    setSessionOptions(prev => ({ ...prev, [sessionId]: options }))
  }

  const handleViewFile = async (filePath) => {
    try {
      const data = await fetch(`${API_BASE}/files/content?path=${encodeURIComponent(filePath)}`).then(r => r.json())
      setViewingFile({ path: filePath, content: data.content || '' })
    } catch (error) {
      toast.error('加载文件失败: ' + error.message)
    }
  }

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
      toast.error('重命名失败: ' + error.message)
    }
  }

  const pinSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/pin`, { method: 'POST' })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      toast.error('置顶操作失败: ' + error.message)
    }
  }

  const archiveSession = async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/archive`, { method: 'POST' })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      toast.error('归档操作失败: ' + error.message)
    }
  }

  const currentOptions = activeSession ? sessionOptions[activeSession] || {} : {}
  const currentSession = sessions.find(s => s.id === activeSession)

  if (!authChecked) return null
  const currentToken = localStorage.getItem('access_token') || accessToken
  if (!currentToken) return <Login onLogin={handleLogin} />

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Mobile overlay */}
      {isMobile && (leftSidebarOpen || rightSidebarOpen) && (
        <div
          className="absolute inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => { setLeftSidebarOpen(false); setRightSidebarOpen(false) }}
        />
      )}

      {/* Left sidebar */}
      <div className={`
        ${isMobile ? 'absolute left-0 top-0 h-full z-50' : 'relative'}
        transition-transform duration-300 ease-out
        ${leftSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar
          sessions={sessions}
          activeSession={activeSession}
          sessionOptions={sessionOptions}
          onSelectSession={(id) => { setActiveSession(id); if (isMobile) setLeftSidebarOpen(false) }}
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

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-3 md:px-5 py-2.5 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
              className="btn-icon"
              title={leftSidebarOpen ? '关闭菜单' : '打开菜单'}
            >
              {leftSidebarOpen ? <IconX /> : <IconMenu />}
            </button>

            {activeSession && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {currentSession?.workdir?.split('/').pop() || '未知'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setShowContextManager(true)} disabled={!activeSession} className="btn-icon" title="上下文与Token">
              <IconChart />
            </button>
            <button onClick={() => setShowSettings(true)} className="btn-icon" title="设置">
              <IconSettings />
            </button>
            <button onClick={() => setShowSearch(true)} className="btn-icon" title="搜索 (Ctrl+K)">
              <IconSearch />
            </button>
            <button
              onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
              className={`btn-icon ${rightSidebarOpen ? 'active' : ''}`}
              title={rightSidebarOpen ? '关闭文件面板' : '打开文件面板'}
            >
              <IconPanel />
            </button>
          </div>
        </header>

        {/* Chat area */}
        <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
          {viewingFile ? (
            <FileViewer
              file={viewingFile.path}
              content={viewingFile.content}
              onClose={() => setViewingFile(null)}
              onSave={(newContent) => setViewingFile(prev => ({ ...prev, content: newContent }))}
            />
          ) : activeSession ? (
            <ChatPanel
              sessionId={activeSession}
              options={currentOptions}
              onOptionsChange={(opts) => handleUpdateOptions(activeSession, opts)}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-4">
              <div className="text-center max-w-md" style={{ animation: 'slideUp 0.5s ease' }}>
                <div className="text-6xl mb-6" style={{ filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.3))' }}>🤖</div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Agent Hub</h2>
                <p className="mb-8" style={{ color: 'var(--text-muted)' }}>多 Agent 协作开发平台</p>
                <div className="flex flex-col gap-3 max-w-xs mx-auto">
                  <button onClick={() => setShowProjectManager(true)} className="btn-primary py-3 text-base">
                    📁 打开项目
                  </button>
                  <button onClick={() => setShowNewModal(true)} className="btn-secondary py-3 text-base">
                    ➕ 新建会话
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className={`
        ${isMobile ? 'absolute right-0 top-0 h-full z-50' : 'relative'}
        transition-transform duration-300 ease-out
        ${rightSidebarOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        <RightSidebar
          sessionId={activeSession}
          workdir={currentSession?.workdir}
          onViewFile={handleViewFile}
        />
      </div>

      {/* Modals */}
      {showNewModal && (
        <NewSessionModal
          agents={agents}
          onCreate={createSession}
          onClose={() => setShowNewModal(false)}
          currentWorkdir={currentSession?.workdir}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
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
      {showSearch && (
        <SearchPanel
          onSelectSession={(id) => { setActiveSession(id); if (isMobile) setLeftSidebarOpen(false) }}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  )
}

