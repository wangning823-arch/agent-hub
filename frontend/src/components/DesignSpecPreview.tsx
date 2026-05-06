import React from 'react'

export interface DesignSpec {
  id: string | null
  name: string
  owner_id: string | null
  ui_library: 'tailwind' | 'antd' | 'mui' | 'chakra' | 'none'
  design_style: 'modern' | 'minimal' | 'corporate' | 'playful' | 'neobrutalism'
  primary_color: string
  border_radius: 'none' | 'small' | 'medium' | 'large' | 'full'
  font_family: 'system' | 'inter' | 'roboto' | 'noto-sans' | 'custom'
  font_size: 'small' | 'medium' | 'large'
  spacing: 'compact' | 'normal' | 'spacious'
  dark_mode: number
  animations: number
  custom_css: string
}

interface DesignSpecPreviewProps {
  spec: DesignSpec
}

const RADIUS_MAP: Record<string, string> = {
  none: '0px', small: '4px', medium: '8px', large: '16px', full: '9999px'
}
const FONT_SIZE_MAP: Record<string, string> = {
  small: '13px', medium: '15px', large: '17px'
}
const SPACING_MAP: Record<string, string> = {
  compact: '8px', normal: '12px', spacious: '16px'
}
const FONT_FAMILY_MAP: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  inter: '"Inter", sans-serif',
  roboto: '"Roboto", sans-serif',
  'noto-sans': '"Noto Sans SC", sans-serif',
  custom: 'inherit'
}

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, ((num >> 16) & 0xff) - amount)
  const g = Math.max(0, ((num >> 8) & 0xff) - amount)
  const b = Math.max(0, (num & 0xff) - amount)
  return `rgb(${r}, ${g}, ${b})`
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, ((num >> 16) & 0xff) + amount)
  const g = Math.min(255, ((num >> 8) & 0xff) + amount)
  const b = Math.min(255, (num & 0xff) + amount)
  return `rgb(${r}, ${g}, ${b})`
}

