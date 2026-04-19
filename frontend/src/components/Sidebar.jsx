import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'
import { Tag, TagFilter } from './Tag'
import { API_BASE, getWebSocketUrl } from '../config'

// SVG icons
const IconPlus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const IconPin = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v8m-4-4h8"/><circle cx="12" cy="14" r="4"/></svg>
const IconEdit = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
const IconArchive = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
const IconTag = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
const IconTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
const IconChevron = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)
const IconPause = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>

export default function Sidebar({
  sessions,
  activeSession,
  agentType = 'claude-code',
  sessionOptions,
  onSelectSession,
  onCloseSession,
  onResumeSession,
  onNewSession,
  onOpenProject,
  onUpdateOptions,
  onRenameSession,
  onPinSession,
  onArchiveSession,
  onUpdateTags
}) {
  const toast = useToast()
  const [expandedSection, setExpandedSection] = useState('sessions')
  const [options, setOptions] = useState({ modes: [], models: [], efforts: [] })
  const [commands, setCommands] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [editingSession, setEditingSession] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [allTags, setAllTags] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [editingTags, setEditingTags] = useState(null)

  useEffect(() => {
    loadOptions()
    loadCommands()
    loadTags()
  }, [agentType])

  const loadOptions = async () => {
    try {
      const data = await fetch(`${API_BASE}/options?agentType=${agentType}`).then(r => r.json())
      setOptions(data)
    } catch (error) { console.error('加载选项失败:', error) }
  }

  const loadCommands = async () => {
    try {
      const data = await fetch(`${API_BASE}/commands?agentType=${agentType}`).then(r => r.json())
      setCommands(data.commands || [])
    } catch (error) { console.error('加载命令失败:', error) }
  }

  const loadTags = async () => {
    try {
      const data = await fetch(`${API_BASE}/tags`).then(r => r.json())
      setAllTags(data.tags || [])
    } catch (error) { console.error('加载标签失败:', error) }
  }

  const currentOptions = activeSession ? sessionOptions[activeSession] || {} : {}

  const handleOptionChange = async (type, value) => {
    if (!activeSession) return
    const newOptions = { ...currentOptions, [type]: value }
    const ws = new WebSocket(getWebSocketUrl(activeSession))
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'command', command: `set_${type}`, params: { [type]: value } }))
      setTimeout(() => ws.close(), 300)
    }
    onUpdateOptions(activeSession, newOptions)
  }

  const handleCommand = (cmd) => {
    const event = new CustomEvent('send-message', { detail: { message: cmd.usage } })
    window.dispatchEvent(event)
  }

  const getDisplayName = (workdir) => {
    const parts = workdir.split('/').filter(Boolean)
    return parts[parts.length - 1] || workdir
  }

  const sortedSessions = [...sessions]
    .filter(s => {
      if (!s) return false
      if (showArchived ? !s.isArchived : s.isArchived) return false
      if (selectedTags.length > 0) {
        const sessionTags = s.tags || []
        return selectedTags.some(tag => sessionTags.includes(tag))
      }
      return true
    })
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    })

  const handleRename = (sessionId) => {
    if (editTitle.trim()) onRenameSession(sessionId, editTitle.trim())
    setEditingSession(null)
    setEditTitle('')
  }

  const groupedCommands = commands.reduce((groups, cmd) => {
    const category = cmd.category || '其他'
    if (!groups[category]) groups[category] = []
    groups[category].push(cmd)
    return groups
  }, {})

  const SectionHeader = ({ icon, label, count, section }) => (
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
          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
            style={{ background: 'var(--gradient-btn-primary)' }}>
            🤖
          </span>
          Agent Hub
        </h1>
      </div>

      {/* Project button */}
      <div className="p-3">
        <button onClick={onOpenProject} className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
          📁 项目管理
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sessions */}
        <div className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <SectionHeader icon="💬" label="会话列表" count={sortedSessions.length} section="sessions" />

          {expandedSection === 'sessions' && (
            <div className="pb-2">
              {/* Tag filter */}
              {allTags.length > 0 && (
                <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <TagFilter
                    tags={allTags}
                    selectedTags={selectedTags}
                    onToggleTag={(tag) => setSelectedTags(prev =>
                      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                    )}
                    onClearTags={() => setSelectedTags([])}
                  />
                </div>
              )}

              {/* Archive toggle */}
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {showArchived ? '📦 已归档' : '📋 活跃会话'}
                </span>
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="text-xs font-medium"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {showArchived ? '查看活跃' : '查看归档'}
                </button>
              </div>

              {sortedSessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  {showArchived ? '没有已归档的会话' : '还没有会话'}
                </div>
              ) : (
                sortedSessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => session.isActive ? onSelectSession(session.id) : onResumeSession(session.id)}
                    className={`sidebar-item group ${activeSession === session.id ? 'active' : ''}`}
                    style={{ flexDirection: 'column', alignItems: 'stretch' }}
                  >
                    <div className="flex items-center gap-2 min-w-0 w-full">
                      {session.isPinned && <span className="text-xs flex-shrink-0" style={{ color: 'var(--warning)' }}>📌</span>}
                      {!session.isActive && <IconPause />}
                      {editingSession === session.id ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => handleRename(session.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(session.id)
                            if (e.key === 'Escape') { setEditingSession(null); setEditTitle('') }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="input-field text-sm py-1 px-2 flex-1 min-w-0"
                          autoFocus
                        />
                      ) : (
                        <span className="text-xs flex-1 min-w-0 truncate" style={{ lineHeight: '1.4' }}>
                          {session.title || getDisplayName(session.workdir)}
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
                        onClick={(e) => { e.stopPropagation(); onPinSession(session.id) }}
                        className="btn-icon text-xs"
                        style={{ color: session.isPinned ? 'var(--warning)' : 'var(--text-muted)', width: 22, height: 22 }}
                        title={session.isPinned ? '取消置顶' : '置顶'}
                      >
                        <IconPin />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingSession(session.id); setEditTitle(session.title || getDisplayName(session.workdir)) }}
                        className="btn-icon text-xs"
                        style={{ width: 22, height: 22 }}
                        title="重命名"
                      >
                        <IconEdit />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onArchiveSession(session.id) }}
                        className="btn-icon text-xs"
                        style={{ width: 22, height: 22 }}
                        title={session.isArchived ? '取消归档' : '归档'}
                      >
                        <IconArchive />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTags(editingTags === session.id ? null : session.id) }}
                        className="btn-icon text-xs"
                        style={{ color: session.tags?.length > 0 ? 'var(--accent-primary)' : 'var(--text-muted)', width: 22, height: 22 }}
                        title="标签"
                      >
                        <IconTag />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onCloseSession(session.id) }}
                        className="btn-icon text-xs"
                        style={{ color: 'var(--text-muted)', width: 22, height: 22 }}
                        title="删除"
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--error)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))
              )}
              
              <button
                onClick={onNewSession}
                className="sidebar-item w-full justify-center gap-2"
                style={{ color: 'var(--accent-primary)' }}
              >
                <IconPlus /> 新建会话
              </button>
            </div>
          )}
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
                    {currentOptions.mode && <div>🛡️ 模式: {currentOptions.mode}</div>}
                    {currentOptions.model && <div>🧠 模型: {currentOptions.model}</div>}
                    {currentOptions.effort && <div>💪 努力: {currentOptions.effort}</div>}
                  </div>

                  {/* Permission modes */}
                  <div>
                    <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>🛡️ 权限模式</label>
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
                    <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>🧠 模型</label>
                    <select
                      value={currentOptions.model || ''}
                      onChange={(e) => handleOptionChange('model', e.target.value)}
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
                    <label className="block text-xs mb-2" style={{ color: 'var(--text-muted)' }}>💪 努力程度</label>
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
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
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
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex gap-2">
          <button
            onClick={() => { if (activeSession) window.open(`${API_BASE}/export/session/${activeSession}`, '_blank') }}
            disabled={!activeSession}
            className="btn-secondary flex-1 py-1.5 text-xs"
          >
            📄 导出
          </button>
          <button
            onClick={() => window.open(`${API_BASE}/export/sessions`, '_blank')}
            className="btn-secondary flex-1 py-1.5 text-xs"
          >
            💾 备份
          </button>
          <button
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.json'
              input.onchange = async (e) => {
                const file = e.target.files[0]
                if (!file) return
                try {
                  const text = await file.text()
                  const data = JSON.parse(text)
                  if (!data.sessions) { toast.error('无效的备份文件'); return }
                  const res = await fetch(`${API_BASE}/import/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: text
                  })
                  const result = await res.json()
                  if (result.success) {
                    toast.success(`导入成功: ${result.imported} 个会话`)
                    window.location.reload()
                  }
                } catch (error) { toast.error('导入失败: ' + error.message) }
              }
              input.click()
            }}
            className="btn-secondary flex-1 py-1.5 text-xs"
          >
            📥 导入
          </button>
        </div>
      </div>
    </div>
  )
}
