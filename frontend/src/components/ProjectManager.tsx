import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'

const API_BASE = '/api'

// ---- Type Definitions ----

interface Project {
  id: string
  name: string
  workdir: string
  favorite?: boolean
  gitHost?: string
  gitConfigured?: boolean
  hasPassword?: boolean
}

interface ProjectManagerProps {
  onSelectProject: (result: any) => void
  onNewSession?: (project: Project) => void
  onClose: () => void
  homeDir?: string
}

interface ProjectCardProps {
  project: Project
  onToggleFavorite: () => void
  onDelete: () => void
  onSetPassword: () => void
}

interface Credential {
  key: string
  host: string
  type: string
  username?: string
}

interface NewProjectForm {
  name: string
  workdir: string
  password: string
  confirmPassword: string
}

export default function ProjectManager({ onSelectProject, onNewSession, onClose, homeDir }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [recentProjects, setRecentProjects] = useState<Project[]>([])
  const [favoriteProjects, setFavoriteProjects] = useState<Project[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Project[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [createMode, setCreateMode] = useState<'manual' | 'git'>('manual') // 'manual' | 'git'
  const [gitUrl, setGitUrl] = useState('')
  const [newProject, setNewProject] = useState<NewProjectForm>({
    name: '',
    workdir: '',
    password: '',
    confirmPassword: ''
  })
  const [passwordPrompt, setPasswordPrompt] = useState<{
    project: Project
    loading: boolean
    error: string
  } | null>(null)
  const [projectPassword, setProjectPassword] = useState('')
  const [setPasswordModal, setSetPasswordModal] = useState<{
    project: Project
    loading: boolean
    error: string
  } | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  // 加载数据
  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    try {
      const [all, recent, favorites] = await Promise.all([
        fetch(`${API_BASE}/projects`).then(r => r.json()),
        fetch(`${API_BASE}/projects/recent`).then(r => r.json()),
        fetch(`${API_BASE}/projects/favorites`).then(r => r.json())
      ])
      setProjects(all)
      setRecentProjects(recent)
      setFavoriteProjects(favorites)
    } catch (error) {
      console.error('加载项目失败:', error)
    }
  }

  const searchProjects = async (query: string) => {
    setSearchQuery(query)
    if (query.trim()) {
      try {
        const results = await fetch(`${API_BASE}/projects/search?q=${encodeURIComponent(query)}`).then(r => r.json())
        setSearchResults(results)
      } catch (error) {
        console.error('搜索失败:', error)
      }
    } else {
      setSearchResults([])
    }
  }

   const createProject = async () => {
     if (newProject.password && newProject.password !== newProject.confirmPassword) {
       toast.error('两次输入的密码不一致')
       return
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
       if (!res.ok) {
         toast.error(data.error || '创建项目失败')
         return
       }
       setProjects(prev => [...prev, data])
       setShowCreateForm(false)
       setNewProject({ name: '', workdir: '', password: '', confirmPassword: '' })
     } catch (error: any) {
       toast.error('创建项目失败: ' + error.message)
     }
   }

  // 从 Git URL 导入项目
  const importFromGit = async () => {
    if (!gitUrl.trim()) {
      toast.warning('请输入 Git 仓库地址')
      return
    }
    setImporting(true)
    try {
       const result = await fetch(`${API_BASE}/projects/import-git`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           gitUrl: gitUrl.trim(),
           password: newProject.password || undefined
         })
       }).then(r => r.json())

      if (result.error) {
        toast.error(result.error)
        return
      }

      // 根据状态显示不同提示
      if (result.status === 'existing') {
        toast.info(`✅ ${result.message}`)
      } else if (result.status === 'imported') {
        toast.success(`📂 ${result.message}`)
      } else {
        toast.success(`📥 ${result.message}`)
      }

      // 刷新项目列表
      loadProjects()
      setShowCreateForm(false)
      setGitUrl('')

      // 如果是 clone 或导入的，打开新建会话
      if (result.project) {
        if (onNewSession) {
          onNewSession(result.project)
        } else {
          try {
            const startResult = await fetch(`${API_BASE}/projects/${result.project.id}/start`, {
              method: 'POST'
            }).then(r => r.json())
            onSelectProject(startResult)
          } catch (e: any) {
            toast.error('启动项目失败: ' + e.message)
          }
        }
      }
    } catch (error: any) {
      toast.error('导入失败: ' + error.message)
    }
    setImporting(false)
  }

  const toggleFavorite = async (projectId: string) => {
    try {
      await fetch(`${API_BASE}/projects/${projectId}/favorite`, { method: 'POST' })
      loadProjects()
    } catch (error) {
      console.error('操作失败:', error)
    }
  }

  const deleteProject = async (projectId: string) => {
    if (!confirm('确定删除这个项目？')) return
    try {
      await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' })
      loadProjects()
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  const startProject = async (project: Project) => {
    if (project.hasPassword) {
      setPasswordPrompt({ project, loading: false, error: '' })
      setProjectPassword('')
      return
    }
    doStartProject(project, '')
  }

  const doStartProject = async (project: Project, password: string) => {
    setPasswordPrompt(prev => prev ? { ...prev, loading: true, error: '' } : null)
    try {
      const result = await fetch(`${API_BASE}/projects/${project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      }).then(r => r.json())

      if (result.requiresPassword) {
        setPasswordPrompt(prev => prev ? { ...prev, loading: false, error: '请输入密码' } : null)
        return
      }
      if (result.error) {
        setPasswordPrompt(prev => prev ? { ...prev, loading: false, error: result.error } : null)
        return
      }

      setPasswordPrompt(null)
      onSelectProject(result.session)
    } catch (error: any) {
      setPasswordPrompt(prev => prev ? { ...prev, loading: false, error: error.message } : null)
    }
  }

  const handleSetPassword = async () => {
    if (!setPasswordModal) return
    if (newPassword !== confirmNewPassword) {
      setSetPasswordModal(prev => prev ? { ...prev, error: '两次输入的密码不一致' } : null)
      return
    }
    setSetPasswordModal(prev => prev ? { ...prev, loading: true, error: '' } : null)
    try {
      const res = await fetch(`${API_BASE}/projects/${setPasswordModal.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword || null })
      })
      if (!res.ok) throw new Error('更新失败')
      toast.success(newPassword ? '密码已设置' : '密码已移除')
      setSetPasswordModal(null)
      setNewPassword('')
      setConfirmNewPassword('')
      loadProjects()
    } catch (error: any) {
      setSetPasswordModal(prev => prev ? { ...prev, loading: false, error: error.message } : null)
    }
  }

  const displayProjects = searchQuery ? searchResults : projects

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="rounded-lg w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>📁 项目管理</h2>
          <button
            onClick={onClose}
            className="text-xl"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* 搜索和新建 */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => searchProjects(e.target.value)}
              className="flex-1 px-3 py-2 rounded"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 rounded"
              style={{ background: 'var(--accent-primary)', color: '#fff' }}
            >
              + 新建
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* 最近项目 */}
          {recentProjects.length > 0 && !searchQuery && (
            <div className="mb-6">
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>⏰ 最近使用</h3>
              <div className="space-y-2">
                {recentProjects.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}

                    onToggleFavorite={() => toggleFavorite(project.id)}
                    onDelete={() => deleteProject(project.id)}
                    onSetPassword={() => { setSetPasswordModal({ project, loading: false, error: '' }); setNewPassword(''); setConfirmNewPassword('') }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 收藏项目 */}
          {favoriteProjects.length > 0 && !searchQuery && (
            <div className="mb-6">
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>⭐ 收藏项目</h3>
              <div className="space-y-2">
                {favoriteProjects.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}

                    onToggleFavorite={() => toggleFavorite(project.id)}
                    onDelete={() => deleteProject(project.id)}
                    onSetPassword={() => { setSetPasswordModal({ project, loading: false, error: '' }); setNewPassword(''); setConfirmNewPassword('') }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 所有项目 */}
          <div>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
              {searchQuery ? '🔍 搜索结果' : '📋 所有项目'}
            </h3>
            <div className="space-y-2">
              {displayProjects.length === 0 ? (
                <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                  {searchQuery ? '没有找到匹配的项目' : '还没有项目，点击上方「新建」创建'}
                </p>
              ) : (
                displayProjects.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}

                    onToggleFavorite={() => toggleFavorite(project.id)}
                    onDelete={() => deleteProject(project.id)}
                    onSetPassword={() => { setSetPasswordModal({ project, loading: false, error: '' }); setNewPassword(''); setConfirmNewPassword('') }}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* 新建项目表单 */}
        {showCreateForm && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="rounded-lg p-6 w-full max-w-md" style={{ background: 'var(--bg-secondary)' }}>
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>新建项目</h3>

              {/* Tab 切换 */}
              <div className="flex gap-1 mb-4 rounded p-1" style={{ background: 'var(--bg-tertiary)' }}>
                <button
                  onClick={() => setCreateMode('git')}
                  className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                    createMode === 'git' ? '' : ''
                  }`}
                  style={createMode === 'git'
                    ? { background: 'var(--accent-primary)', color: '#fff' }
                    : { color: 'var(--text-muted)' }
                  }
                >
                  📥 从 Git 克隆
                </button>
                <button
                  onClick={() => setCreateMode('manual')}
                  className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                    createMode === 'manual' ? '' : ''
                  }`}
                  style={createMode === 'manual'
                    ? { background: 'var(--accent-primary)', color: '#fff' }
                    : { color: 'var(--text-muted)' }
                  }
                >
                  📁 手动创建
                </button>
              </div>

              <div className="space-y-4">
               {createMode === 'git' ? (
                   /* Git URL 导入模式 */
                   <>
                     <div>
                       <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>Git 仓库地址 *</label>
                       <input
                         type="text"
                         value={gitUrl}
                         onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGitUrl(e.target.value)}
                         className="w-full px-3 py-2 rounded"
                         style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                         placeholder="https://github.com/user/repo 或 user/repo"
                         onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && importFromGit()}
                       />
                       <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                         支持 GitHub/GitLab/Bitbucket，本地已有则直接进入
                       </p>
                     </div>
                   </>
                 ) : (
                   /* 手动创建模式 */
                   <>
                     <div>
                       <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>项目名称 *</label>
                       <input
                         type="text"
                         value={newProject.name}
                         onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                           const name = e.target.value
                           const slug = name.toLowerCase().replace(/\s+/g, '-')
                           const baseDir = homeDir ? `${homeDir}/projects` : '~/projects'
                           setNewProject(prev => ({
                             ...prev,
                             name,
                             workdir: name ? `${baseDir}/${slug}` : ''
                           }))
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
                         value={newProject.workdir}
                         readOnly
                         className="w-full px-3 py-2 rounded opacity-70"
                         style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                       />
                       <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                         将创建在 {homeDir ? `${homeDir}/projects/` : '~/projects/'} 目录下
                       </p>
                     </div>
                   </>
                 )}

                 {/* 密码输入 - 两种模式共用 */}
                 <div>
                   <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>项目密码 (可选)</label>
                   <input
                     type="password"
                     autoComplete="one-time-code"
                     value={newProject.password}
                     onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewProject(prev => ({ ...prev, password: e.target.value }))}
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
                       onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewProject(prev => ({ ...prev, confirmPassword: e.target.value }))}
                       className="w-full px-3 py-2 rounded"
                       style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                       placeholder="再次输入密码"
                     />
                   </div>
                 )}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => {
                    setShowCreateForm(false)
                    setGitUrl('')
                    setCreateMode('git')
                  }}
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
                    style={{ background: 'var(--success)', color: '#fff' }}
                  >
                    {importing ? '⏳ 导入中...' : '📥 克隆并导入'}
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

        {/* 密码验证弹窗 */}
        {passwordPrompt && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="rounded-lg p-6 w-full max-w-sm" style={{ background: 'var(--bg-secondary)' }}>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                🔒 项目密码验证
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                「{passwordPrompt.project.name}」需要密码才能访问
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
                  if (e.key === 'Enter' && projectPassword) {
                    doStartProject(passwordPrompt.project, projectPassword)
                  }
                }}
              />
              {passwordPrompt.error && (
                <p className="text-sm mb-2" style={{ color: 'var(--error)' }}>{passwordPrompt.error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPasswordPrompt(null)}
                  className="px-4 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  取消
                </button>
                <button
                  onClick={() => doStartProject(passwordPrompt.project, projectPassword)}
                  disabled={!projectPassword || passwordPrompt.loading}
                  className="px-4 py-2 rounded disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: '#fff' }}
                >
                  {passwordPrompt.loading ? '验证中...' : '确认'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 设置密码弹窗 */}
        {setPasswordModal && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="rounded-lg p-6 w-full max-w-sm" style={{ background: 'var(--bg-secondary)' }}>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                {setPasswordModal.project.hasPassword ? '🔑 修改密码' : '🔒 设置密码'}
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                「{setPasswordModal.project.name}」
                {setPasswordModal.project.hasPassword ? '修改项目密码' : '设置项目密码以保护访问'}
              </p>
              <input
                type="password"
                autoComplete="one-time-code"
                value={newPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded mb-2"
                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                placeholder={setPasswordModal.project.hasPassword ? '输入新密码' : '输入密码（留空则取消密码保护）'}
                autoFocus
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && newPassword === confirmNewPassword) handleSetPassword()
                }}
              />
              {newPassword && (
                <input
                  type="password"
                  autoComplete="one-time-code"
                  value={confirmNewPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmNewPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded mb-2"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  placeholder="确认密码"
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter' && newPassword === confirmNewPassword) handleSetPassword()
                  }}
                />
              )}
              {setPasswordModal.error && (
                <p className="text-sm mb-2" style={{ color: 'var(--error)' }}>{setPasswordModal.error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setSetPasswordModal(null); setNewPassword(''); setConfirmNewPassword('') }}
                  className="px-4 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  取消
                </button>
                <button
                  onClick={handleSetPassword}
                  disabled={setPasswordModal.loading}
                  className="px-4 py-2 rounded disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: '#fff' }}
                >
                  {setPasswordModal.loading ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({ project, onToggleFavorite, onDelete, onSetPassword }: ProjectCardProps) {
  const [showCredPicker, setShowCredPicker] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loadingCreds, setLoadingCreds] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCredType, setNewCredType] = useState('token')
  const [newCredSecret, setNewCredSecret] = useState('')
  const [newCredKeyData, setNewCredKeyData] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const loadCredentials = async () => {
    setLoadingCreds(true)
    try {
      const res = await fetch('/api/my-credentials')
      const data = await res.json()
      // 兼容新格式 { credentials: [...] } 和旧格式 [...]
      const list = Array.isArray(data) ? data : (data.credentials || [])
      setCredentials(list)
    } catch (e) {
      console.error('加载凭证失败:', e)
    } finally {
      setLoadingCreds(false)
    }
  }

  const handleOpenPicker = () => {
    setShowCredPicker(!showCredPicker)
    if (!showCredPicker) loadCredentials()
  }

  const handleApplyCred = async (cred: Credential) => {
    setSaving(true)
    try {
      const res = await fetch('/api/projects/' + project.id + '/apply-credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: cred.host })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message || '凭证已应用')
      setShowCredPicker(false)
      window.location.reload()
    } catch (e: any) {
      toast.error('应用失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAddAndApply = async () => {
    setSaving(true)
    try {
      const body: Record<string, any> = { host: project.gitHost, type: newCredType, username: 'git' }
      if (newCredType === 'token') body.secret = newCredSecret
      else body.keyData = newCredKeyData
      const res = await fetch('/api/my-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`已为 ${project.gitHost} 配置凭证`)
      setShowCredPicker(false)
      setShowAddForm(false)
      window.location.reload()
    } catch (e: any) {
      toast.error('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg p-4 border transition-colors" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{project.name}</h4>
            {project.favorite && <span style={{ color: 'var(--warning)' }}>⭐</span>}
            {project.hasPassword && <span title="已设置密码保护">🔒</span>}
          </div>
          <p className="text-sm truncate mt-1" style={{ color: 'var(--text-muted)' }}>{project.workdir}</p>
           {/* Git状态显示 */}
           <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
             {project.gitHost ? (
               <div className="flex items-center gap-2 flex-wrap">
                 {project.gitConfigured ? (
                   <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                     🔑 已配置
                   </span>
                 ) : (
                   <button
                     onClick={handleOpenPicker}
                     className="badge cursor-pointer"
                     style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
                     title="点击配置凭证"
                   >
                     ⚠️ 未配置凭证 · 点击设置
                   </button>
                 )}
                 <span>🌐 {project.gitHost}</span>
               </div>
             ) : null}
           </div>
           {/* 内联凭证选择 */}
           {showCredPicker && !project.gitConfigured && (
             <div className="mt-2 p-2 rounded space-y-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
               <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                 选择凭证应用到此项目：
               </div>
               {loadingCreds ? (
                 <div className="text-xs" style={{ color: 'var(--text-muted)' }}>加载中...</div>
               ) : credentials.length === 0 ? (
                 <div className="text-xs p-2 rounded" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                   系统暂无已存凭证，请先到 设置 → 凭证 添加凭证
                 </div>
               ) : (
                 <div className="space-y-1">
                   {credentials.map(cred => (
                     <div key={cred.key} className="flex items-center justify-between p-1.5 rounded" style={{ background: 'var(--bg-tertiary)' }}>
                       <div className="text-xs" style={{ color: 'var(--text-primary)' }}>
                         <span>{cred.type === 'ssh' ? '🔑' : '🎫'}{' '}
                           {cred.username ? <><span style={{color:'var(--accent-primary)'}}>{cred.username}</span>@{cred.host}</> : cred.host}
                         </span>
                         <span className="ml-1 badge text-xs" style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}>
                           {cred.type === 'ssh' ? 'SSH' : 'Token'}
                         </span>
                         {cred.type === 'ssh' && project.gitHost && (
                           <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(将自动切为SSH地址)</span>
                         )}
                       </div>
                       <button
                         onClick={() => handleApplyCred(cred)}
                         disabled={saving}
                         className="text-xs px-2 py-0.5 rounded disabled:opacity-50"
                         style={{ background: 'var(--success)', color: '#fff' }}
                       >
                         {saving ? '...' : '应用'}
                       </button>
                     </div>
                   ))}
                 </div>
               )}
               {/* 手动添加 */}
               {!showAddForm ? (
                 <button onClick={() => setShowAddForm(true)} className="text-xs" style={{ color: 'var(--accent-primary)' }}>
                   + 手动添加新凭证
                 </button>
               ) : (
                 <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                   <select
                     value={newCredType}
                     onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewCredType(e.target.value)}
                     className="text-xs px-2 py-1 rounded w-full"
                     style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                   >
                     <option value="token">Token (HTTPS)</option>
                     <option value="ssh">SSH密钥</option>
                   </select>
                   {newCredType === 'token' ? (
                     <input
                       type="password"
                       placeholder="粘贴 GitHub Token..."
                       value={newCredSecret}
                       onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCredSecret(e.target.value)}
                       className="w-full text-xs px-2 py-1 rounded"
                       style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                     />
                   ) : (
                     <textarea
                       placeholder="粘贴 SSH 私钥..."
                       value={newCredKeyData}
                       onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewCredKeyData(e.target.value)}
                       className="w-full text-xs px-2 py-1 rounded h-14 resize-none font-mono"
                       style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                     />
                   )}
                   <div className="flex gap-2">
                     <button onClick={handleAddAndApply} disabled={saving || (newCredType === 'token' ? !newCredSecret : !newCredKeyData)}
                       className="text-xs px-2 py-0.5 rounded disabled:opacity-50" style={{ background: 'var(--success)', color: '#fff' }}>
                       {saving ? '保存中...' : '保存并应用'}
                     </button>
                     <button onClick={() => setShowAddForm(false)} className="text-xs px-2 py-0.5" style={{ color: 'var(--text-muted)' }}>
                       取消
                     </button>
                   </div>
                 </div>
               )}
               <button onClick={() => setShowCredPicker(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                 收起
               </button>
             </div>
           )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={onSetPassword}
            className="p-1.5"
            style={{ color: 'var(--text-muted)' }}
            title={project.hasPassword ? '修改密码' : '设置密码'}
          >
            {project.hasPassword ? '🔒' : '🔓'}
          </button>
          <button
            onClick={onToggleFavorite}
            className="p-1.5"
            style={{ color: 'var(--text-muted)' }}
            title={project.favorite ? '取消收藏' : '收藏'}
          >
            {project.favorite ? '⭐' : '☆'}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5"
            style={{ color: 'var(--text-muted)' }}
            title="删除"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  )
}
