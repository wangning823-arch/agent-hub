import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import DesignSpecPreview, { DesignSpec } from './DesignSpecPreview'
import { Palette, Type, Layout, Zap, Code2, Eye } from 'lucide-react'

const API_BASE = '/api'

const UI_LIBRARIES = [
  { value: 'tailwind', label: 'Tailwind' },
  { value: 'antd', label: 'Ant Design' },
  { value: 'mui', label: 'MUI' },
  { value: 'chakra', label: 'Chakra' },
  { value: 'none', label: 'None' },
] as const

const DESIGN_STYLES = [
  { value: 'modern', label: 'Modern', desc: 'Clean & contemporary' },
  { value: 'minimal', label: 'Minimal', desc: 'Less is more' },
  { value: 'corporate', label: 'Corporate', desc: 'Professional' },
  { value: 'playful', label: 'Playful', desc: 'Fun & energetic' },
  { value: 'neobrutalism', label: 'Neo-brutal', desc: 'Bold & raw' },
] as const

const BORDER_RADIUS_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'full', label: 'Full' },
] as const

const FONT_FAMILIES = [
  { value: 'system', label: 'System' },
  { value: 'inter', label: 'Inter' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'noto-sans', label: 'Noto Sans' },
  { value: 'custom', label: 'Custom' },
] as const

const FONT_SIZES = [
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
] as const

const SPACING_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Spacious' },
] as const

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6b7280', '#1e293b', '#0ea5e9',
]

const DEFAULT_SPEC: DesignSpec = {
  id: null,
  name: 'My Design Spec',
  owner_id: null,
  ui_library: 'tailwind',
  design_style: 'modern',
  primary_color: '#6366f1',
  border_radius: 'medium',
  font_family: 'system',
  font_size: 'medium',
  spacing: 'normal',
  dark_mode: 1,
  animations: 1,
  custom_css: '',
}

