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
}

interface ProjectManagerProps {
  onSelectProject: (result: any) => void
  onNewSession?: (project: Project) => void
  onClose: () => void
}

interface ProjectCardProps {
  project: Project
  onStart: () => void
  onToggleFavorite: () => void
  onDelete: () => void
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
}

export default function ProjectManager({ onSelectProject, onNewSession, onClose }: ProjectManagerProps) {
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
    workdir: ''
  })

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
     try {
       const project = await fetch(`${API_BASE}/projects`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(newProject)
       }).then(r => r.json())

       setProjects(prev => [...prev, project])
       setShowCreateForm(false)
       setNewProject({ name: '', workdir: '' })
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
         body: JSON.stringify({ gitUrl: gitUrl.trim() })
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
    if (onNewSession) {
      onNewSession(project)
    } else {
      // fallback: 直接启动（兼容旧逻辑）
      try {
        const result = await fetch(`${API_BASE}/projects/${project.id}/start`, {
          method: 'POST'
        }).then(r => r.json())
        onSelectProject(result)
      } catch (error: any) {
        toast.error('启动项目失败: ' + error.message)
      }
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
                    onStart={() => startProject(project)}
                    onToggleFavorite={() => toggleFavorite(project.id)}
                    onDelete={() => deleteProject(project.id)}
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
                    onStart={() => startProject(project)}
                    onToggleFavorite={() => toggleFavorite(project.id)}
                    onDelete={() => deleteProject(project.id)}
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
                    onStart={() => startProject(project)}
                    onToggleFavorite={() => toggleFavorite(project.id)}
                    onDelete={() => deleteProject(project.id)}
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
                         onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                         className="w-full px-3 py-2 rounded"
                         style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                         placeholder="我的项目"
                       />
                     </div>

                     <div>
                       <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>工作目录 *</label>
                       <input
                         type="text"
                         value={newProject.workdir}
                         onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewProject(prev => ({ ...prev, workdir: e.target.value }))}
                         className="w-full px-3 py-2 rounded"
                         style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                         placeholder="/path/to/project 或 ~/project"
                       />
                     </div>
                   </>
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
                    disabled={!newProject.name || !newProject.workdir}
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
      </div>
    </div>
  )
}

function ProjectCard({ project, onStart, onToggleFavorite, onDelete }: ProjectCardProps) {
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
      const res = await fetch('/api/credentials')
      setCredentials(await res.json())
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
      const res = await fetch('/api/credentials', {
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
            onClick={onStart}
            className="px-3 py-1.5 text-sm rounded"
            style={{ background: 'var(--success)', color: '#fff' }}
          >
            启动
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
