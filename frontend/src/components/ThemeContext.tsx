import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

type ThemeName = 'dark' | 'light' | 'midnight' | 'sakura'

interface ThemeColors {
  '--bg-primary': string
  '--bg-secondary': string
  '--bg-tertiary': string
  '--bg-elevated': string
  '--bg-hover': string
  '--bg-active': string
  '--border-primary': string
  '--border-subtle': string
  '--text-primary': string
  '--text-secondary': string
  '--text-muted': string
  '--accent-primary': string
  '--accent-primary-hover': string
  '--accent-primary-soft': string
  '--accent-secondary': string
  '--success': string
  '--success-soft': string
  '--warning': string
  '--warning-soft': string
  '--error': string
  '--error-soft': string
  '--gradient-header': string
  '--gradient-btn-primary': string
  '--gradient-btn-hover': string
  '--shadow-sm': string
  '--shadow-md': string
  '--shadow-lg': string
  '--shadow-glow': string
}

export interface ThemeConfig {
  name: string
  icon: string
  colors: ThemeColors
}

interface Themes {
  [key: string]: ThemeConfig
}

interface ThemeContextValue {
  theme: ThemeConfig
  themeName: ThemeName
  themes: Themes
  changeTheme: (name: string) => void
  syncUserTheme: (preferences?: { theme?: string }) => void
}