// Section header
function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span style={{ color: 'var(--accent-primary)' }}>{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

// Segment control
function SegmentControl<T extends string>({
  value, options, onChange
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="btn-segment"
          style={{
            flex: 1,
            background: value === opt.value ? 'var(--accent-primary-soft)' : 'transparent',
            color: value === opt.value ? 'var(--accent-primary)' : 'var(--text-muted)',
            fontWeight: value === opt.value ? 600 : 400,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Toggle switch
function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12,
          background: checked ? 'var(--accent-primary)' : 'var(--bg-primary)',
          border: `1.5px solid ${checked ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
          cursor: 'pointer', position: 'relative', transition: 'all 0.2s ease',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'all 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  )
}

export default function DesignSpecPanel() {
  const toast = useToast()
  const [spec, setSpec] = useState<DesignSpec>(DEFAULT_SPEC)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [promptResult, setPromptResult] = useState<string | null>(null)

  useEffect(() => {
    fetchSpec()
  }, [])

  const fetchSpec = async () => {
    try {
      const res = await fetch(`${API_BASE}/design-specs`)
      const data = await res.json()
      if (data.spec) setSpec(data.spec)
    } catch (e) {
      console.error('Failed to load design spec:', e)
    } finally {
      setLoading(false)
    }
  }

  const updateField = useCallback(<K extends keyof DesignSpec>(key: K, value: DesignSpec[K]) => {
    setSpec(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/design-specs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      })
      const data = await res.json()
      if (data.success && data.spec) {
        setSpec(data.spec)
      }
      toast.success('Design spec saved')
    } catch (e) {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleApply = async () => {
    try {
      const res = await fetch(`${API_BASE}/design-specs/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }),
      })
      const data = await res.json()
      if (data.prompt) {
        setPromptResult(data.prompt)
        toast.success('Prompt generated')
      }
    } catch (e) {
      toast.error('Failed to generate prompt')
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>Loading...</div>
    )
  }

  return (
    <div className="flex gap-4" style={{ minHeight: 400 }}>
      {/* Left: Form (2/3) */}
      <div className="flex-1 space-y-4 overflow-y-auto pr-2" style={{ flex: '2 1 0%', minWidth: 0 }}>
        {/* UI Library */}
        <div className="card">
          <SectionHeader icon={<Layout size={14} />} label="UI Library" />
          <div className="flex flex-wrap gap-2">
            {UI_LIBRARIES.map(lib => (
              <button
                key={lib.value}
                onClick={() => updateField('ui_library', lib.value as DesignSpec['ui_library'])}
                className="btn-pill"
                style={{
                  background: spec.ui_library === lib.value ? 'var(--accent-primary-soft)' : undefined,
                  color: spec.ui_library === lib.value ? 'var(--accent-primary)' : undefined,
                  borderColor: spec.ui_library === lib.value ? 'var(--accent-primary)' : undefined,
                }}
              >
                {lib.label}
              </button>
            ))}
          </div>
        </div>

        {/* Design Style */}
        <div className="card">
          <SectionHeader icon={<Palette size={14} />} label="Design Style" />
          <div className="grid grid-cols-5 gap-2">
            {DESIGN_STYLES.map(style => (
              <button
                key={style.value}
                onClick={() => updateField('design_style', style.value as DesignSpec['design_style'])}
                className="text-center p-2 rounded-lg cursor-pointer transition-all"
                style={{
                  background: spec.design_style === style.value ? 'var(--accent-primary-soft)' : 'var(--bg-primary)',
                  border: spec.design_style === style.value ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  color: spec.design_style === style.value ? 'var(--accent-primary)' : 'var(--text-muted)',
                }}
                title={style.desc}
              >
                <div className="text-xs font-medium">{style.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Primary Color */}
        <div className="card">
          <SectionHeader icon={<Palette size={14} />} label="Primary Color" />
          <div className="flex items-center gap-3 mb-3">
            <input
              type="color"
              value={spec.primary_color}
              onChange={e => updateField('primary_color', e.target.value)}
              style={{ width: 40, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}
            />
            <input
              type="text"
              value={spec.primary_color}
              onChange={e => updateField('primary_color', e.target.value)}
              className="input-field flex-1"
              style={{ padding: '6px 10px', fontFamily: 'monospace' }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => updateField('primary_color', c)}
                style={{
                  width: 24, height: 24, borderRadius: 6, background: c, border: 'none',
                  cursor: 'pointer',
                  outline: spec.primary_color === c ? '2px solid var(--text-primary)' : 'none',
                  outlineOffset: 1,
                }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Border Radius */}
        <div className="card">
          <SectionHeader icon={<Layout size={14} />} label="Border Radius" />
          <SegmentControl
            value={spec.border_radius}
            options={BORDER_RADIUS_OPTIONS}
            onChange={v => updateField('border_radius', v)}
          />
        </div>

        {/* Font Family */}
        <div className="card">
          <SectionHeader icon={<Type size={14} />} label="Font Family" />
          <select
            value={spec.font_family}
            onChange={e => updateField('font_family', e.target.value as DesignSpec['font_family'])}
            className="select-field w-full"
          >
            {FONT_FAMILIES.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="card">
          <SectionHeader icon={<Type size={14} />} label="Font Size" />
          <SegmentControl
            value={spec.font_size}
            options={FONT_SIZES}
            onChange={v => updateField('font_size', v)}
          />
        </div>

        {/* Spacing */}
        <div className="card">
          <SectionHeader icon={<Zap size={14} />} label="Spacing" />
          <SegmentControl
            value={spec.spacing}
            options={SPACING_OPTIONS}
            onChange={v => updateField('spacing', v)}
          />
        </div>

        {/* Toggles */}
        <div className="card space-y-3">
          <ToggleSwitch
            checked={spec.dark_mode === 1}
            onChange={v => updateField('dark_mode', v ? 1 : 0)}
            label="Dark Mode"
          />
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <ToggleSwitch
              checked={spec.animations === 1}
              onChange={v => updateField('animations', v ? 1 : 0)}
              label="Animations"
            />
          </div>
        </div>

        {/* Custom CSS */}
        <div className="card">
          <SectionHeader icon={<Code2 size={14} />} label="Custom CSS" />
          <textarea
            value={spec.custom_css}
            onChange={e => updateField('custom_css', e.target.value)}
            className="input-textarea w-full"
            rows={4}
            placeholder="/* Add custom CSS here */"
            style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary py-2 px-5 text-sm">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleApply} className="btn-secondary py-2 px-5 text-sm">
            Generate Prompt
          </button>
        </div>

        {/* Prompt result */}
        {promptResult && (
          <div className="card">
            <SectionHeader icon={<Eye size={14} />} label="Generated Prompt" />
            <pre className="text-xs p-3 rounded-lg overflow-auto" style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              maxHeight: 200,
            }}>
              {promptResult}
            </pre>
          </div>
        )}
      </div>

      {/* Right: Preview (1/3) */}
      <div className="overflow-y-auto" style={{ flex: '1 0 0%', minWidth: 200, maxHeight: 500 }}>
        <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
          Preview
        </div>
        <DesignSpecPreview spec={spec} />
      </div>
    </div>
  )
}
