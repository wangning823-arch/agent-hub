import React, { useState, useEffect, useRef } from 'react'
import ChatPanel from './components/ChatPanel'
import NewSessionModal from './components/NewSessionModal'
import SettingsPanel from './components/SettingsPanel'
import Sidebar from './components/Sidebar'
import RightSidebar from './components/RightSidebar'
import ContextManager from './components/ContextManager'
import FileViewer from './components/FileViewer'
import SearchPanel from './components/SearchPanel'
import { useToast } from './components/Toast'
import { useTheme } from './components/ThemeContext'
import Login from './components/Login'
import UserManager from './components/UserManager'
import ModelManager from './components/ModelManager'
import AccessControlManager from './components/AccessControlManager'
import CredentialManager from './components/CredentialManager'
import {
  AgentPilotLogo,
  IconMenu,
  IconSearch,
  IconSettings,
  IconChart,
  IconPanel
} from './components/Icons'

const API_BASE = '/api'

// ===================== 类型定义 =====================

interface Session {
  id: string
  agentType: string
  agentName: string
  workdir: string
  messageCount: number
  createdAt: string
  updatedAt: string
  options: Record<string, any>
  isActive: boolean
  isWorking?: boolean
  isStarting?: boolean
  isRestoringMemory?: boolean
  conversationId: string | null
  lastMessageAt: string
  title?: string
  isPinned: boolean
  isArchived: boolean
  tags: string[]
}

interface Agent {
  id: string
  name: string
  type: string
  [key: string]: any
}

interface SessionOptions {
  [sessionId: string]: Record<string, any>
}

interface ViewingFile {
  path: string
  content: string
}

interface SubtaskInfo {
  total: number
  running: number
  completed: number
}

interface CreateSessionOptions extends Record<string, any> {
  title?: string
}

interface UserInfo {
  userId: string
  username: string
  role: 'admin' | 'user'
  homeDir: string
}

// ===================== 主组件 =====================