const themes: Themes = {
  dark: {
    name: '暗夜',
    icon: '🌙',
    colors: {
      '--bg-primary': '#0a0a0f',
      '--bg-secondary': '#12121a',
      '--bg-tertiary': '#1a1a26',
      '--bg-elevated': '#22222e',
      '--bg-hover': '#2a2a38',
      '--bg-active': '#32324a',
      '--border-primary': '#2a2a3a',
      '--border-subtle': '#1e1e2e',
      '--text-primary': '#e8e8f0',
      '--text-secondary': '#a0a0b8',
      '--text-muted': '#6a6a82',
      '--accent-primary': '#6366f1',
      '--accent-primary-hover': '#818cf8',
      '--accent-primary-soft': 'rgba(99,102,241,0.15)',
      '--accent-secondary': '#8b5cf6',
      '--success': '#34d399',
      '--success-soft': 'rgba(52,211,153,0.15)',
      '--warning': '#fbbf24',
      '--warning-soft': 'rgba(251,191,36,0.15)',
      '--error': '#f87171',
      '--error-soft': 'rgba(248,113,113,0.15)',
      '--gradient-header': 'linear-gradient(135deg, #12121a 0%, #1a1a2e 100%)',
      '--gradient-btn-primary': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      '--gradient-btn-hover': 'linear-gradient(135deg, #818cf8 0%, #a78bfa 100%)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.4)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.5)',
      '--shadow-lg': '0 8px 32px rgba(0,0,0,0.6)',
      '--shadow-glow': '0 0 20px rgba(99,102,241,0.2)',
    }
  },
  light: {
    name: '亮白',
    icon: '☀️',
    colors: {
      '--bg-primary': '#f8f9fc',
      '--bg-secondary': '#ffffff',
      '--bg-tertiary': '#f0f1f5',
      '--bg-elevated': '#ffffff',
      '--bg-hover': '#e8eaf0',
      '--bg-active': '#dde0ea',
      '--border-primary': '#d4d8e0',
      '--border-subtle': '#e8ebf0',
      '--text-primary': '#1a1a2e',
      '--text-secondary': '#4a4a62',
      '--text-muted': '#8a8aa0',
      '--accent-primary': '#4f46e5',
      '--accent-primary-hover': '#6366f1',
      '--accent-primary-soft': 'rgba(79,70,229,0.08)',
      '--accent-secondary': '#7c3aed',
      '--success': '#059669',
      '--success-soft': 'rgba(5,150,105,0.08)',
      '--warning': '#d97706',
      '--warning-soft': 'rgba(217,119,6,0.08)',
      '--error': '#dc2626',
      '--error-soft': 'rgba(220,38,38,0.08)',
      '--gradient-header': 'linear-gradient(135deg, #ffffff 0%, #f0f1f5 100%)',
      '--gradient-btn-primary': 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
      '--gradient-btn-hover': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.08)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.1)',
      '--shadow-lg': '0 8px 32px rgba(0,0,0,0.12)',
      '--shadow-glow': '0 0 20px rgba(79,70,229,0.15)',
    }
  },
  midnight: {
    name: '深夜蓝',
    icon: '🌌',
    colors: {
      '--bg-primary': '#070b14',
      '--bg-secondary': '#0d1321',
      '--bg-tertiary': '#141c2e',
      '--bg-elevated': '#1a2540',
      '--bg-hover': '#1f2d4a',
      '--bg-active': '#243555',
      '--border-primary': '#1e2d4a',
      '--border-subtle': '#152035',
      '--text-primary': '#c8d6e5',
      '--text-secondary': '#7f8fa6',
      '--text-muted': '#576574',
      '--accent-primary': '#0abde3',
      '--accent-primary-hover': '#48dbfb',
      '--accent-primary-soft': 'rgba(10,189,227,0.12)',
      '--accent-secondary': '#a29bfe',
      '--success': '#00d2d3',
      '--success-soft': 'rgba(0,210,211,0.12)',
      '--warning': '#feca57',
      '--warning-soft': 'rgba(254,202,87,0.12)',
      '--error': '#ff6b6b',
      '--error-soft': 'rgba(255,107,107,0.12)',
      '--gradient-header': 'linear-gradient(135deg, #0d1321 0%, #1a2540 100%)',
      '--gradient-btn-primary': 'linear-gradient(135deg, #0abde3 0%, #a29bfe 100%)',
      '--gradient-btn-hover': 'linear-gradient(135deg, #48dbfb 0%, #c8c4ff 100%)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.5)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.6)',
      '--shadow-lg': '0 8px 32px rgba(0,0,0,0.7)',
      '--shadow-glow': '0 0 20px rgba(10,189,227,0.2)',
    }
  },
  sakura: {
    name: '樱粉',
    icon: '🌸',
    colors: {
      '--bg-primary': '#1a0f14',
      '--bg-secondary': '#221520',
      '--bg-tertiary': '#2c1a28',
      '--bg-elevated': '#361f32',
      '--bg-hover': '#40253c',
      '--bg-active': '#4a2b46',
      '--border-primary': '#3a2038',
      '--border-subtle': '#2a1828',
      '--text-primary': '#f0d8e8',
      '--text-secondary': '#c8a0b8',
      '--text-muted': '#8a6a80',
      '--accent-primary': '#f472b6',
      '--accent-primary-hover': '#f9a8d4',
      '--accent-primary-soft': 'rgba(244,114,182,0.15)',
      '--accent-secondary': '#c084fc',
      '--success': '#a3e635',
      '--success-soft': 'rgba(163,230,53,0.12)',
      '--warning': '#fbbf24',
      '--warning-soft': 'rgba(251,191,36,0.12)',
      '--error': '#fb7185',
      '--error-soft': 'rgba(251,113,133,0.12)',
      '--gradient-header': 'linear-gradient(135deg, #221520 0%, #2c1a28 100%)',
      '--gradient-btn-primary': 'linear-gradient(135deg, #f472b6 0%, #c084fc 100%)',
      '--gradient-btn-hover': 'linear-gradient(135deg, #f9a8d4 0%, #d8b4fe 100%)',
      '--shadow-sm': '0 1px 3px rgba(0,0,0,0.4)',
      '--shadow-md': '0 4px 12px rgba(0,0,0,0.5)',
      '--shadow-lg': '0 8px 32px rgba(0,0,0,0.6)',
      '--shadow-glow': '0 0 20px rgba(244,114,182,0.2)',
    }
  }
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    return (localStorage.getItem('agent-hub-theme') as ThemeName) || 'dark'
  })

  const theme: ThemeConfig = themes[themeName]

  useEffect(() => {
    const root = document.documentElement
    const colors = theme.colors
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })
    root.setAttribute('data-theme', themeName)
    localStorage.setItem('agent-hub-theme', themeName)
  }, [themeName, theme])

  const saveThemeToBackend = useCallback(async (theme: string) => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) return
      await fetch('/api/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ preferences: { theme } }),
      })
    } catch (err) {
      console.error('保存主题偏好失败:', err)
    }
  }, [])

  const syncUserTheme = useCallback((preferences?: { theme?: string }) => {
    if (preferences?.theme && themes[preferences.theme]) {
      setThemeName(preferences.theme as ThemeName)
    }
  }, [])

  const changeTheme = (name: string): void => {
    if (themes[name]) {
      setThemeName(name as ThemeName)
      saveThemeToBackend(name)
    }
  }

  return (
    <ThemeContext.Provider value={{
      theme,
      themeName,
      themes,
      changeTheme,
      syncUserTheme
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
