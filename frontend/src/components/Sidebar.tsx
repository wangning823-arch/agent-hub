import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'
import { Tag, TagFilter } from './Tag'
import { API_BASE, getWebSocketUrl } from '../config'
import {
  AgentPilotLogo,
  IconPlus,
  IconPin,
  IconEdit,
  IconArchive,
  IconTag,
  IconTrash,
  IconChevron,
  IconPause,
  IconRunning,
  IconCheck,
  IconExternal,
  IconSettings,
  IconLogout,
  IconList,
  IconChat
} from './Icons'

// ---- Type Definitions ----

interface OptionItem {
  id: string
  name: string
  description?: string
}

interface CommandItem {
  id: string
  name: string
  description: string
  usage: string
  category?: string
}

interface SkillItem {
  id: string
  name: string
  description?: string
  plugin?: string
  source?: string
}

interface Session {
  id: string
  title?: string
  workdir: string
  agentType?: string
  isActive?: boolean
  isPinned?: boolean
  isArchived?: boolean
  isWorking?: boolean
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

interface SessionOptions {
  [sessionId: string]: {
    mode?: string
    model?: string
    effort?: string
  }
}

interface Options {
  modes: OptionItem[]
  models: OptionItem[]
  efforts: OptionItem[]
}

interface AgentLabel {
  text: string
  color: string
}

interface SectionHeaderProps {
  icon: React.ReactNode
  label: string
  count?: number
  section: string
}

interface IconChevronProps {
  open: boolean
}

interface UserInfo {
  userId: string
  username: string
  role: 'admin' | 'user'
  homeDir?: string
}

interface SidebarProps {
  sessions: Session[]
  activeSession: string | null
  activeProjectId?: string | null
  agentType?: string
  workdir?: string
  sessionOptions: SessionOptions
  loadingSessionId: string | null
  user?: UserInfo | null
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onResumeSession: (id: string) => void
  onNewSession: (project?: Project) => void
  onUpdateOptions: (sessionId: string, options: Record<string, unknown>) => void
  onRenameSession: (id: string, title: string) => void
  onPinSession: (id: string) => void
  onArchiveSession: (id: string) => void
  onUpdateTags: (id: string, tags: string[]) => void
  onSetLoading: (id: string | null) => void
  onRestoringMemoryChange?: (id: string, restoring: boolean) => void
  onProjectChange?: (project: Project | null) => void
  onLogout?: () => void
  onShowUserManager?: () => void
  onShowAdminPanel?: () => void
}

interface Project {
  id: string
  name: string
  workdir: string
  favorite?: boolean
  hasPassword?: boolean
}

export default function Sidebar({
  sessions,
  activeSession,
  activeProjectId,
  agentType = 'claude-code',
  workdir = '',
  sessionOptions,
  loadingSessionId,
  user,
  onSelectSession,
  onCloseSession,
  onResumeSession,
  onNewSession,
  onUpdateOptions,
  onRenameSession,
  onPinSession,
  onArchiveSession,
  onUpdateTags,
  onSetLoading,
  onRestoringMemoryChange,
  onProjectChange,
  onLogout,
  onShowUserManager,
  onShowAdminPanel
}: SidebarProps) {
  const toast = useToast()
  const [expandedSection, setExpandedSection] = useState<string>('sessions')
  const [options, setOptions] = useState<Options>({ modes: [], models: [], efforts: [] })
  const [commands, setCommands] = useState<CommandItem[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [editingTags, setEditingTags] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [installSource, setInstallSource] = useState('')
  const [installing, setInstalling] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectPasswordPrompt, setProjectPasswordPrompt] = useState<{
    project: Project
    loading: boolean
    error: string
  } | null>(null)
  const [projectPassword, setProjectPassword] = useState('')
  const [verifiedProjectIds, setVerifiedProjectIds] = useState<Set<string>>(new Set())
  const [showProjectPopover, setShowProjectPopover] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [createMode, setCreateMode] = useState<'git' | 'manual'>('git')
  const [newProject, setNewProject] = useState({ name: '', workdir: '', password: '', confirmPassword: '' })
  const [gitUrl, setGitUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [credentials, setCredentials] = useState<Array<{ id: string; host: string; type: string; username?: string; isPersonal?: boolean }>>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState('')

  const skillDescriptionTranslations: Record<string, string> = {
    // 通用命令
    'code-review': '审查代码变更，提供改进建议',
    'debug': '帮助调试代码问题',
    'explain': '解释代码逻辑和功能',
    'refactor': '重构代码，改善可读性和性能',
    'test': '编写测试用例',
    'docs': '编写项目文档',
    'security': '安全审查代码',
    'deploy': '部署应用到生产环境',
    'migrate': '迁移数据库或代码库',
    'optimize': '优化代码性能和资源使用',
    // Claude 官方插件
    'agent-sdk-dev': '开发 AI Agent SDK 应用',
    'clangd-lsp': 'C/C++ 语言服务支持',
    'claude-automation-recommender': '分析代码库并推荐 Claude Code 自动化配置',
    'claude-code-setup': '快速配置 Claude Code 项目',
    'claude-md-improver': '审查和改进 CLAUDE.md 文件',
    'claude-md-management': '管理 CLAUDE.md 项目配置文档',
    'code-simplifier': '简化复杂代码，提升可读性',
    'commit-commands': '生成规范的 Git 提交信息',
    'csharp-lsp': 'C# 语言服务支持',
    'explanatory-output-style': '提供详细解释的输出风格',
    'feature-dev': '开发新功能和特性',
    'frontend-design': '设计前端界面和组件',
    'gopls-lsp': 'Go 语言服务支持',
    'hookify': '配置 Claude Code 钩子脚本',
    'jdtls-lsp': 'Java 语言服务支持',
    'kotlin-lsp': 'Kotlin 语言服务支持',
    'learning-output-style': '适合学习理解的输出风格',
    'lua-lsp': 'Lua 语言服务支持',
    'math-olympiad': '解决数学竞赛问题',
    'mcp-server-dev': '开发 MCP 服务器',
    'php-lsp': 'PHP 语言服务支持',
    'playground': '创建交互式 HTML 演示工具',
    'plugin-dev': '开发 Claude Code 插件',
    'pr-review-toolkit': '全面的 PR 审查工具集',
    'pyright-lsp': 'Python 语言服务支持',
    'ralph-loop': '自动化循环任务执行',
    'ruby-lsp': 'Ruby 语言服务支持',
    'rust-analyzer-lsp': 'Rust 语言服务支持',
    'security-guidance': '安全编码指导和检查',
    'session-report': '生成会话工作报告',
    'skill-creator': '创建自定义 Skill 技能',
    'swift-lsp': 'Swift 语言服务支持',
    'typescript-lsp': 'TypeScript 语言服务支持',
    // 外部插件 Skills
    'access': '管理渠道访问权限，审批配对，编辑白名单',
    'configure': '配置消息渠道，设置机器人令牌和访问策略',
    // Plugin Dev 子技能
    'agent-development': '开发 Claude Code 子代理，定义系统提示和触发条件',
    'command-development': '创建自定义斜杠命令',
    'hook-development': '开发 Claude Code 钩子脚本',
    'mcp-integration': '集成 MCP 服务器到插件',
    'plugin-settings': '管理插件配置和设置',
    'plugin-structure': '创建和组织 Claude Code 插件结构',
    'skill-development': '开发和优化技能',
    'writing-rules': '编写 Hookify 规则',
    // MCP Server Dev 子技能
    'build-mcp-app': '构建带交互式 UI 的 MCP 应用',
    'build-mcpb': '打包和分发 MCP 服务器',
    'build-mcp-server': '创建 MCP 服务器和工具',
    // 示例插件
    'example-command': '示例用户调用技能，演示 frontmatter 选项',
    'example-skill': '示例技能模板，用于演示技能格式',
  }

  const getSkillDescription = (skill: SkillItem): string => {
    if (skill.description && skill.description.trim()) {
      return skill.description
    }
    const key = skill.id?.toLowerCase() || skill.name?.toLowerCase() || ''
    for (const [k, v] of Object.entries(skillDescriptionTranslations)) {
      if (key.includes(k)) return v
    }
    return skill.plugin || skill.id || ''
  }

  useEffect(() => {
    loadOptions()
    loadCommands()
    loadTags()
    loadSkills()
    loadProjects()
  }, [agentType, workdir])

  // 同步父组件传入的 activeProjectId
  useEffect(() => {
    if (activeProjectId && Array.isArray(projects) && projects.some(p => p.id === activeProjectId)) {
      setSelectedProjectId(activeProjectId)
    }
  }, [activeProjectId, projects])

  const loadProjects = async () => {
    try {
      const data = await fetch(`${API_BASE}/projects`).then(r => r.json())
      if (Array.isArray(data)) {
        setProjects(data)
      }
    } catch (error) { console.error('加载项目失败:', error) }
  }

  const toggleFavorite = async (projectId: string) => {
    try {
      await fetch(`${API_BASE}/projects/${projectId}/favorite`, { method: 'POST' })
      await loadProjects()
    } catch (error) { toast.error('操作失败') }
  }

  const deleteProject = async (projectId: string) => {
    if (!confirm('确定要删除这个项目吗？')) return
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' }).then(r => r.json())
      if (res.success) {
        toast.success('项目已删除')
        if (selectedProjectId === projectId) {
          setSelectedProjectId('')
          if (onProjectChange) onProjectChange(null)
        }
        await loadProjects()
      }
    } catch (error) { toast.error('删除失败') }
  }

  const createProject = async () => {
    if (newProject.password && newProject.password !== newProject.confirmPassword) {
      toast.error('两次输入的密码不一致'); return
    }
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProject.name,
          workdir: newProject.workdir,
          password: newProject.password || undefined
        })
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '创建失败'); return }
      toast.success('项目已创建')
      setNewProject({ name: '', workdir: '', password: '', confirmPassword: '' })
      setShowCreateProject(false)
      await loadProjects()
    } catch (error: any) { toast.error('创建失败: ' + error.message) }
  }

  const fetchCredentials = async () => {
    try {
      const res = await fetch(`${API_BASE}/my-credentials`)
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.credentials || [])
      setCredentials(list)
      if (list.length > 0 && !selectedCredentialId) {
        setSelectedCredentialId(list[0].id)
      }
    } catch (e) { console.error('加载凭证失败:', e) }
  }

  const importFromGit = async () => {
    if (!gitUrl.trim()) { toast.warning('请输入 Git 仓库地址'); return }
    setImporting(true)
    try {
      const body: any = { gitUrl: gitUrl.trim(), password: newProject.password || undefined }
      if (selectedCredentialId) body.credentialId = selectedCredentialId
      const result = await fetch(`${API_BASE}/projects/import-git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json())
      if (result.error) { toast.error(result.error); return }
      if (result.status === 'existing') {
        toast.info(result.message)
      } else if (result.status === 'imported') {
        toast.success(result.message)
      } else {
        toast.success(result.message)
      }
      loadProjects()
      setShowCreateProject(false)
      setGitUrl('')
      setNewProject({ name: '', workdir: '', password: '', confirmPassword: '' })
    } catch (error: any) {
      toast.error('导入失败: ' + error.message)
    } finally {
      setImporting(false)
    }
  }

  const handleProjectSelect = async (projectId: string) => {
    if (!projectId) {
      setSelectedProjectId('')
      if (onProjectChange) onProjectChange(null)
      return
    }
    if (!Array.isArray(projects)) return
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    if (project.hasPassword && !verifiedProjectIds.has(projectId)) {
      setProjectPasswordPrompt({ project, loading: false, error: '' })
      setProjectPassword('')
      return
    }

    setSelectedProjectId(projectId)
    if (onProjectChange) onProjectChange(project)
  }

  const verifyProjectPassword = async () => {
    if (!projectPasswordPrompt) return
    setProjectPasswordPrompt(prev => prev ? { ...prev, loading: true, error: '' } : null)
    try {
      const res = await fetch(`${API_BASE}/projects/${projectPasswordPrompt.project.id}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: projectPassword })
      }).then(r => r.json())

      if (res.valid) {
        setVerifiedProjectIds(prev => new Set([...prev, projectPasswordPrompt.project.id]))
        setSelectedProjectId(projectPasswordPrompt.project.id)
        if (onProjectChange) onProjectChange(projectPasswordPrompt.project)
        setProjectPasswordPrompt(null)
      } else {
        setProjectPasswordPrompt(prev => prev ? { ...prev, loading: false, error: '密码错误' } : null)
      }
    } catch (error: any) {
      setProjectPasswordPrompt(prev => prev ? { ...prev, loading: false, error: error.message } : null)
    }
  }

  useEffect(() => {
    const handler = () => loadOptions()
    window.addEventListener('models-changed', handler)
    return () => window.removeEventListener('models-changed', handler)
  }, [agentType, workdir])

  const loadOptions = async () => {
    try {
      const params = new URLSearchParams({ agentType })
      if (workdir) params.set('workdir', workdir)
      const data = await fetch(`${API_BASE}/options?${params}`).then(r => r.json())
      setOptions(data)
    } catch (error) { console.error('加载选项失败:', error) }
  }

  const loadCommands = async () => {
    try {
      const data = await fetch(`${API_BASE}/options/commands?agentType=${agentType}`).then(r => r.json())
      setCommands(data.commands || [])
    } catch (error) { console.error('加载命令失败:', error) }
  }

  const loadTags = async () => {
    try {
      const data = await fetch(`${API_BASE}/tags`).then(r => r.json())
      setAllTags(data.tags || [])
    } catch (error) { console.error('加载标签失败:', error) }
  }

  const loadSkills = async () => {
    try {
      const data = await fetch(`${API_BASE}/skills/${agentType}`).then(r => r.json())
      setSkills(data.skills || [])
    } catch (error) { console.error('加载 Skills 失败:', error) }
  }

  const handleInstallSkill = async () => {
    if (!installSource.trim()) return
    setInstalling(true)
    try {
      const res = await fetch(`${API_BASE}/skills/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType, source: installSource.trim() })
      })
      const result = await res.json()
      if (result.success) {
        setSkills(result.skills || [])
        toast.success('安装成功！')
        setShowInstallModal(false)
        setInstallSource('')
      } else {
        toast.error(result.error || '安装失败')
      }
    } catch (error: any) { toast.error('安装失败: ' + error.message) }
    setInstalling(false)
  }

  const handleSkillClick = (skill: SkillItem) => {
    const msg = skill.id.includes(':') ? `/${skill.id}` : `/${skill.name.replace(/\s+/g, '-').toLowerCase()}`
    const event = new CustomEvent('send-message', { detail: { message: msg } })
    window.dispatchEvent(event)
  }

  const currentOptions = activeSession ? sessionOptions[activeSession] || {} : {}

  const handleOptionChange = async (type: string, value: string) => {
    if (!activeSession) return
    const newOptions = { ...currentOptions, [type]: value }
    const ws = new WebSocket(getWebSocketUrl(activeSession))
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'command', command: `set_${type}`, params: { [type]: value } }))
      setTimeout(() => ws.close(), 300)
    }
    onUpdateOptions(activeSession, newOptions)
  }

  const handleCommand = (cmd: CommandItem) => {
    const event = new CustomEvent('send-message', { detail: { message: cmd.usage } })
    window.dispatchEvent(event)
  }

  const getDisplayName = (workdirPath: string) => {
    const parts = workdirPath.split('/').filter(Boolean)
    return parts[parts.length - 1] || workdirPath
  }

  const getAgentLabel = (type: string): AgentLabel => {
    const labels: Record<string, AgentLabel> = {
      'claude-code': { text: 'CC', color: '#e8a838' },
      'opencode': { text: 'OC', color: '#4ade80' },
      'codex': { text: 'CX', color: '#60a5fa' },
    }
    return labels[type] || { text: type?.toUpperCase()?.slice(0, 2) || '??', color: '#888' }
  }

  const sortedSessions = (selectedProjectId
    ? [...sessions]
        .filter((s): s is Session => {
          if (!s) return false
          if (showArchived ? !s.isArchived : s.isArchived) return false
          const project = Array.isArray(projects) ? projects.find(p => p.id === selectedProjectId) : undefined
          if (project && !(s.workdir || '').startsWith(project.workdir)) return false
          if (selectedTags.length > 0) {
            const sessionTags = s.tags || []
            return selectedTags.some(tag => sessionTags.includes(tag))
          }
          return true
        })
    : []
  ).sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
  })

  const handleRename = (sessionId: string) => {
    if (editTitle.trim()) onRenameSession(sessionId, editTitle.trim())
    setEditingSession(null)
    setEditTitle('')
  }

  const groupedCommands: Record<string, CommandItem[]> = commands.reduce<Record<string, CommandItem[]>>((groups, cmd) => {
    const category = cmd.category || '其他'
    if (!groups[category]) groups[category] = []
    groups[category].push(cmd)
    return groups
  }, {})

  const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, label, count, section }) => (
    <button
      onClick={() => setExpandedSection(expandedSection === section ? '' : section)}
      className="w-full px-4 py-3 flex items-center justify-between"
      style={{ color: 'var(--text-secondary)' }}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon} {label}
        {count !== undefined && <span className="badge badge-count">{count}</span>}
      </span>
      <IconChevron open={expandedSection === section} />
    </button>
  )

  return (
    <div className="panel w-72 flex flex-col h-full overflow-hidden" style={{ width: 280 }}>
      {/* Logo */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <h1 className="text-lg font-bold flex items-center gap-2.5" style={{ color: 'var(--text-primary)' }}>
          <AgentPilotLogo size={32} />
          AgentPilot
        </h1>
      </div>

      {/* Project selector */}
      <div className="px-3 pt-3 pb-1 relative">
        <button
          onClick={() => setShowProjectPopover(!showProjectPopover)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors"
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            {selectedProjectId ? (
              <>
                {projects.find(p => p.id === selectedProjectId)?.hasPassword && <span className="shrink-0">🔒</span>}
                <span className="truncate">{projects.find(p => p.id === selectedProjectId)?.name || '选择项目'}</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>请选择项目</span>
            )}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: 'var(--text-muted)', transform: showProjectPopover ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showProjectPopover && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowProjectPopover(false)} />
            <div
              className="absolute left-3 right-3 top-full mt-1 z-50 rounded-lg overflow-hidden"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-lg)',
                maxHeight: 320,
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div className="overflow-y-auto flex-1">
                {projects.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    暂无项目
                  </div>
                ) : (
                  [...projects].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)).map(project => (
                    <div
                      key={project.id}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
                      style={{
                        background: project.id === selectedProjectId ? 'var(--accent-primary-soft)' : 'transparent',
                        color: 'var(--text-primary)'
                      }}
                      onMouseEnter={(e) => { if (project.id !== selectedProjectId) e.currentTarget.style.background = 'var(--bg-tertiary)' }}
                      onMouseLeave={(e) => { if (project.id !== selectedProjectId) e.currentTarget.style.background = 'transparent' }}
                      onClick={() => { handleProjectSelect(project.id); setShowProjectPopover(false) }}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {project.hasPassword && <span className="mr-1">🔒</span>}
                        {project.name}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(project.id) }}
                        className="shrink-0 p-0.5 rounded transition-colors"
                        style={{ color: project.favorite ? '#fbbf24' : 'var(--text-muted)', fontSize: 14 }}
                        title={project.favorite ? '取消收藏' : '收藏'}
                      >
                        {project.favorite ? '★' : '☆'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteProject(project.id) }}
                        className="shrink-0 p-0.5 rounded transition-colors"
                        style={{ color: 'var(--text-muted)', fontSize: 12 }}
                        title="删除"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  onClick={() => { setShowProjectPopover(false); setShowCreateProject(true); fetchCredentials() }}
                  className="w-full text-left px-2 py-1.5 rounded text-xs transition-colors"
                  style={{ color: 'var(--accent-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  + 新建项目
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sessions - always visible */}
        <div className="border-b flex flex-col" style={{ borderColor: 'var(--border-subtle)', minHeight: 0 }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <IconList size={16} /> 会话列表
              <span className="badge badge-count">{sortedSessions.length}</span>
            </span>
          </div>

          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                {showArchived ? <IconArchive size={14} /> : <IconChat size={14} />}
                {showArchived ? '已归档' : '活跃会话'}
              </span>
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="text-xs font-medium flex items-center gap-1"
                style={{ color: 'var(--accent-primary)' }}
              >
                {showArchived ? <><IconChat size={12} /> 查看活跃</> : <><IconArchive size={12} /> 查看归档</>}
              </button>
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <TagFilter
                tags={allTags}
                selectedTags={selectedTags}
                onToggleTag={(tag: string) => setSelectedTags(prev =>
                  prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                )}
                onClearTags={() => setSelectedTags([])}
              />
            </div>
          )}

          <div className="overflow-y-auto flex-1" style={{ minHeight: 240, maxHeight: 400 }}>
            {!selectedProjectId ? (
              <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                请先选择一个项目
              </div>
            ) : sortedSessions.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                {showArchived ? '没有已归档的会话' : '还没有会话'}
              </div>
            ) : (
              sortedSessions.map(session => (
                <div
                  key={session.id}
                  onClick={() => {
                    if (session.isActive) {
                      onSelectSession(session.id);
                    } else {
                      // 立即显示加载中，不等 API 返回
                      if (onSetLoading) onSetLoading(session.id);
                      onResumeSession(session.id);
                    }
                  }}
                  className={`sidebar-item group ${activeSession === session.id ? 'active' : ''}`}
                  style={{ flexDirection: 'column', alignItems: 'stretch' }}
                >
                  <div className="flex items-center gap-2 min-w-0 w-full">
                      {session.isPinned && <span className="text-xs flex-shrink-0" style={{ color: 'var(--warning)' }}>📌</span>}
                      {session.isWorking ? <IconRunning /> : session.isActive ? <span className="text-xs" style={{ color: 'var(--success, #22c55e)' }}>●</span> : <IconPause />}
                      {editingSession === session.id ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTitle(e.target.value)}
                          onBlur={() => handleRename(session.id)}
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') handleRename(session.id)
                            if (e.key === 'Escape') { setEditingSession(null); setEditTitle('') }
                          }}
                          onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                          className="input-field text-sm py-1 px-2 flex-1 min-w-0"
                          autoFocus
                        />
                      ) : (
                        <span className="text-xs flex-1 min-w-0 truncate flex items-center gap-1" style={{ lineHeight: '1.4' }}>
                          <span className="truncate">{session.title || getDisplayName(session.workdir)}</span>
                          {session.agentType && (
                            <span className="flex-shrink-0 text-[10px] font-bold px-1 rounded"
                              style={{ color: getAgentLabel(session.agentType).color, background: getAgentLabel(session.agentType).color + '18', lineHeight: '1.4' }}>
                              {getAgentLabel(session.agentType).text}
                            </span>
                          )}
                          {loadingSessionId === session.id && (
                            <span className="flex-shrink-0 text-[10px] flex items-center gap-1" style={{ color: 'var(--accent-primary)' }}>
                              <span className="animate-spin inline-block" style={{ animationDuration: '1s' }}>⏳</span>
                              <span>加载中...</span>
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {session.tags && session.tags.length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {session.tags.slice(0, 3).map(tag => (
                          <Tag key={tag} name={tag} small />
                        ))}
                        {session.tags.length > 3 && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>+{session.tags.length - 3}</span>
                        )}
                      </div>
                    )}

                    {/* Action buttons - on new line, visible on hover/focus */}
                    <div className="flex items-center gap-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ borderBottom: 'none' }}
                    >
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onPinSession(session.id) }}
                        className="btn-icon text-xs"
                        style={{ color: session.isPinned ? 'var(--warning)' : 'var(--text-muted)', width: 22, height: 22 }}
                        title={session.isPinned ? '取消置顶' : '置顶'}
                      >
                        <IconPin />
                      </button>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditingSession(session.id); setEditTitle(session.title || getDisplayName(session.workdir)) }}
                        className="btn-icon text-xs"
                        style={{ width: 22, height: 22 }}
                        title="重命名"
                      >
                        <IconEdit />
                      </button>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onArchiveSession(session.id) }}
                        className="btn-icon text-xs"
                        style={{ width: 22, height: 22 }}
                        title={session.isArchived ? '取消归档' : '归档'}
                      >
                        <IconArchive />
                      </button>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditingTags(editingTags === session.id ? null : session.id) }}
                        className="btn-icon text-xs"
                        style={{ color: (session.tags?.length ?? 0) > 0 ? 'var(--accent-primary)' : 'var(--text-muted)', width: 22, height: 22 }}
                        title="标签"
                      >
                        <IconTag />
                      </button>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onCloseSession(session.id) }}
                        className="btn-icon text-xs"
                        style={{ color: 'var(--text-muted)', width: 22, height: 22 }}
                        title="删除"
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.color = 'var(--error)')}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.color = 'var(--text-muted)')}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

          <div className="px-3 py-2">
            {selectedProjectId && (
              <button
                onClick={() => {
                  const project = projects.find(p => p.id === selectedProjectId)
                  onNewSession(project)
                }}
                className="btn-secondary w-full text-sm py-2.5 flex items-center justify-center gap-2"
              >
                <IconPlus /> 新建会话
              </button>
            )}
          </div>
        </div>

        {/* Session Controls */}
        <div className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <SectionHeader icon="⚙️" label="会话控制" section="controls" />

          {expandedSection === 'controls' && (
            <div className="px-4 py-3 space-y-4">
              {!activeSession ? (
                <div className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                  请先选择一个会话
                </div>
              ) : (
                <>
                  {/* Current config */}
                  <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
                    {currentOptions.mode && <div>模式: {currentOptions.mode}</div>}
                    {currentOptions.model && <div>模型: {currentOptions.model}</div>}
                    {currentOptions.effort && <div>努力: {currentOptions.effort}</div>}
                  </div>

                  {/* 恢复记忆按钮 */}
                  <button
                    onClick={async () => {
                      if (!activeSession) return
                      try {
                        if (onRestoringMemoryChange) onRestoringMemoryChange(activeSession, true)
                        const res = await fetch(`${API_BASE}/sessions/${activeSession}/restore-memory`, { method: 'POST' })
                        const data = await res.json()
                        if (data.success) {
                          if (data.summary) {
                            toast.success('记忆已恢复！')
                          } else {
                            toast.info(data.message || '无需恢复')
                          }
                        } else {
                          toast.error(data.error || '恢复失败')
                        }
                      } catch (e: any) {
                        toast.error('恢复记忆失败: ' + e.message)
                      } finally {
                        if (onRestoringMemoryChange) onRestoringMemoryChange(activeSession, false)
                      }
                    }}
                    className="btn-secondary w-full text-sm py-2 flex items-center justify-center gap-2"
                  >
                    恢复记忆
                  </button>

                  {/* Permission modes */}
                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>权限模式</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {options.modes.slice(0, 4).map(mode => (
                        <button
                          key={mode.id}
                          onClick={() => handleOptionChange('mode', mode.id)}
                          className={`btn-segment ${currentOptions.mode === mode.id ? 'active' : ''}`}
                          title={mode.description}
                        >
                          {mode.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model select */}
                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>模型</label>
                    <select
                      value={currentOptions.model || ''}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleOptionChange('model', e.target.value)}
                      className="select-field w-full"
                    >
                      <option value="">默认模型</option>
                      {options.models.map(model => (
                        <option key={model.id} value={model.id}>{model.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Effort */}
                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>努力程度</label>
                    <div className="flex gap-1.5">
                      {options.efforts.map(effort => (
                        <button
                          key={effort.id}
                          onClick={() => handleOptionChange('effort', effort.id)}
                          className={`btn-segment flex-1 ${currentOptions.effort === effort.id ? 'active' : ''}`}
                          title={effort.description}
                        >
                          {effort.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Commands */}
        <div>
          <SectionHeader icon="⌘" label="命令" count={commands.length} section="commands" />

          {expandedSection === 'commands' && (
            <div className="pb-2 max-h-80 overflow-y-auto">
              {Object.entries(groupedCommands).map(([category, cmds]) => (
                <div key={category}>
                  <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)' }}>
                    {category}
                  </div>
                  {cmds.map(cmd => (
                    <button
                      key={cmd.id}
                      onClick={() => handleCommand(cmd)}
                      className="w-full px-4 py-2 text-left transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{cmd.name}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{cmd.description}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {}
        <div>
          <SectionHeader icon="🎯" label="技能" count={skills.length} section="skills" />

          {expandedSection === 'skills' && (
            <div className="pb-2 max-h-80 overflow-y-auto">
              {skills.length === 0 ? (
                <div className="px-4 py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  暂无可用技能
                </div>
              ) : (
                skills.map((skill, idx) => (
                  <button
                    key={`${skill.id}-${idx}`}
                    onClick={() => handleSkillClick(skill)}
                    className="w-full px-4 py-2 text-left transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{skill.name}</span>
                      {skill.source === 'official' && <span className="badge badge-official">官方</span>}
                      {skill.source === 'local' && <span className="badge badge-local">本地</span>}
                    </div>
                    <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {getSkillDescription(skill)}
                    </div>
                  </button>
                ))
              )}
              <div className="px-4 py-2 mt-1">
                <button
                  onClick={() => setShowInstallModal(true)}
                  className="btn-secondary w-full text-sm py-2 flex items-center justify-center gap-2"
                >
                  <IconPlus /> 安装新技能
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom user info */}
      <div className="p-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
            {user?.username || 'User'}
          </span>
          {user?.role === 'admin' && (
            <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>
              Admin
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {user?.role === 'admin' && onShowUserManager && (
            <button
              onClick={onShowUserManager}
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              title="用户管理"
            >
              <IconSettings />
            </button>
          )}
          {user?.role === 'admin' && onShowAdminPanel && (
            <button
              onClick={onShowAdminPanel}
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              title="管理面板"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              title="退出登录"
            >
              <IconLogout size={16} color="var(--error)" />
            </button>
          )}
        </div>
      </div>

      {showInstallModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg w-full max-w-md overflow-hidden shadow-2xl border border-gray-700">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-white">安装新技能</h2>
              <button onClick={() => setShowInstallModal(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-400">输入 GitHub 地址、Git URL 或 Marketplace 名称</p>
              <input
                type="text"
                value={installSource}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInstallSource(e.target.value)}
                placeholder="e.g., anthropics/claude-code 或 https://..."
                className="input-field w-full"
                autoFocus
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleInstallSkill()}
              />
              <div className="text-xs text-gray-500 space-y-1">
                <div>支持的格式：</div>
                <div>• GitHub: owner/repo 或 owner/repo#branch</div>
                <div>• Git URL: https://gitlab.com/... 或 git@github.com:...</div>
                <div>• 远程 marketplace: https://example.com/marketplace.json</div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button onClick={() => setShowInstallModal(false)} className="px-4 py-2 text-gray-400 hover:text-white">取消</button>
              <button onClick={handleInstallSkill} disabled={installing || !installSource.trim()} className="btn-primary px-4 py-2">
                {installing ? '安装中...' : '安装'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create project modal */}
      {showCreateProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-lg p-6 w-full max-w-md" style={{ background: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>新建项目</h3>

            <div className="flex gap-1 mb-4 rounded p-1" style={{ background: 'var(--bg-tertiary)' }}>
              <button
                onClick={() => setCreateMode('git')}
                className="flex-1 py-2 px-3 rounded text-sm font-medium transition-colors"
                style={createMode === 'git' ? { background: 'var(--accent-primary)', color: '#fff' } : { color: 'var(--text-muted)' }}
              >
                从 Git 克隆
              </button>
              <button
                onClick={() => setCreateMode('manual')}
                className="flex-1 py-2 px-3 rounded text-sm font-medium transition-colors"
                style={createMode === 'manual' ? { background: 'var(--accent-primary)', color: '#fff' } : { color: 'var(--text-muted)' }}
              >
                手动创建
              </button>
            </div>

            <div className="space-y-4">
              {createMode === 'git' ? (
                <>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>Git 仓库地址 *</label>
                    <input
                      type="text"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      className="w-full px-3 py-2 rounded"
                      style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      placeholder="https://github.com/user/repo 或 user/repo"
                      onKeyDown={(e) => { if (e.key === 'Enter') importFromGit() }}
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      支持 GitHub/GitLab/Bitbucket，本地已有则直接进入
                    </p>
                  </div>
                  {credentials.length > 0 && (
                    <div>
                      <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>使用凭证</label>
                      <select
                        value={selectedCredentialId}
                        onChange={(e) => setSelectedCredentialId(e.target.value)}
                        className="w-full px-3 py-2 rounded text-sm"
                        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      >
                        {credentials.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.username ? c.username + '@' : ''}{c.host} ({c.type === 'token' ? 'Token' : 'SSH'}){c.isPersonal ? ' [个人]' : ' [系统]'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>项目名称 *</label>
                    <input
                      type="text"
                      value={newProject.name}
                      onChange={(e) => {
                        const name = e.target.value
                        const slug = name.toLowerCase().replace(/\s+/g, '-')
                        setNewProject(prev => ({ ...prev, name, workdir: name ? `${user?.homeDir || '~'}/projects/${slug}` : '' }))
                      }}
                      className="w-full px-3 py-2 rounded"
                      style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      placeholder="我的项目"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>项目目录 (自动生成)</label>
                    <input
                      type="text"
                      value={newProject.workdir ? newProject.workdir.replace(user?.homeDir || '', '~') : ''}
                      readOnly
                      className="w-full px-3 py-2 rounded opacity-70"
                      style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      将创建在 ~/projects/ 目录下
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>项目密码 (可选)</label>
                <input
                  type="password"
                  autoComplete="one-time-code"
                  value={newProject.password}
                  onChange={(e) => setNewProject(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 rounded"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  placeholder="留空表示不设密码"
                />
              </div>
              {newProject.password && (
                <div>
                  <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>确认密码</label>
                  <input
                    type="password"
                    autoComplete="one-time-code"
                    value={newProject.confirmPassword}
                    onChange={(e) => setNewProject(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="w-full px-3 py-2 rounded"
                    style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                    placeholder="再次输入密码"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => { setShowCreateProject(false); setGitUrl(''); setCreateMode('git'); setNewProject({ name: '', workdir: '', password: '', confirmPassword: '' }) }}
                className="px-4 py-2"
                style={{ color: 'var(--text-muted)' }}
              >
                取消
              </button>
              {createMode === 'git' ? (
                <button
                  onClick={importFromGit}
                  disabled={!gitUrl.trim() || importing}
                  className="px-4 py-2 rounded disabled:opacity-50"
                  style={{ background: 'var(--success, #22c55e)', color: '#fff' }}
                >
                  {importing ? '导入中...' : '克隆并导入'}
                </button>
              ) : (
                <button
                  onClick={createProject}
                  disabled={!newProject.name}
                  className="px-4 py-2 rounded disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: '#fff' }}
                >
                  创建
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Project password prompt */}
      {projectPasswordPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-lg p-6 w-full max-w-sm" style={{ background: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              🔒 项目密码验证
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              「{projectPasswordPrompt.project.name}」需要密码才能查看会话
            </p>
            <input
              type="password"
              autoComplete="one-time-code"
              value={projectPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectPassword(e.target.value)}
              className="w-full px-3 py-2 rounded mb-2"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              placeholder="请输入项目密码"
              autoFocus
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter' && projectPassword) verifyProjectPassword()
              }}
            />
            {projectPasswordPrompt.error && (
              <p className="text-sm mb-2" style={{ color: 'var(--error)' }}>{projectPasswordPrompt.error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setProjectPasswordPrompt(null)}
                className="px-4 py-2"
                style={{ color: 'var(--text-muted)' }}
              >
                取消
              </button>
              <button
                onClick={verifyProjectPassword}
                disabled={!projectPassword || projectPasswordPrompt.loading}
                className="px-4 py-2 rounded disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: '#fff' }}
              >
                {projectPasswordPrompt.loading ? '验证中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
