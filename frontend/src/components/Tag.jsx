import React, { useState } from 'react'

const TAG_COLORS = [
  { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-700' },
  { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-700' },
  { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-700' },
  { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-700' },
  { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-700' },
  { bg: 'bg-pink-900/30', text: 'text-pink-400', border: 'border-pink-700' },
  { bg: 'bg-indigo-900/30', text: 'text-indigo-400', border: 'border-indigo-700' },
  { bg: 'bg-cyan-900/30', text: 'text-cyan-400', border: 'border-cyan-700' }
]

export function getTagColor(tagName) {
  let hash = 0
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash)
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

export function Tag({ name, onRemove, onClick, small = false }) {
  const color = getTagColor(name)
  
  return (
    <span 
      className={`inline-flex items-center gap-1 ${color.bg} ${color.text} border ${color.border} rounded-full ${
        small ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'
      } ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      onClick={onClick}
    >
      {name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(name)
          }}
          className="hover:text-white"
        >
          ×
        </button>
      )}
    </span>
  )
}

export function TagSelector({ tags, selectedTags, onToggleTag, onCreateTag }) {
  const [newTagName, setNewTagName] = useState('')
  const [showInput, setShowInput] = useState(false)

  const handleCreate = () => {
    if (newTagName.trim()) {
      onCreateTag(newTagName.trim())
      setNewTagName('')
      setShowInput(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map(tag => (
          <Tag
            key={tag}
            name={tag}
            small
            onClick={() => onToggleTag(tag)}
            className={selectedTags.includes(tag) ? 'ring-2 ring-white' : ''}
          />
        ))}
        
        {showInput ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowInput(false)
              }}
              placeholder="标签名称"
              className="px-2 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded w-20"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="text-xs text-green-400 hover:text-green-300"
            >
              ✓
            </button>
            <button
              onClick={() => setShowInput(false)}
              className="text-xs text-gray-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="px-1.5 py-0.5 text-xs text-gray-500 hover:text-white border border-dashed border-gray-600 rounded-full hover:border-gray-500"
          >
            + 新建
          </button>
        )}
      </div>
    </div>
  )
}

export function TagFilter({ tags, selectedTags, onToggleTag, onClearTags }) {
  if (tags.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500">筛选:</span>
      {tags.map(tag => (
        <button
          key={tag}
          onClick={() => onToggleTag(tag)}
          className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
            selectedTags.includes(tag)
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          {tag}
        </button>
      ))}
      {selectedTags.length > 0 && (
        <button
          onClick={onClearTags}
          className="text-xs text-gray-500 hover:text-white"
        >
          清除
        </button>
      )}
    </div>
  )
}

export default Tag
