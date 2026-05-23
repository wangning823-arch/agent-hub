import React, { useState } from 'react'

interface ScheduleModalProps {
  workflowName: string
  onConfirm: (scheduledAt: number) => void
  onCancel: () => void
}

const QUICK_OPTIONS = [
  { label: '1 分钟', minutes: 1 },
  { label: '5 分钟', minutes: 5 },
  { label: '10 分钟', minutes: 10 },
  { label: '30 分钟', minutes: 30 },
]

export default function ScheduleModal({ workflowName, onConfirm, onCancel }: ScheduleModalProps) {
  const toLocalDatetime = (date: Date): string => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d}T${h}:${min}`
  }

  const getDefaultDateTime = (): string => {
    const now = new Date()
    now.setMinutes(now.getMinutes() + 1)
    now.setSeconds(0)
    now.setMilliseconds(0)
    return toLocalDatetime(now)
  }

  const [dateTime, setDateTime] = useState(getDefaultDateTime)

  const handleQuickSelect = (minutes: number) => {
    const target = new Date()
    target.setMinutes(target.getMinutes() + minutes)
    target.setSeconds(0)
    target.setMilliseconds(0)
    setDateTime(toLocalDatetime(target))
  }

  const handleConfirm = () => {
    const scheduledAt = new Date(dateTime).getTime()
    if (isNaN(scheduledAt) || scheduledAt <= Date.now()) return
    onConfirm(scheduledAt)
  }

  const scheduledAt = new Date(dateTime).getTime()
  const isValid = !isNaN(scheduledAt) && scheduledAt > Date.now()

  const formatDisplayTime = (dt: string): string => {
    const d = new Date(dt)
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-content" style={{ maxWidth: 400 }} onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>定时执行</h2>
          <button onClick={onCancel} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            工作流: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{workflowName}</span>
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>快捷选择</label>
            <div className="flex gap-2">
              {QUICK_OPTIONS.map(opt => (
                <button
                  key={opt.minutes}
                  onClick={() => handleQuickSelect(opt.minutes)}
                  className="flex-1 px-2 py-1.5 rounded text-xs hover:opacity-80"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>自定义时间</label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={e => setDateTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
            />
          </div>

          {isValid && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
              将在 {formatDisplayTime(dateTime)} 自动执行
            </div>
          )}
        </div>

        <div className="modal-footer flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--accent-primary)', color: 'white' }}
          >
            确认定时
          </button>
        </div>
      </div>
    </div>
  )
}
