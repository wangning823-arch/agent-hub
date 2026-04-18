import React, { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'

export default function CommandPalette({ onSelectCommand, onClose }) {
  const [commands, setCommands] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filteredCommands, setFilteredCommands] = useState([])
  const inputRef = useRef(null)

  // 加载命令
  useEffect(() => {
    loadCommands()
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // 过滤命令
  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const filtered = commands.filter(cmd =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query) ||
        cmd.category.toLowerCase().includes(query)
      )
      setFilteredCommands(filtered)
    } else {
      setFilteredCommands(commands)
    }
    setSelectedIndex(0)
  }, [searchQuery, commands])

  const loadCommands = async () => {
    try {
      const data = await fetch(`${API_BASE}/commands`).then(r => r.json())
      setCommands(data.commands)
      setFilteredCommands(data.commands)
    } catch (error) {
      console.error('加载命令失败:', error)
    }
  }

  const handleKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (filteredCommands[selectedIndex]) {
          onSelectCommand(filteredCommands[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  // 按分类分组
  const groupedCommands = filteredCommands.reduce((groups, cmd) => {
    const category = cmd.category || '其他'
    if (!groups[category]) {
      groups[category] = []
    }
    groups[category].push(cmd)
    return groups
  }, {})

  let commandIndex = 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-20 z-50">
      <div className="bg-gray-900 rounded-lg w-full max-w-xl overflow-hidden shadow-2xl border border-gray-700">
        {/* 搜索框 */}
        <div className="p-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">⌘</span>
            <input
              ref={inputRef}
              type="text"
              placeholder="输入命令..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none"
            />
            <kbd className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
              ESC
            </kbd>
          </div>
        </div>

        {/* 命令列表 */}
        <div className="max-h-96 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              没有找到匹配的命令
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category}>
                <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase bg-gray-800/50">
                  {category}
                </div>
                {cmds.map((cmd) => {
                  const currentIndex = commandIndex++
                  const isSelected = currentIndex === selectedIndex
                  return (
                    <div
                      key={cmd.id}
                      onClick={() => onSelectCommand(cmd)}
                      className={`px-3 py-2 cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-gray-800 text-gray-300'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{cmd.name}</div>
                        <div className={`text-sm ${isSelected ? 'text-blue-200' : 'text-gray-500'}`}>
                          {cmd.description}
                        </div>
                      </div>
                      <code className={`text-xs px-2 py-0.5 rounded ${
                        isSelected ? 'bg-blue-700' : 'bg-gray-800 text-gray-400'
                      }`}>
                        {cmd.usage}
                      </code>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="p-2 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span>↑↓ 选择</span>
            <span>↵ 执行</span>
            <span>ESC 关闭</span>
          </div>
          <span>{filteredCommands.length} 个命令</span>
        </div>
      </div>
    </div>
  )
}
