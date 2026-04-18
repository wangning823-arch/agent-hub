import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function ProjectManager({ onSelectProject, onClose }) {
  const [projects, setProjects] = useState([])
  const [recentProjects, setRecentProjects] = useState([])
  const [favoriteProjects, setFavoriteProjects] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newProject, setNewProject] = useState({
    name: '',
    workdir: '',
    agentType: 'claude-code',
    mode: 'auto',
    model: '',
    effort: 'medium'
  })
  const [options, setOptions] = useState({
    modes: [],
    models: [],
    efforts: []
  })

  // 加载数据
  useEffect(() => {
    loadProjects()
    loadOptions()
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

  const loadOptions = async () => {
    try {
      const data = await fetch(`${API_BASE}/options`).then(r => r.json())
      setOptions(data)
    } catch (error) {
      console.error('加载选项失败:', error)
    }
  }

  const searchProjects = async (query) => {
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
      setNewProject({
        name: '',
        workdir: '',
        agentType: 'claude-code',
        mode: 'auto',
        model: '',
        effort: 'medium'
      })
    } catch (error) {
      alert('创建项目失败: ' + error.message)
    }
  }

  const toggleFavorite = async (projectId) => {
    try {
      await fetch(`${API_BASE}/projects/${projectId}/favorite`, { method: 'POST' })
      loadProjects()
    } catch (error) {
      console.error('操作失败:', error)
    }
  }

  const deleteProject = async (projectId) => {
    if (!confirm('确定删除这个项目？')) return
    try {
      await fetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' })
      loadProjects()
    } catch (error) {
      console.error('删除失败:', error)
    }
  }

  const startProject = async (project) => {
    try {
      const result = await fetch(`${API_BASE}/projects/${project.id}/start`, {
        method: 'POST'
      }).then(r => r.json())

      onSelectProject(result)
    } catch (error) {
      alert('启动项目失败: ' + error.message)
    }
  }

  const displayProjects = searchQuery ? searchResults : projects

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">📁 项目管理</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>

        {/* 搜索和新建 */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => searchProjects(e.target.value)}
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-400"
            />
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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
              <h3 className="text-sm font-medium text-gray-400 mb-2">⏰ 最近使用</h3>
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
              <h3 className="text-sm font-medium text-gray-400 mb-2">⭐ 收藏项目</h3>
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
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              {searchQuery ? '🔍 搜索结果' : '📋 所有项目'}
            </h3>
            <div className="space-y-2">
              {displayProjects.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
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
            <div className="bg-gray-900 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold text-white mb-4">新建项目</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">项目名称 *</label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    placeholder="我的项目"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">工作目录 *</label>
                  <input
                    type="text"
                    value={newProject.workdir}
                    onChange={(e) => setNewProject(prev => ({ ...prev, workdir: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                    placeholder="/path/to/project 或 ~/project"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Agent 类型</label>
                  <select
                    value={newProject.agentType}
                    onChange={(e) => setNewProject(prev => ({ ...prev, agentType: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  >
                    <option value="claude-code">Claude Code</option>
                    <option value="opencode">OpenCode</option>
                    <option value="codex">Codex</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">权限模式</label>
                  <select
                    value={newProject.mode}
                    onChange={(e) => setNewProject(prev => ({ ...prev, mode: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  >
                    {options.modes.map(mode => (
                      <option key={mode.id} value={mode.id}>
                        {mode.name} - {mode.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">模型</label>
                  <select
                    value={newProject.model}
                    onChange={(e) => setNewProject(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  >
                    <option value="">使用默认模型</option>
                    {options.models.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name} - {model.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">努力程度</label>
                  <select
                    value={newProject.effort}
                    onChange={(e) => setNewProject(prev => ({ ...prev, effort: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
                  >
                    {options.efforts.map(effort => (
                      <option key={effort.id} value={effort.id}>
                        {effort.name} - {effort.description}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  onClick={createProject}
                  disabled={!newProject.name || !newProject.workdir}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({ project, onStart, onToggleFavorite, onDelete }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-white truncate">{project.name}</h4>
            {project.favorite && <span className="text-yellow-500">⭐</span>}
          </div>
          <p className="text-sm text-gray-400 truncate mt-1">{project.workdir}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span>🤖 {project.agentType}</span>
            {project.mode && <span>⚙️ {project.mode}</span>}
            {project.model && <span>🧠 {project.model}</span>}
          </div>
        </div>
        
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={onStart}
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
          >
            启动
          </button>
          <button
            onClick={onToggleFavorite}
            className="p-1.5 text-gray-400 hover:text-yellow-500"
            title={project.favorite ? '取消收藏' : '收藏'}
          >
            {project.favorite ? '⭐' : '☆'}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-500"
            title="删除"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  )
}
