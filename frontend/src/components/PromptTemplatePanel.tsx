import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Plus, X, FileText, Tag } from 'lucide-react'
import { API_BASE } from '../config'

// ---- Types ----

interface PromptTemplate {
  id: string
  name: string
  description: string
  category: string
  content: string
  is_builtin: boolean
  owner_id?: string | null
  created_at?: number
  updated_at?: number
  usage_count?: number
}

interface TemplateCategory {
  id: string
  name: string
  description: string
}

interface PromptTemplatePanelProps {
  onSelect: (content: string) => void
  onClose: () => void
}

// ---- Debounce hook ----

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

// ---- Component ----

export default function PromptTemplatePanel({ onSelect, onClose }: PromptTemplatePanelProps) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [newContent, setNewContent] = useState('')

  const searchInputRef = useRef<HTMLInputElement>(null)
  const debouncedSearch = useDebounce(searchQuery, 300)

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (activeCategory) params.set('category', activeCategory)
      if (debouncedSearch) params.set('search', debouncedSearch)

      const res = await fetch(`${API_BASE}/prompt-templates?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || [])
      }
    } catch (e) {
      console.error('Failed to fetch prompt templates:', e)
    } finally {
      setLoading(false)
    }
  }, [activeCategory, debouncedSearch])

  // Fetch categories from the JSON data file
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/prompt-templates`)
      if (res.ok) {
        const data = await res.json()
        // Extract unique categories from templates
        const categoryMap = new Map<string, TemplateCategory>()
        for (const t of data.templates || []) {
          if (!categoryMap.has(t.category)) {
            categoryMap.set(t.category, {
              id: t.category,
              name: getCategoryLabel(t.category),
              description: '',
            })
          }
        }
        setCategories(Array.from(categoryMap.values()))
      }
    } catch (e) {
      console.error('Failed to fetch categories:', e)
    }
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  // Focus search on mount
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Handle template selection
  const handleSelect = async (template: PromptTemplate) => {
    onSelect(template.content)
    // Record usage (fire and forget)
    try {
      await fetch(`${API_BASE}/prompt-templates/${template.id}/use`, { method: 'POST' })
    } catch {
      // ignore
    }
    onClose()
  }

  // Handle create template
  const handleCreate = async () => {
    if (!newName.trim() || !newContent.trim()) return

    try {
      setCreating(true)
      const res = await fetch(`${API_BASE}/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          category: newCategory,
          content: newContent.trim(),
        }),
      })

      if (res.ok) {
        setShowCreateForm(false)
        setNewName('')
        setNewDescription('')
        setNewCategory('general')
        setNewContent('')
        fetchTemplates()
        fetchCategories()
      }
    } catch (e) {
      console.error('Failed to create template:', e)
    } finally {
      setCreating(false)
    }
  }

  // Category label mapping
  function getCategoryLabel(id: string): string {
    const labels: Record<string, string> = {
      ui: 'UI 组件',
      code: '代码操作',
      testing: '测试',
      docs: '文档',
      i18n: '国际化',
      general: '通用',
    }
    return labels[id] || id
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-primary)',
        maxHeight: 420,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2">
          <FileText size={14} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Prompt 模板
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模板..."
            className="input-field w-full text-xs"
            style={{ paddingLeft: 32, paddingRight: 8, height: 32 }}
          />
        </div>
      </div>

      {/* Category filters */}
      {categories.length > 0 && (
        <div
          className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <button
            className={`btn-pill ${activeCategory === null ? 'active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`btn-pill ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Template list */}
      <div className="overflow-y-auto flex-1" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              加载中...
            </span>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <FileText size={24} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {searchQuery || activeCategory ? '没有找到匹配的模板' : '暂无模板'}
            </span>
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {templates.map((template) => (
              <div
                key={template.id}
                onClick={() => handleSelect(template)}
                className="rounded-lg px-3 py-2.5 cursor-pointer transition-colors group"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)'
                  e.currentTarget.style.borderColor = 'var(--accent-primary)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.borderColor = 'var(--border-subtle)'
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {template.name}
                      </span>
                      {template.is_builtin && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: 'var(--accent-primary-soft)',
                            color: 'var(--accent-primary)',
                          }}
                        >
                          内置
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p
                        className="text-xs mt-0.5 line-clamp-1"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {template.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tag size={10} style={{ color: 'var(--text-muted)' }} />
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {getCategoryLabel(template.category)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Create button */}
      <div
        className="px-3 py-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className="btn-secondary w-full flex items-center justify-center gap-1.5 text-xs"
            style={{ height: 32 }}
          >
            <Plus size={12} />
            创建新模板
          </button>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="模板名称"
              className="input-field w-full text-xs"
              style={{ height: 32 }}
            />
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="模板描述（可选）"
              className="input-field w-full text-xs"
              style={{ height: 32 }}
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="input-field w-full text-xs"
              style={{ height: 32, background: 'var(--bg-tertiary)' }}
            >
              <option value="ui">UI 组件</option>
              <option value="code">代码操作</option>
              <option value="testing">测试</option>
              <option value="docs">文档</option>
              <option value="i18n">国际化</option>
              <option value="general">通用</option>
            </select>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="模板内容..."
              className="input-field w-full text-xs resize-none"
              style={{ minHeight: 60, maxHeight: 100 }}
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreateForm(false)
                  setNewName('')
                  setNewDescription('')
                  setNewCategory('general')
                  setNewContent('')
                }}
                className="btn-secondary flex-1 text-xs"
                style={{ height: 30 }}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || !newContent.trim() || creating}
                className="btn-primary flex-1 text-xs"
                style={{
                  height: 30,
                  opacity: (!newName.trim() || !newContent.trim() || creating) ? 0.5 : 1,
                }}
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