// Style-specific visual overrides
function getStyleOverrides(spec: DesignSpec, base: ReturnType<typeof resolveBase>) {
  const style = spec.design_style
  const lib = spec.ui_library

  // Base style differences
  let overrides: {
    cardBg: string
    cardBorder: string
    cardShadow: string
    cardPadding: string
    btnRadius: string
    btnShadow: string
    inputBorder: string
    headerWeight: string
    headerLetterSpacing: string
    borderRadius: string
    headingStyle: React.CSSProperties
  }

  switch (style) {
    case 'minimal':
      overrides = {
        cardBg: 'transparent',
        cardBorder: `1px solid ${base.borderColor}`,
        cardShadow: 'none',
        cardPadding: base.spacing,
        btnRadius: base.radius,
        btnShadow: 'none',
        inputBorder: `1px solid ${base.borderColor}`,
        headerWeight: '600',
        headerLetterSpacing: '0.05em',
        borderRadius: base.radius,
        headingStyle: { fontWeight: 600, letterSpacing: '0.05em' as const },
      }
      break
    case 'corporate':
      overrides = {
        cardBg: base.surfaceColor,
        cardBorder: `1px solid ${base.borderColor}`,
        cardShadow: `0 1px 3px rgba(0,0,0,${base.isDark ? '0.3' : '0.08'})`,
        cardPadding: base.spacing,
        btnRadius: '4px',
        btnShadow: 'none',
        inputBorder: `1px solid ${base.borderColor}`,
        headerWeight: '700',
        headerLetterSpacing: '0.01em',
        borderRadius: '4px',
        headingStyle: { fontWeight: 700, letterSpacing: '0.01em' as const },
      }
      break
    case 'playful':
      overrides = {
        cardBg: base.surfaceColor,
        cardBorder: `2px solid ${lightenColor(base.primary, 80)}`,
        cardShadow: `0 4px 12px ${base.primary}22`,
        cardPadding: `calc(${base.spacing} + 2px)`,
        btnRadius: '20px',
        btnShadow: `0 2px 8px ${base.primary}44`,
        inputBorder: `2px solid ${lightenColor(base.primary, 60)}`,
        headerWeight: '800',
        headerLetterSpacing: '0.02em',
        borderRadius: '16px',
        headingStyle: { fontWeight: 800, letterSpacing: '0.02em' as const },
      }
      break
    case 'neobrutalism':
      overrides = {
        cardBg: base.surfaceColor,
        cardBorder: `3px solid ${base.textColor}`,
        cardShadow: `4px 4px 0px ${base.textColor}`,
        cardPadding: base.spacing,
        btnRadius: '0px',
        btnShadow: `3px 3px 0px ${darkenColor(base.primary, 60)}`,
        inputBorder: `2px solid ${base.textColor}`,
        headerWeight: '900',
        headerLetterSpacing: '0.04em',
        borderRadius: '0px',
        headingStyle: { fontWeight: 900, letterSpacing: '0.04em' as const },
      }
      break
    default: // modern
      overrides = {
        cardBg: base.surfaceColor,
        cardBorder: `1px solid ${base.borderColor}`,
        cardShadow: `0 2px 8px rgba(0,0,0,${base.isDark ? '0.4' : '0.06'})`,
        cardPadding: base.spacing,
        btnRadius: base.radius,
        btnShadow: `0 1px 4px rgba(0,0,0,${base.isDark ? '0.3' : '0.1'})`,
        inputBorder: `1px solid ${base.borderColor}`,
        headerWeight: '700',
        headerLetterSpacing: '-0.01em',
        borderRadius: base.radius,
        headingStyle: { fontWeight: 700, letterSpacing: '-0.01em' as const },
      }
  }

  // Library-specific adjustments
  switch (lib) {
    case 'antd':
      overrides.btnRadius = style === 'neobrutalism' ? '0px' : '6px'
      overrides.cardBorder = style === 'neobrutalism'
        ? overrides.cardBorder
        : `1px solid ${base.borderColor}`
      break
    case 'mui':
      overrides.btnShadow = style === 'neobrutalism'
        ? overrides.btnShadow
        : `0 1px 5px rgba(0,0,0,${base.isDark ? '0.4' : '0.15'})`
      overrides.cardShadow = style === 'neobrutalism'
        ? overrides.cardShadow
        : `0 2px 4px -1px rgba(0,0,0,${base.isDark ? '0.4' : '0.1'}), 0 1px 3px rgba(0,0,0,${base.isDark ? '0.3' : '0.06'})`
      break
    case 'chakra':
      overrides.btnRadius = style === 'neobrutalism' ? '0px' : base.radius
      overrides.cardShadow = style === 'neobrutalism'
        ? overrides.cardShadow
        : `0 1px 2px rgba(0,0,0,${base.isDark ? '0.3' : '0.05'})`
      break
  }

  return overrides
}

function resolveBase(spec: DesignSpec) {
  const isDark = spec.dark_mode === 1
  const radius = RADIUS_MAP[spec.border_radius] || '8px'
  const fontSize = FONT_SIZE_MAP[spec.font_size] || '15px'
  const spacing = SPACING_MAP[spec.spacing] || '12px'
  const fontFamily = FONT_FAMILY_MAP[spec.font_family] || 'inherit'
  const primary = spec.primary_color || '#6366f1'

  const bgColor = isDark ? '#1a1a2e' : '#ffffff'
  const surfaceColor = isDark ? '#222240' : '#f8f9fa'
  const textColor = isDark ? '#e0e0e0' : '#1a1a2e'
  const mutedColor = isDark ? '#8888aa' : '#6b7280'
  const borderColor = isDark ? '#333355' : '#e5e7eb'

  return {
    radius, fontSize, spacing, fontFamily, primary,
    bgColor, surfaceColor, textColor, mutedColor, borderColor, isDark
  }
}

const STYLE_LABELS: Record<string, string> = {
  modern: 'Clean & contemporary',
  minimal: 'Less is more',
  corporate: 'Professional & polished',
  playful: 'Fun & energetic',
  neobrutalism: 'Bold & raw',
}

const LIB_LABELS: Record<string, string> = {
  tailwind: 'Utility-first',
  antd: 'Enterprise',
  mui: 'Material Design',
  chakra: 'Accessible',
  none: 'Custom',
}