export default function App() {
  const [accessToken, setAccessToken] = useState<string>(() => localStorage.getItem('access_token') || '')
  const [authChecked, setAuthChecked] = useState<boolean>(false)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [showUserManager, setShowUserManager] = useState<boolean>(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<string | null>(() => localStorage.getItem('activeSession'))
  const [sessionOptions, setSessionOptions] = useState<SessionOptions>({})
  const [showNewModal, setShowNewModal] = useState<boolean>(false)
  const [preselectedProject, setPreselectedProject] = useState<{ id: string; name: string; workdir: string; [key: string]: any } | null>(null)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const toast = useToast()
  const { themeName, syncUserTheme } = useTheme()
  const [showContextManager, setShowContextManager] = useState<boolean>(false)
  const [agents, setAgents] = useState<Agent[]>([])

  const [viewingFile, setViewingFile] = useState<ViewingFile | null>(null)
  const [showSearch, setShowSearch] = useState<boolean>(false)
  const [subtaskInfo, setSubtaskInfo] = useState<SubtaskInfo>({ total: 0, running: 0, completed: 0 })
  const [showSubtaskFromHeader, setShowSubtaskFromHeader] = useState<boolean>(false)

  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState<boolean>(false)
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768)
  const isMobileRef = useRef<boolean>(isMobile)
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => localStorage.getItem('activeProjectId'))
  const [activeProjectWorkdir, setActiveProjectWorkdir] = useState<string | null>(() => localStorage.getItem('activeProjectWorkdir'))
  const [activeProjectName, setActiveProjectName] = useState<string | null>(() => localStorage.getItem('activeProjectName'))

  // 持久化选中状态到 localStorage
  useEffect(() => {
    if (activeSession) localStorage.setItem('activeSession', activeSession)
    else localStorage.removeItem('activeSession')
  }, [activeSession])

  useEffect(() => {
    if (activeProjectId) localStorage.setItem('activeProjectId', activeProjectId)
    else localStorage.removeItem('activeProjectId')
  }, [activeProjectId])

  useEffect(() => {
    if (activeProjectWorkdir) localStorage.setItem('activeProjectWorkdir', activeProjectWorkdir)
    else localStorage.removeItem('activeProjectWorkdir')
  }, [activeProjectWorkdir])

  useEffect(() => {
    if (activeProjectName) localStorage.setItem('activeProjectName', activeProjectName)
    else localStorage.removeItem('activeProjectName')
  }, [activeProjectName])

  // 全局 fetch 拦截，自动加 token 和项目 ID
  useEffect(() => {
    const origFetch = window.fetch
    window.fetch = (url: RequestInfo | URL, opts: RequestInit = {}) => {
      const headers = { ...opts.headers } as Record<string, string>
      const token = localStorage.getItem('access_token')
      if (token) headers['Authorization'] = `Bearer ${token}`
      if (activeProjectId) headers['x-project-id'] = activeProjectId
      return origFetch(url, { ...opts, headers })
    }
    return () => { window.fetch = origFetch }
  }, [activeProjectId])

  // 检查 token 有效性
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setAuthChecked(true); return }
    fetch('/api/auth/me')
      .then(r => {
        if (!r.ok) throw new Error('unauthorized')
        return r.json()
      })
      .then(data => {
        setUser(data)
        setAuthChecked(true)
        // 同步用户主题偏好
        if (data.preferences) {
          syncUserTheme(data.preferences)
        }
      })
      .catch(() => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        setAccessToken('')
        setAuthChecked(true)
      })
  }, [])

  const handleLogin = (token: string): void => {
    setAccessToken(token)
    fetch('/api/auth/me')
      .then(r => {
        if (!r.ok) throw new Error('unauthorized')
        return r.json()
      })
      .then(data => {
        setUser(data)
        // 同步用户主题偏好
        if (data.preferences) {
          syncUserTheme(data.preferences)
        }
      })
      .catch(() => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        setAccessToken('')
      })
  }

  const handleLogout = (): void => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('activeSession')
    localStorage.removeItem('activeProjectId')
    localStorage.removeItem('activeProjectWorkdir')
    localStorage.removeItem('activeProjectName')
    localStorage.removeItem('agent-hub-theme')
    setAccessToken('')
    setUser(null)
    setSessions([])
    setActiveSession(null)
    setActiveProjectId(null)
    setActiveProjectWorkdir(null)
    setActiveProjectName(null)
  }

  const scrollToPanel = (panel: 'left' | 'main' | 'right'): void => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const width = container.clientWidth
    if (panel === 'left') container.scrollTo({ left: 0, behavior: 'smooth' })
    else if (panel === 'main') container.scrollTo({ left: width, behavior: 'smooth' })
    else if (panel === 'right') container.scrollTo({ left: width * 2, behavior: 'smooth' })
  }

  useEffect(() => {
    isMobileRef.current = isMobile
  }, [isMobile])

  // 切换会话时重置子任务面板状态
  useEffect(() => {
    setShowSubtaskFromHeader(false)
    setSubtaskInfo({ total: 0, running: 0, completed: 0 })
  }, [activeSession])

  useEffect(() => {
    const handleResize = (): void => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) {
        setLeftSidebarOpen(true)
        setRightSidebarOpen(true)
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize()
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!isMobile || !scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const width = container.clientWidth
    container.scrollLeft = width
  }, [isMobile])

  // 跟踪是否正在滚动（用户主动滚动）
  const isUserScrollingRef = useRef<boolean>(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isMobile || !scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const handleScroll = (): void => {
      if (!isUserScrollingRef.current) return

      const width = container.clientWidth
      const scrollLeft = container.scrollLeft
      if (scrollLeft < width * 0.3) {
        setLeftSidebarOpen(true)
        setRightSidebarOpen(false)
      } else if (scrollLeft > width * 1.7) {
        setLeftSidebarOpen(false)
        setRightSidebarOpen(true)
      } else {
        setLeftSidebarOpen(false)
        setRightSidebarOpen(false)
      }
    }

    const handleTouchStart = (): void => {
      isUserScrollingRef.current = true
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }

    const handleTouchEnd = (): void => {
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 300)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchend', handleTouchEnd)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [isMobile])

  useEffect(() => {
    fetch(`${API_BASE}/agents`)
      .then(res => res.json())
      .then(data => setAgents(data.agents || []))
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!accessToken) return
    fetch(`${API_BASE}/sessions`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) { setSessions([]); return }
        setSessions(data)
        // 加载所有session的options
        const allOptions: SessionOptions = {}
        data.forEach((s: Session) => {
          if (s.options) {
            allOptions[s.id] = s.options
          }
        })
        setSessionOptions(prev => ({ ...allOptions, ...prev }))

        // 恢复上次选中的 session
        const savedSessionId = localStorage.getItem('activeSession')
        if (savedSessionId) {
          const found = data.find((s: Session) => s.id === savedSessionId)
          if (found) {
            setActiveSession(found.id)
            setActiveProjectWorkdir(found.workdir)
          } else {
            // session 已不存在，清除
            setActiveSession(null)
            setActiveProjectWorkdir(null)
          }
        }

        // 恢复上次选中的项目
        const savedProjectId = localStorage.getItem('activeProjectId')
        if (savedProjectId) {
          setActiveProjectId(savedProjectId)
        }
      })
      .catch(console.error)
  }, [accessToken])

  useEffect(() => {
    const checkAgentStatus = async (): Promise<void> => {
      try {
        const res = await fetch(`${API_BASE}/sessions`)
        const data = await res.json()
        if (!Array.isArray(data)) return

        const statusPromises = data
          .map(async (s: Session) => {
            try {
              const statusRes = await fetch(`${API_BASE}/sessions/${s.id}/status`)
              const status = await statusRes.json()
              return { id: s.id, isActive: status.isActive, isWorking: status.isWorking, isStarting: status.isStarting }
            } catch {
              return { id: s.id, isActive: false, isWorking: false, isStarting: false }
            }
          })

        const statuses = await Promise.all(statusPromises)

        setSessions(prev => prev.map(s => {
          const status = statuses.find(st => st.id === s.id)
          if (status) {
            return { ...s, isActive: status.isActive, isWorking: status.isWorking, isStarting: status.isStarting }
          }
          return s
        }))
      } catch (e) {
        console.error('检查agent状态失败:', e)
      }
    }

    const interval = setInterval(checkAgentStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
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

  const createSession = async (workdir: string, agentType: string = 'claude-code', options: CreateSessionOptions = {}): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir, agentType, ...options })
      })
      const session: Session = await res.json()
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
      if (isMobile) scrollToPanel('main')
    } catch (error) {
      toast.error('创建会话失败: ' + (error as Error).message)
    }
  }

  const removeSession = async (sessionId: string): Promise<void> => {
    if (!window.confirm('确定要删除这个会话吗？删除后无法恢复。')) return
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
      toast.error('删除会话失败: ' + (error as Error).message)
    }
  }

  const resumeSession = async (sessionId: string): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/resume`, { method: 'POST' })
      const result = await res.json()
      if (!res.ok || result.error) {
        const errMsg: string = result.error || `服务器错误 (${res.status})`
        console.error('恢复会话失败:', errMsg)
        setLoadingSessionId(null)
        toast.error('恢复会话失败: ' + errMsg, 0)
        return
      }
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
        // loadingSessionId 已经在点击时设置了
      }
    } catch (error) {
      console.error('恢复会话请求失败:', error)
      setLoadingSessionId(null)
      toast.error('恢复会话失败: ' + (error as Error).message, 0)
    }
  }

  const setSessionWorking = (sessionId: string, isWorking: boolean): void => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isWorking } : s
    ))
  }

  const setSessionStarting = (sessionId: string, isStarting: boolean): void => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isStarting } : s
    ))
  }

  const setSessionRestoringMemory = (sessionId: string, isRestoringMemory: boolean): void => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isRestoringMemory } : s
    ))
  }

  const handleUpdateOptions = (sessionId: string, options: Record<string, any>): void => {
    setSessionOptions(prev => ({ ...prev, [sessionId]: options }))
    // 同步更新后端agent的options（mode/model/effort）
    fetch(`${API_BASE}/sessions/${sessionId}/options`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    }).catch(err => console.error('更新session选项失败:', err))
  }

  const handleProjectChange = (project: { id?: string; workdir?: string; name?: string } | null): void => {
    if (project) {
      // 先设置 projectId，再设置 workdir，确保 fetch 拦截器使用正确的 projectId
      setActiveProjectId(project.id || null)
      setActiveProjectName(project.name || null)
      setTimeout(() => {
        setActiveProjectWorkdir(project.workdir || null)
        setActiveSession(null)
      }, 0)
    } else {
      setActiveProjectId(null)
      setActiveProjectWorkdir(null)
      setActiveProjectName(null)
      setActiveSession(null)
    }
  }

  const handleViewFile = async (filePath: string): Promise<void> => {
    try {
      const data = await fetch(`${API_BASE}/files/content?path=${encodeURIComponent(filePath)}`).then(r => r.json())
      setViewingFile({ path: filePath, content: data.content || '' })
      if (isMobile) scrollToPanel('main')
    } catch (error) {
      toast.error('加载文件失败: ' + (error as Error).message)
    }
  }

  const renameSession = async (sessionId: string, title: string): Promise<void> => {
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
      toast.error('重命名失败: ' + (error as Error).message)
    }
  }

  const pinSession = async (sessionId: string): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/pin`, { method: 'POST' })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      toast.error('置顶操作失败: ' + (error as Error).message)
    }
  }

  const archiveSession = async (sessionId: string): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/archive`, { method: 'POST' })
      const result = await res.json()
      if (result.session) {
        setSessions(prev => prev.map(s => s.id === sessionId ? result.session : s))
      }
    } catch (error) {
      toast.error('归档操作失败: ' + (error as Error).message)
    }
  }

  const currentOptions: Record<string, any> = activeSession ? sessionOptions[activeSession] || {} : {}
  const currentSession: Session | undefined = sessions.find(s => s.id === activeSession)

  if (!authChecked) return null
  const currentToken: string = localStorage.getItem('access_token') || accessToken
  if (!currentToken) return <Login onLogin={handleLogin} />

  // 管理员：显示管理界面
  if (user?.role === 'admin') {
    return <AdminPanel user={user} onLogout={handleLogout} />
  }

  return (
    <div
      ref={scrollContainerRef}
      className={isMobile ? 'mobile-scroll-container' : 'overflow-hidden flex h-screen'}
      style={{
        background: 'var(--bg-primary)',
      }}
    >
      {/* Left sidebar */}
      <div className={isMobile ? 'mobile-panel' : 'relative'}>
        <Sidebar
          sessions={sessions}
          activeSession={activeSession}
          activeProjectId={activeProjectId}
          agentType={currentSession?.agentType || 'claude-code'}
          workdir={currentSession?.workdir || ''}
          sessionOptions={sessionOptions}
          loadingSessionId={loadingSessionId}
          user={user}
          onLogout={handleLogout}
          onShowUserManager={() => setShowUserManager(true)}
          onSetLoading={(id: string | null) => setLoadingSessionId(id)}
          onSelectSession={(id: string) => {
            if (id === activeSession) {
              // 已经是当前会话，直接滑到聊天窗口
              if (isMobile) scrollToPanel('main');
              return;
            }
            setActiveSession(id);
            setLoadingSessionId(id);
            // 不在这里滑动，等加载完成后由 onSessionLoaded 滑动
          }}
          onCloseSession={removeSession}
          onResumeSession={resumeSession}
          onNewSession={(project) => { setPreselectedProject(project || null); setShowNewModal(true) }}
          onUpdateOptions={handleUpdateOptions}
          onRenameSession={renameSession}
          onPinSession={pinSession}
          onArchiveSession={archiveSession}
          onUpdateTags={(id: string, tags: string[]) => {
            setSessions(prev => prev.map(s => s.id === id ? { ...s, tags } : s))
          }}
          onRestoringMemoryChange={setSessionRestoringMemory}
          onProjectChange={handleProjectChange}
        />
      </div>

      {/* Main content */}
      <div className={isMobile ? 'mobile-panel-main' : 'flex-1 flex flex-col overflow-hidden min-w-0'}>
        {/* Header */}
        <header className="flex items-center justify-between px-3 md:px-5 py-2.5 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => isMobile ? scrollToPanel('left') : setLeftSidebarOpen(!leftSidebarOpen)}
              className="btn-icon"
              title="打开菜单"
            >
              <IconMenu />
            </button>

            {(activeSession || activeProjectId) && (
              <div className="flex items-center gap-2">
                <button
                  className="text-sm font-medium hover:underline cursor-pointer"
                  style={{ color: 'var(--text-primary)', background: 'none', border: 'none', padding: 0 }}
                  title="在新窗口中预览项目"
                  onClick={async () => {
                    if (!activeProjectId) return
                    try {
                      const res = await fetch(`${API_BASE}/projects/${activeProjectId}/preview-url`)
                      const data = await res.json()
                      if (import.meta.env.DEV && data.apiUrl) window.open(data.apiUrl, '_blank')
                      else if (data.url) window.open(data.url, '_blank')
                    } catch (e) {
                      toast.error('获取预览地址失败')
                    }
                  }}
                >
                  {activeProjectName || currentSession?.workdir?.split('/').pop() || '未知'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => setShowContextManager(true)} disabled={!activeSession} className="btn-icon" title="上下文与Token">
              <IconChart />
            </button>
            {subtaskInfo.total > 0 && (
              <button
                onClick={() => setShowSubtaskFromHeader(prev => !prev)}
                className="btn-icon"
                title={`并行任务: ${subtaskInfo.completed}/${subtaskInfo.total} 完成${subtaskInfo.running > 0 ? ` (${subtaskInfo.running} 执行中)` : ''}`}
                style={{ position: 'relative' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                {subtaskInfo.running > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
                        style={{ background: 'var(--warning)' }}></span>
                )}
              </button>
            )}
            <button onClick={() => setShowSettings(true)} className="btn-icon" title="设置">
              <IconSettings />
            </button>
            <button onClick={() => setShowSearch(!showSearch)} className={`btn-icon ${showSearch ? 'active' : ''}`} title="搜索 (Ctrl+K)">
              <IconSearch />
            </button>
            <button
              onClick={() => isMobile ? scrollToPanel('right') : setRightSidebarOpen(!rightSidebarOpen)}
              className={`btn-icon ${rightSidebarOpen ? 'active' : ''}`}
              title="打开文件面板"
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
              onSave={(newContent: string) => setViewingFile(prev => prev ? ({ ...prev, content: newContent }) : null)}
            />
          ) : activeSession ? (
            <ChatPanel
              key={activeSession}
              sessionId={activeSession}
              agentType={currentSession?.agentType || 'claude-code'}
              workdir={currentSession?.workdir || ''}
              options={currentOptions}
              isWorking={currentSession?.isWorking || false}
              isStarting={currentSession?.isStarting || false}
              isRestoringMemory={currentSession?.isRestoringMemory || false}
              onOptionsChange={(opts: Record<string, any>) => handleUpdateOptions(activeSession, opts)}
              onWorkingChange={(isWorking: boolean) => setSessionWorking(activeSession, isWorking)}
              onStartingChange={(isStarting: boolean) => setSessionStarting(activeSession, isStarting)}
              onSessionLoaded={() => {
                setLoadingSessionId(null);
                if (isMobile) scrollToPanel('main');
              }}
              onSubtaskCountChange={setSubtaskInfo}
              onSubtaskPanelClose={() => setShowSubtaskFromHeader(false)}
              externalShowPanel={showSubtaskFromHeader}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-4">
              <div className="text-center max-w-md" style={{ animation: 'slideUp 0.5s ease' }}>
                <div className="mb-6" style={{ filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.3))' }}><AgentPilotLogo size={80} /></div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>AgentPilot</h2>
                <p className="mb-8" style={{ color: 'var(--text-muted)' }}>多 Agent 协作开发平台</p>
                <div className="flex flex-col gap-3 max-w-xs mx-auto">
                  <button onClick={() => setShowNewModal(true)} className="btn-primary py-3.5 text-base font-semibold rounded-xl transition-all"
                    style={{
                      background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary, #8b5cf6))',
                      color: '#fff',
                      boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.boxShadow = '0 6px 20px rgba(99,102,241,0.6)')}
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.boxShadow = '0 4px 14px rgba(99,102,241,0.4)')}
                  >
                    &#x26A1; 新建会话
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className={isMobile ? 'mobile-panel' : 'relative'}>
        <RightSidebar
          sessionId={activeSession!}
          workdir={activeProjectWorkdir || currentSession?.workdir}
          onViewFile={handleViewFile}
        />
      </div>

      {/* Modals */}
      {showNewModal && (
        <NewSessionModal
          agents={agents}
          onCreate={createSession}
          onClose={() => { setShowNewModal(false); setPreselectedProject(null) }}
          preselectedProject={preselectedProject}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showContextManager && activeSession && (
        <ContextManager
          sessionId={activeSession}
          onClose={() => setShowContextManager(false)}
        />
      )}
      {showSearch && (
        <SearchPanel
          onSelectSession={(id: string) => {
            if (id === activeSession) {
              if (isMobile) scrollToPanel('main');
              return;
            }
            setActiveSession(id);
            setLoadingSessionId(id);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showUserManager && <UserManager onClose={() => setShowUserManager(false)} />}
    </div>
  )
}

// ===================== 管理员面板 =====================

function AdminPanel({ user, onLogout }: { user: { username: string; role: string }; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState('users')

  const tabs = [
    { key: 'users', icon: '👥', label: '用户管理' },
    { key: 'models', icon: '🤖', label: '模型管理' },
    { key: 'credentials', icon: '🔑', label: '凭证管理' },
    { key: 'access', icon: '🔐', label: '权限分配' },
  ]

  return (
    <div className="overflow-hidden flex flex-col h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="flex items-center justify-between px-5 py-3 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>AgentPilot 管理面板</span>
          <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{user?.username}</span>
          <button onClick={onLogout} className="text-sm px-3 py-1.5 rounded transition-colors" style={{ color: 'var(--error)', border: '1px solid var(--border-subtle)' }}>
            退出登录
          </button>
        </div>
      </header>
      {/* 标签页 */}
      <div className="flex border-b px-5" style={{ borderColor: 'var(--border-subtle)' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="tab-btn"
            style={{
              padding: '10px 20px',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
              color: activeTab === tab.key ? 'var(--accent-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.key ? 600 : 400,
              background: 'transparent',
              border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.key ? 'var(--accent-primary)' : 'transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>
      {/* 内容 */}
      <div className="flex-1 overflow-auto p-5">
        {activeTab === 'users' && <UserManager onClose={() => {}} fullPage />}
        {activeTab === 'models' && <ModelManager />}
        {activeTab === 'credentials' && <CredentialManager />}
        {activeTab === 'access' && <AccessControlManager />}
      </div>
    </div>
  )
}
