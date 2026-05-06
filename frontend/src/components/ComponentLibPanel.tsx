import React, { useState, useEffect, useCallback } from 'react'
import { Search, X, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { API_BASE } from '../config'

interface ComponentItem {
  id: string
  name: string
  category: string
  description: string
  preview: string
  code: string
  importRequired?: boolean
  importStatement?: string
}

interface LibraryInfo {
  id: string
  name: string
  version: string
  package: string
  description: string
  detected: boolean
  componentCount: number
}

interface CategoryInfo {
  id: string
  name: string
  description: string
}

interface ComponentLibPanelProps {
  workdir: string
  onSelect: (code: string) => void
  onClose: () => void
}

export default function ComponentLibPanel({ workdir, onSelect, onClose }: ComponentLibPanelProps) {
  const [libraries, setLibraries] = useState<LibraryInfo[]>([])
  const [categories, setCategories] = useState<CategoryInfo[]>([])
  const [activeLib, setActiveLib] = useState<string>('')
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch libraries list with detection
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (workdir) params.set('workdir', workdir)
    fetch(`${API_BASE}/component-libs?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setLibraries(data.libraries || [])
        setCategories(data.categories || [])
        // Auto-select first detected library, or first library
        if (data.libraries?.length) {
          const detected = data.libraries.find((l: LibraryInfo) => l.detected)
          setActiveLib(detected?.id || data.libraries[0].id)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [workdir])

  // Fetch components for active library
  useEffect(() => {
    if (!activeLib) return
    const params = new URLSearchParams()
    if (activeCategory) params.set('category', activeCategory)
    if (search) params.set('search', search)
    fetch(`${API_BASE}/component-libs/${activeLib}/components?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setComponents(data.components || [])
      })
      .catch(() => setComponents([]))
  }, [activeLib, activeCategory, search])

  const handleInsert = useCallback(
    (comp: ComponentItem) => {
      let fullCode = ''
      if (comp.importRequired && comp.importStatement) {
        fullCode = comp.importStatement + '\n\n'
      }
      fullCode += comp.code
      onSelect(fullCode)
      onClose()
    },
    [onSelect, onClose]
  )

  const handleCopyCode = useCallback((comp: ComponentItem) => {
    let fullCode = ''
    if (comp.importRequired && comp.importStatement) {
      fullCode = comp.importStatement + '\n\n'
    }
    fullCode += comp.code
    navigator.clipboard.writeText(fullCode).then(() => {
      setCopiedId(comp.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }, [])

  return (
    <div
      className="rounded-t-xl border overflow-hidden flex flex-col"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-primary)',
        maxHeight: 420,
        minHeight: 320,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          组件库
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Library tabs */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {libraries.map((lib) => (
          <button
            key={lib.id}
            onClick={() => {
              setActiveLib(lib.id)
              setActiveCategory('')
              setSearch('')
            }}
            className="px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-colors"
            style={{
              background: activeLib === lib.id ? 'var(--accent-primary-soft)' : 'transparent',
              color: activeLib === lib.id ? 'var(--accent-primary)' : lib.detected ? 'var(--text-secondary)' : 'var(--text-muted)',
              fontWeight: activeLib === lib.id ? 500 : 400,
              opacity: lib.detected ? 1 : 0.6,
            }}
          >
            {lib.name}
            {lib.detected && (
              <span
                className="ml-1 inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--success)' }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar categories */}
        <div
          className="w-28 shrink-0 border-r py-2 overflow-y-auto"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <button
            onClick={() => setActiveCategory('')}
            className="w-full text-left px-3 py-1.5 text-xs transition-colors"
            style={{
              color: activeCategory === '' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: activeCategory === '' ? 'var(--accent-primary-soft)' : 'transparent',
            }}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{
                color: activeCategory === cat.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                background: activeCategory === cat.id ? 'var(--accent-primary-soft)' : 'transparent',
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2">
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border"
              style={{
                background: 'var(--bg-secondary)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <Search size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索组件..."
                className="flex-1 bg-transparent text-xs focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ color: 'var(--text-muted)' }}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Component grid */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  加载中...
                </span>
              </div>
            ) : components.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  暂无组件
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {components.map((comp) => {
                  const isExpanded = expandedId === comp.id
                  return (
                    <div
                      key={comp.id}
                      className="rounded-lg border overflow-hidden transition-all"
                      style={{
                        background: 'var(--bg-secondary)',
                        borderColor: isExpanded ? 'var(--accent-primary)' : 'var(--border-subtle)',
                      }}
                    >
                      {/* Preview */}
                      <div
                        className="cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : comp.id)}
                      >
                        <div
                          className="px-2 py-2 flex items-center justify-center overflow-hidden"
                          style={{ minHeight: 64, maxHeight: isExpanded ? 200 : 64 }}
                        >
                          <iframe
                            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100%;font-family:system-ui,-apple-system,sans-serif;overflow:hidden;}</style></head><body>${comp.preview}</body></html>`}
                            sandbox="allow-same-origin"
                            style={{
                              width: '100%',
                              height: isExpanded ? 180 : 56,
                              border: 'none',
                              pointerEvents: 'none',
                              background: 'transparent',
                            }}
                            title={comp.name}
                          />
                        </div>
                      </div>

                      {/* Info */}
                      <div
                        className="px-2.5 py-2 border-t"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="text-xs font-medium"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {comp.name}
                          </span>
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : comp.id)}
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </div>
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {comp.description}
                        </p>
                      </div>

                      {/* Expanded: full preview + code + actions */}
                      {isExpanded && (
                        <div
                          className="border-t px-2.5 py-2"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          {/* Code block */}
                          <pre
                            className="text-xs p-2 rounded-lg overflow-x-auto mb-2"
                            style={{
                              background: 'var(--bg-primary)',
                              color: 'var(--text-secondary)',
                              maxHeight: 120,
                            }}
                          >
                            <code>{comp.code}</code>
                          </pre>

                          <div className="flex gap-1.5">
                            <button
                              onClick={() => handleInsert(comp)}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                              style={{
                                background: 'var(--accent-primary)',
                                color: '#fff',
                              }}
                            >
                              插入
                            </button>
                            <button
                              onClick={() => handleCopyCode(comp)}
                              className="px-2 py-1.5 rounded-lg text-xs transition-colors"
                              style={{
                                background: 'var(--bg-primary)',
                                color: copiedId === comp.id ? 'var(--success)' : 'var(--text-secondary)',
                                border: '1px solid var(--border-subtle)',
                              }}
                            >
                              {copiedId === comp.id ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
