import React, { useState, useEffect, useMemo } from 'react'
import { Search, X, Eye, Copy, Check, Download, ExternalLink } from 'lucide-react'
import { API_BASE } from '../config'

interface DesignSystemMeta {
  id: string
  name: string
  description: string
}

interface DesignSystemPanelProps {
  workdir: string
  onClose: () => void
}

export default function DesignSystemPanel({ workdir, onClose }: DesignSystemPanelProps) {
  const [systems, setSystems] = useState<DesignSystemMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [designContent, setDesignContent] = useState('')
  const [previewMode, setPreviewMode] = useState<'code' | 'light' | 'dark'>('code')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/design-systems`)
      .then(r => r.json())
      .then(data => setSystems(data.systems || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return systems
    const q = search.toLowerCase()
    return systems.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    )
  }, [systems, search])

  const handleSelect = async (id: string) => {
    setSelectedId(id)
    setDesignContent('')
    setPreviewMode('code')
    setApplied(false)
    try {
      const res = await fetch(`${API_BASE}/design-systems/${id}`)
      const data = await res.json()
      setDesignContent(data.content || '')
    } catch (e) {
      console.error('Failed to load design system:', e)
    }
  }

  const handleApply = async () => {
    if (!selectedId) return
    setApplying(true)
    try {
      const res = await fetch(`${API_BASE}/design-systems/${selectedId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir }),
      })
      const data = await res.json()
      if (data.success) {
        setApplied(true)
      }
    } catch (e) {
      console.error('Failed to apply:', e)
    } finally {
      setApplying(false)
    }
  }

  const handleCopy = async () => {
    if (!designContent) return
    try {
      await navigator.clipboard.writeText(designContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // Detail view
  if (selectedId) {
    const system = systems.find(s => s.id === selectedId)
    return (
      <div className="rounded-xl overflow-hidden flex flex-col" style={{
        background: 'var(--bg-elevated, var(--bg-secondary))',
        border: '1px solid var(--border-primary)',
        maxHeight: 480,
        width: '100%',
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle, var(--border-primary))' }}>
          <div className="flex items-center gap-2">
            <button onClick={() => { setSelectedId(null); setDesignContent('') }}
              className="text-xs px-2 py-1 rounded-md transition-colors"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
              ← Back
            </button>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {system?.name || selectedId}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Preview mode tabs */}
            {(['code', 'light', 'dark'] as const).map(mode => (
              <button key={mode} onClick={() => setPreviewMode(mode)}
                className="text-xs px-2 py-1 rounded-md transition-colors"
                style={{
                  background: previewMode === mode ? 'var(--accent-primary)' : 'transparent',
                  color: previewMode === mode ? '#fff' : 'var(--text-muted)',
                }}>
                {mode === 'code' ? 'Code' : mode === 'light' ? '☀ Light' : '🌙 Dark'}
              </button>
            ))}
            <button onClick={onClose} className="ml-2 p-1 rounded-md transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          {previewMode === 'code' ? (
            <pre className="p-4 text-xs leading-relaxed overflow-auto h-full" style={{
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {designContent || 'Loading...'}
            </pre>
          ) : (
            <iframe
              src={`${API_BASE}/design-systems/${selectedId}/preview${previewMode === 'dark' ? '-dark' : ''}`}
              style={{ width: '100%', height: '100%', border: 'none', minHeight: 400 }}
              title={`${selectedId} preview`}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
          style={{ borderTop: '1px solid var(--border-subtle, var(--border-primary))' }}>
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: copied ? 'rgba(34,197,94,0.15)' : 'var(--bg-primary)',
              color: copied ? '#22c55e' : 'var(--text-secondary)',
              border: '1px solid var(--border-subtle, var(--border-primary))',
            }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={handleApply} disabled={applying}
            className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg font-medium transition-colors"
            style={{
              background: applied ? '#22c55e' : 'var(--accent-primary)',
              color: '#fff',
              opacity: applying ? 0.6 : 1,
            }}>
            {applying ? 'Applying...' : applied ? '✓ Applied' : 'Apply to Project'}
          </button>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{
      background: 'var(--bg-elevated, var(--bg-secondary))',
      border: '1px solid var(--border-primary)',
      maxHeight: 480,
      width: '100%',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle, var(--border-primary))' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Design Systems ({filtered.length})
        </span>
        <button onClick={onClose} className="p-1 rounded-md transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle, var(--border-primary))' }}>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle, var(--border-primary))' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search design systems..."
            className="flex-1 text-xs bg-transparent border-none outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ color: 'var(--text-muted)' }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">No design systems found</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {filtered.map(sys => (
              <button
                key={sys.id}
                onClick={() => handleSelect(sys.id)}
                className="text-left p-3 rounded-lg transition-all"
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle, var(--border-primary))',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent-primary)'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle, var(--border-primary))'
                  e.currentTarget.style.transform = 'none'
                }}
              >
                <div className="text-xs font-semibold mb-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {sys.name}
                </div>
                <div className="text-xs leading-tight line-clamp-2" style={{
                  color: 'var(--text-muted)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {sys.description || 'Design system'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
