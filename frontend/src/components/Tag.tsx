import React, { useState } from 'react'

interface TagStyle {
  bg: string
  text: string
  border: string
}

// Use semantic colors that work across themes
const TAG_STYLES: TagStyle[] = [
  { bg: 'rgba(239,68,68,0.15)', text: '#f87171', border: 'rgba(239,68,68,0.3)' },
  { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24', border: 'rgba(245,158,11,0.3)' },
  { bg: 'rgba(16,185,129,0.15)', text: '#34d399', border: 'rgba(16,185,129,0.3)' },
  { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', border: 'rgba(59,130,246,0.3)' },
  { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa', border: 'rgba(139,92,246,0.3)' },
  { bg: 'rgba(236,72,153,0.15)', text: '#f472b6', border: 'rgba(236,72,153,0.3)' },
  { bg: 'rgba(99,102,241,0.15)', text: '#818cf8', border: 'rgba(99,102,241,0.3)' },
  { bg: 'rgba(6,182,212,0.15)', text: '#22d3ee', border: 'rgba(6,182,212,0.3)' },
]

export function getTagColor(tagName: string): TagStyle {
  let hash = 0
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash)
  }
  return TAG_STYLES[Math.abs(hash) % TAG_STYLES.length]
}

interface TagProps {
  name: string
  onRemove?: (name: string) => void
  onClick?: () => void
  small?: boolean
}

export function Tag({ name, onRemove, onClick, small = false }: TagProps) {
  const color = getTagColor(name)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${small ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}` }}
      onClick={onClick}
    >
      {name}
      {onRemove && (
        <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(name) }} className="hover:opacity-80">×</button>
      )}
    </span>
  )
}

interface TagSelectorProps {
  tags: string[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onCreateTag: (tag: string) => void
}

export function TagSelector({ tags, selectedTags, onToggleTag, onCreateTag }: TagSelectorProps) {
  const [newTagName, setNewTagName] = useState<string>('')
  const [showInput, setShowInput] = useState<boolean>(false)

  const handleCreate = (): void => {
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
          <Tag key={tag} name={tag} small onClick={() => onToggleTag(tag)} />
        ))}
        {showInput ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTagName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowInput(false)
              }}
              placeholder="标签名称"
              className="input-field text-xs py-0.5 px-2 w-20"
              style={{ fontSize: '0.7rem' }}
              autoFocus
            />
            <button onClick={handleCreate} className="text-xs" style={{ color: 'var(--success)' }}>✓</button>
            <button onClick={() => setShowInput(false)} className="btn-icon w-5 h-5 text-xs">✕</button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="px-1.5 py-0.5 text-xs rounded-full border border-dashed transition-colors"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border-primary)' }}
          >
            + 新建
          </button>
        )}
      </div>
    </div>
  )
}

interface TagFilterProps {
  tags: string[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onClearTags: () => void
}

export function TagFilter({ tags, selectedTags, onToggleTag, onClearTags }: TagFilterProps) {
  if (tags.length === 0) return null
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>筛选:</span>
      {tags.map(tag => (
        <button
          key={tag}
          onClick={() => onToggleTag(tag)}
          className="btn-pill text-xs py-0.5"
          style={selectedTags.includes(tag) ? {
            background: 'var(--accent-primary-soft)',
            color: 'var(--accent-primary)',
            borderColor: 'var(--accent-primary)',
          } : {}}
        >
          {tag}
        </button>
      ))}
      {selectedTags.length > 0 && (
        <button onClick={onClearTags} className="text-xs" style={{ color: 'var(--text-muted)' }}>清除</button>
      )}
    </div>
  )
}

export default Tag
