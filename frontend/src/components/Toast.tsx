import React, { useState, createContext, useContext } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  success: (message: string, duration?: number) => number
  error: (message: string, duration?: number) => number
  warning: (message: string, duration?: number) => number
  info: (message: string, duration?: number) => number
  addToast: (message: string, type?: ToastType, duration?: number) => number
  removeToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = (message: string, type: ToastType = 'info', duration: number = 3000): number => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
    return id
  }

  const removeToast = (id: number): void => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const success = (message: string, duration?: number): number => addToast(message, 'success', duration)
  const error = (message: string, duration?: number): number => addToast(message, 'error', duration)
  const warning = (message: string, duration?: number): number => addToast(message, 'warning', duration)
  const info = (message: string, duration?: number): number => addToast(message, 'info', duration)

  return (
    <ToastContext.Provider value={{ success, error, warning, info, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

interface ToastContainerProps {
  toasts: ToastItem[]
  onRemove: (id: number) => void
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

interface ToastProps {
  toast: ToastItem
  onRemove: (id: number) => void
}

function Toast({ toast, onRemove }: ToastProps) {
  const [isExiting, setIsExiting] = useState<boolean>(false)

  const handleRemove = (): void => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 200)
  }

  const typeConfig: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
    success: { bg: 'var(--success-soft)', border: 'var(--success)', color: 'var(--success)', icon: '✅' },
    error: { bg: 'var(--error-soft)', border: 'var(--error)', color: 'var(--error)', icon: '❌' },
    warning: { bg: 'var(--warning-soft)', border: 'var(--warning)', color: 'var(--warning)', icon: '⚠️' },
    info: { bg: 'var(--accent-primary-soft)', border: 'var(--accent-primary)', color: 'var(--accent-primary)', icon: 'ℹ️' },
  }

  const cfg = typeConfig[toast.type] || typeConfig.info

  return (
    <div
      className={`toast ${isExiting ? 'translate-x-full opacity-0' : ''}`}
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
        transform: isExiting ? 'translateX(40px)' : 'translateX(0)',
        opacity: isExiting ? 0 : 1,
        transition: 'all 0.2s ease',
      }}
    >
      <span className="text-base">{cfg.icon}</span>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button onClick={handleRemove} className="opacity-60 hover:opacity-100 transition-opacity text-sm">✕</button>
    </div>
  )
}

export default Toast
