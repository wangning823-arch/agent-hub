import React, { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(null)

// 主题配置
const themes = {
  dark: {
    name: '深色',
    icon: '🌙',
    colors: {
      bg: '#0a0a0a',
      bgSecondary: '#111111',
      bgTertiary: '#1a1a1a',
      border: '#2a2a2a',
      text: '#fafafa',
      textSecondary: '#a1a1aa',
      textMuted: '#71717a',
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      userBubble: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
      assistantBubble: 'linear-gradient(135deg, #1f2937 0%, #374151 100%)'
    }
  },
  light: {
    name: '浅色',
    icon: '☀️',
    colors: {
      bg: '#ffffff',
      bgSecondary: '#f9fafb',
      bgTertiary: '#f3f4f6',
      border: '#e5e7eb',
      text: '#111827',
      textSecondary: '#4b5563',
      textMuted: '#9ca3af',
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      userBubble: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
      assistantBubble: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)'
    }
  },
  blue: {
    name: '蓝色',
    icon: '💙',
    colors: {
      bg: '#0f172a',
      bgSecondary: '#1e293b',
      bgTertiary: '#334155',
      border: '#475569',
      text: '#f1f5f9',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
      primary: '#38bdf8',
      primaryHover: '#0ea5e9',
      success: '#34d399',
      warning: '#fbbf24',
      error: '#f87171',
      userBubble: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
      assistantBubble: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)'
    }
  },
  purple: {
    name: '紫色',
    icon: '💜',
    colors: {
      bg: '#1a1625',
      bgSecondary: '#231f35',
      bgTertiary: '#2d2745',
      border: '#3f3758',
      text: '#f5f3ff',
      textSecondary: '#c4b5fd',
      textMuted: '#a78bfa',
      primary: '#a78bfa',
      primaryHover: '#8b5cf6',
      success: '#34d399',
      warning: '#fbbf24',
      error: '#f87171',
      userBubble: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
      assistantBubble: 'linear-gradient(135deg, #2d2745 0%, #3f3758 100%)'
    }
  }
}

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => {
    return localStorage.getItem('agent-hub-theme') || 'dark'
  })
  
  const theme = themes[themeName]

  // 应用主题到CSS变量
  useEffect(() => {
    const root = document.documentElement
    const colors = theme.colors
    
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value)
    })
    
    // 应用背景色
    document.body.style.backgroundColor = colors.bg
    document.body.style.color = colors.text
    
    // 保存到localStorage
    localStorage.setItem('agent-hub-theme', themeName)
  }, [themeName, theme])

  const changeTheme = (name) => {
    if (themes[name]) {
      setThemeName(name)
    }
  }

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      themeName, 
      themes, 
      changeTheme 
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export default ThemeProvider
