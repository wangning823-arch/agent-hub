import React from 'react'

export default function TabBar({ sessions, activeSession, onSelect, onClose, onNew, onResume }) {
  // 获取目录的最后一级作为显示名
  const getDisplayName = (workdir) => {
    const parts = workdir.split('/').filter(Boolean)
    return parts[parts.length - 1] || workdir
  }

  return (
    <div className="flex items-center bg-gray-900 border-b border-gray-800">
      <div className="flex-1 flex overflow-x-auto">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`
              group flex items-center gap-2 px-4 py-3 cursor-pointer
              border-r border-gray-800 min-w-[120px]
              ${activeSession === session.id 
                ? 'bg-gray-950 text-white' 
                : session.isActive
                  ? 'text-gray-400 hover:bg-gray-800'
                  : 'text-gray-600 hover:bg-gray-800/50'
              }
            `}
            onClick={() => {
              if (session.isActive) {
                onSelect(session.id)
              } else if (onResume) {
                onResume(session.id)
              }
            }}
          >
            <span className="truncate flex-1 flex items-center gap-2">
              {!session.isActive && (
                <span className="text-yellow-500" title="需要恢复">⏸️</span>
              )}
              {getDisplayName(session.workdir)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(session.id)
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      
      <button
        onClick={onNew}
        className="px-4 py-3 text-gray-400 hover:text-white hover:bg-gray-800 border-l border-gray-800"
        title="新建会话"
      >
        +
      </button>
    </div>
  )
}
