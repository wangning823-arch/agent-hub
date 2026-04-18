import React, { useState, useEffect, createContext, useContext } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = (message, type = 'info', duration = 3000) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
    return id
  }

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const success = (message, duration) => addToast(message, 'success', duration)
  const error = (message, duration) => addToast(message, 'error', duration)
  const warning = (message, duration) => addToast(message, 'warning', duration)
  const info = (message, duration) => addToast(message, 'info', duration)

  return (
    <ToastContext.Provider value={{ success, error, warning, info, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  )
}

function Toast({ toast, onRemove }) {
  const [isExiting, setIsExiting] = useState(false)

  const handleRemove = () => {
    setIsExiting(true)
    setTimeout(() => onRemove(toast.id), 200)
  }

  const typeConfig = {
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