export default function DesignSpecPreview({ spec }: DesignSpecPreviewProps) {
  const base = resolveBase(spec)
  const o = getStyleOverrides(spec, base)

  const anim: React.CSSProperties = spec.animations === 1
    ? { transition: 'all 0.2s ease' }
    : {}

  const cardStyle: React.CSSProperties = {
    borderRadius: o.cardBorder.includes('3px') && spec.design_style === 'neobrutalism' ? '0px' : o.borderRadius,
    background: o.cardBg,
    border: o.cardBorder,
    padding: o.cardPadding,
    fontFamily: base.fontFamily,
    fontSize: base.fontSize,
    color: base.textColor,
    boxShadow: o.cardShadow,
    ...anim,
  }

  const buttonStyle: React.CSSProperties = {
    borderRadius: o.btnRadius,
    background: base.primary,
    color: '#ffffff',
    border: spec.design_style === 'neobrutalism' ? `2px solid ${darkenColor(base.primary, 40)}` : 'none',
    padding: `${parseInt(base.spacing) / 2}px ${base.spacing}`,
    fontSize: base.fontSize,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: base.fontFamily,
    boxShadow: o.btnShadow,
    ...anim,
  }

  const secondaryBtnStyle: React.CSSProperties = {
    ...buttonStyle,
    background: 'transparent',
    color: base.primary,
    border: `1.5px solid ${base.primary}`,
    boxShadow: spec.design_style === 'neobrutalism' ? `3px 3px 0px ${base.primary}` : 'none',
  }

  const inputStyle: React.CSSProperties = {
    borderRadius: o.borderRadius,
    background: base.isDark ? '#2a2a4a' : '#ffffff',
    border: o.inputBorder,
    padding: `${parseInt(base.spacing) / 2}px ${base.spacing}`,
    fontSize: base.fontSize,
    color: base.textColor,
    width: '100%',
    fontFamily: base.fontFamily,
    outline: 'none',
    ...anim,
  }

  const headingStyle: React.CSSProperties = {
    fontFamily: base.fontFamily,
    fontSize: `calc(${base.fontSize} + 4px)`,
    color: base.textColor,
    margin: 0,
    lineHeight: 1.3,
    ...o.headingStyle,
  }

  const bodyStyle: React.CSSProperties = {
    fontFamily: base.fontFamily,
    fontSize: base.fontSize,
    color: base.mutedColor,
    margin: 0,
    lineHeight: 1.5,
  }

  return (
    <div style={{
      background: base.bgColor,
      borderRadius: o.borderRadius,
      padding: base.spacing,
      display: 'flex',
      flexDirection: 'column',
      gap: base.spacing,
      minHeight: '100%',
      overflow: 'auto',
    }}>
      {/* Header card */}
      <div style={cardStyle}>
        <h3 style={headingStyle}>{spec.name || 'Design Preview'}</h3>
        <p style={{ ...bodyStyle, marginTop: '4px' }}>
          {STYLE_LABELS[spec.design_style] || 'Custom style'} &middot; {LIB_LABELS[spec.ui_library] || spec.ui_library}
        </p>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: base.spacing, flexWrap: 'wrap' }}>
        <button style={buttonStyle}>Primary</button>
        <button style={secondaryBtnStyle}>Secondary</button>
      </div>

      {/* Input */}
      <div style={cardStyle}>
        <label style={{
          display: 'block',
          fontSize: `calc(${base.fontSize} - 2px)`,
          fontWeight: 600,
          color: base.textColor,
          marginBottom: '4px',
        }}>
          Email
        </label>
        <input style={inputStyle} placeholder="you@example.com" readOnly />
      </div>

      {/* Text hierarchy */}
      <div style={cardStyle}>
        <h4 style={{ ...headingStyle, fontSize: `calc(${base.fontSize} + 1px)`, marginBottom: '4px' }}>
          Text Hierarchy
        </h4>
        <p style={bodyStyle}>
          This is body text using the {spec.font_family} font family
          at {spec.font_size} size with {spec.spacing} spacing.
        </p>
        <p style={{ ...bodyStyle, fontSize: `calc(${base.fontSize} - 2px)`, marginTop: '6px', fontStyle: 'italic' }}>
          This is secondary text with a muted color.
        </p>
      </div>

      {/* Color swatch */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '6px',
          background: base.primary,
          border: spec.design_style === 'neobrutalism' ? `2px solid ${base.textColor}` : 'none',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: `calc(${base.fontSize} - 2px)`, color: base.mutedColor, fontFamily: base.fontFamily }}>
          {base.primary} / {spec.ui_library}
        </span>
      </div>
    </div>
  )
}
