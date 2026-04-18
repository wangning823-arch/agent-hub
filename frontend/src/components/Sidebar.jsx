import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function Sidebar({
  sessions,
  activeSession,
  sessionOptions,
  onSelectSession,
  onCloseSession,
  onResumeSession,
  onNewSession,
  onOpenProject,
  onUpdateOptions
}) {
  const [expandedSection, setExpandedSection] = useState('sessions') // sessions | controls | commands
  const [options, setOptions] = useState({ modes: [], models: [], efforts: [] })
  const [commands, setCommands] = useState([])

  useEffect(() => {
    loadOptions()
    loadCommands()
  }, [])

  const loadOptions = async () => {
    try {
      const data = await fetch(`${API_BASE}/options`).then(r => r.json())
      setOptions(data)
    } catch (error) {
      console.error('加载选项失败:', error)
    }
  }

  const loadCommands = async () => {
    try {
      const data = await fetch(`${API_BASE}/commands`).then(r => r.json())
      setCommands(data.commands || [])
    } catch (error) {
      console.error('加载命令失败:', error)
    }
  }

  const currentOptions = activeSession ? sessionOptions[activeSession] || {} : {}

  const handleOptionChange = async (type, value) => {
    if (!activeSession) return

    const newOptions = { ...currentOptions, [type]: value }

    // 通过WebSocket发送命令
    const ws = new WebSocket(`ws://${window.location.hostname}:3001?session=${activeSession}`)
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'command',
        command: `set_${type}`,
        params: { [type]: value }
      }))
      setTimeout(() => ws.close(), 300)
    }

    // 更新本地状态
    onUpdateOptions(activeSession, newOptions)
  }

  const handleCommand = (cmd) => {
    // 通过自定义事件发送命令到ChatPanel
    const event = new CustomEvent('send-message', {
      detail: { message: cmd.usage }
    })
    window.dispatchEvent(event)
  }

  const getDisplayName = (workdir) => {
    const parts = workdir.split('/').filter(Boolean)
    return parts[parts.length - 1] || workdir
  }

  // 按分类分组命令
  const groupedCommands = commands.reduce((groups, cmd) => {
    const category = cmd.category || '其他'
    if (!groups[category]) groups[category] = []
    groups[category].push(cmd)
    return groups
  }, {})

  return (
    <div className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          🤖 Agent Hub
        </h1>
      </div>

      {/* 项目按钮 */}
      <div className="p-3 border-b border-gray-800">
        <button
          onClick={onOpenProject}
          className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
        >
          📁 项目管理
        </button>
      </div>

      {/* 可滚动内容 */}
      <div className="flex-1 overflow-y-auto">
        {/* 会话列表 */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => setExpandedSection(expandedSection === 'sessions' ? '' : 'sessions')}
            className="w-full px-4 py-3 flex items-center justify-between text-gray-300 hover:bg-gray-800"
          >
            <span className="flex items-center gap-2">
              💬 会话列表
              <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">{sessions.length}</span>
            </span>
            <span className="text-gray-500">{expandedSection === 'sessions' ? '▼' : '▶'}</span>
          </button>

          {expandedSection === 'sessions' && (
            <div className="pb-2">
              {sessions.length === 0 ? (
                <div className="px-4 py-3 text-gray-500 text-sm text-center">
                  还没有会话
                </div>
              ) : (
                sessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => session.isActive ? onSelectSession(session.id) : onResumeSession(session.id)}
                    className={`px-4 py-2.5 cursor-pointer flex items-center justify-between group ${
                      activeSession === session.id
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {!session.isActive && <span className="text-yellow-500">⏸️</span>}
                      <span className="truncate">{getDisplayName(session.workdir)}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloseSession(session.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}

              <button
                onClick={onNewSession}
                className="w-full px-4 py-2.5 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-2"
              >
                ➕ 新建会话
              </button>
            </div>
          )}
        </div>

        {/* 会话控制 */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => setExpandedSection(expandedSection === 'controls' ? '' : 'controls')}
            className="w-full px-4 py-3 flex items-center justify-between text-gray-300 hover:bg-gray-800"
          >
            <span className="flex items-center gap-2">⚙️ 会话控制</span>
            <span className="text-gray-500">{expandedSection === 'controls' ? '▼' : '▶'}</span>
          </button>

          {expandedSection === 'controls' && (
            <div className="px-4 py-3 space-y-4">
              {!activeSession ? (
                <div className="text-gray-500 text-sm text-center py-2">
                  请先选择一个会话
                </div>
              ) : (
                <>
                  {/* 当前配置 */}
                  <div className="text-xs text-gray-500 space-y-1">
                    {currentOptions.mode && <div>🛡️ 模式: {currentOptions.mode}</div>}
                    {currentOptions.model && <div>🧠 模型: {currentOptions.model}</div>}
                    {currentOptions.effort && <div>💪 努力: {currentOptions.effort}</div>}
                  </div>

                  {/* 权限模式 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">🛡️ 权限模式</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {options.modes.slice(0, 4).map(mode => (
                        <button
                          key={mode.id}
                          onClick={() => handleOptionChange('mode', mode.id)}
                          className={`px-2 py-1.5 rounded text-xs ${
                            currentOptions.mode === mode.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                          title={mode.description}
                        >
                          {mode.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 模型选择 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">🧠 模型</label>
                    <select
                      value={currentOptions.model || ''}
                      onChange={(e) => handleOptionChange('model', e.target.value)}
                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                    >
                      <option value="">默认模型</option>
                      {options.models.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 努力程度 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">💪 努力程度</label>
                    <div className="flex gap-1.5">
                      {options.efforts.map(effort => (
                        <button
                          key={effort.id}
                          onClick={() => handleOptionChange('effort', effort.id)}
                          className={`flex-1 px-2 py-1.5 rounded text-xs ${
                            currentOptions.effort === effort.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
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

        {/* 命令面板 */}
        <div>
          <button
            onClick={() => setExpandedSection(expandedSection === 'commands' ? '' : 'commands')}
            className="w-full px-4 py-3 flex items-center justify-between text-gray-300 hover:bg-gray-800"
          >
            <span className="flex items-center gap-2">
              ⌘ 命令
              <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">{commands.length}</span>
            </span>
            <span className="text-gray-500">{expandedSection === 'commands' ? '▼' : '▶'}</span>
          </button>

          {expandedSection === 'commands' && (
            <div className="pb-2 max-h-80 overflow-y-auto">
              {Object.entries(groupedCommands).map(([category, cmds]) => (
                <div key={category}>
                  <div className="px-4 py-1.5 text-xs font-medium text-gray-500 uppercase bg-gray-800/50">
                    {category}
                  </div>
                  {cmds.map(cmd => (
                    <button
                      key={cmd.id}
                      onClick={() => handleCommand(cmd)}
                      className="w-full px-4 py-2 text-left hover:bg-gray-800 group"
                    >
                      <div className="text-sm text-gray-300 group-hover:text-white">
                        {cmd.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {cmd.description}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部状态 */}
      <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
        {activeSession ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            会话已连接
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
            未选择会话
          </div>
        )}
      </div>
    </div>
  )
}
