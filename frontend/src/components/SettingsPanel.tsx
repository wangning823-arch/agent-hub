import React, { useState, useEffect } from 'react'
import { useTheme, ThemeConfig } from './ThemeContext'
import { useNotification } from '../hooks/useNotification'
import UserCredentialView from './UserCredentialView'
import UserModelView from './UserModelView'
import DesignSpecPanel from './DesignSpecPanel'

const API_BASE = '/api'

// ---- Type Definitions ----

interface SettingsPanelProps {
  onClose: () => void
}

interface PolicyOption {
  value: string
  label: string
  color: string
}

interface ThemePreviewProps {
  t: ThemeConfig
  isSelected: boolean
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [permissions, setPermissions] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('theme')
  const { theme, themeName, themes, changeTheme } = useTheme()
  const notification = useNotification()

  useEffect(() => { fetchPermissions() }, [])

  const fetchPermissions = async () => {
    try {
      const res = await fetch(`${API_BASE}/permissions`)
      const data = await res.json()
      setPermissions(data)
    } catch (error) { console.error('获取权限配置失败:', error) }
    finally { setLoading(false) }
  }

  const updatePermission = async (action: string, policy: string) => {
    try {
      await fetch(`${API_BASE}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, policy })
      })
      setPermissions(prev => ({ ...prev, [action]: policy }))
    } catch (error) { console.error('更新权限失败:', error) }
  }

  const policyOptions: PolicyOption[] = [
    { value: 'auto_allow', label: '自动允许', color: 'var(--success)' },
    { value: 'ask_user', label: '询问用户', color: 'var(--warning)' },
    { value: 'deny', label: '拒绝', color: 'var(--error)' }
  ]

  // Theme preview mini-layout
  const ThemePreview: React.FC<ThemePreviewProps> = ({ t, isSelected }) => (
    <div className="rounded-xl overflow-hidden border-2 transition-all cursor-pointer"
      style={{
        borderColor: isSelected ? t.colors['--accent-primary'] : 'var(--border-primary)',
        boxShadow: isSelected ? `0 0 20px ${t.colors['--accent-primary-soft']}` : 'none',
        transform: isSelected ? 'scale(1.02)' : 'scale(1)',
      }}>
      {/* Mini header */}
      <div className="h-8 flex items-center px-3 gap-1.5"
        style={{ background: t.colors['--bg-secondary'], borderBottom: `1px solid ${t.colors['--border-subtle']}` }}>
        <div className="w-2 h-2 rounded-full" style={{ background: t.colors['--error'] }} />
        <div className="w-2 h-2 rounded-full" style={{ background: t.colors['--warning'] }} />
        <div className="w-2 h-2 rounded-full" style={{ background: t.colors['--success'] }} />
        <div className="ml-auto w-12 h-1.5 rounded" style={{ background: t.colors['--bg-hover'] }} />
      </div>
      {/* Mini content */}
      <div className="flex h-20">
        <div className="w-1/4 p-1.5" style={{ background: t.colors['--bg-primary'], borderRight: `1px solid ${t.colors['--border-subtle']}` }}>
          <div className="h-1.5 rounded mb-1" style={{ background: t.colors['--accent-primary-soft'] }} />
          <div className="h-1 rounded mb-1" style={{ background: t.colors['--bg-hover'] }} />
          <div className="h-1 rounded" style={{ background: t.colors['--bg-hover'] }} />
        </div>
        <div className="flex-1 p-1.5 flex flex-col justify-end" style={{ background: t.colors['--bg-primary'] }}>
          <div className="h-3 rounded mb-1 ml-auto w-2/3" style={{ background: t.colors['--accent-primary-soft'] }} />
          <div className="h-4 rounded flex" style={{ background: t.colors['--bg-tertiary'], border: `1px solid ${t.colors['--border-subtle']}` }}>
            <div className="flex-1" />
            <div className="w-8 m-0.5 rounded" style={{ background: t.colors['--accent-primary'] }} />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-content" style={{ maxWidth: '48rem' }} onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h2>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          {[
            { key: 'theme', icon: '🎨', label: '主题' },
            { key: 'credentials', icon: '🔑', label: '凭证' },
            { key: 'models', icon: '🤖', label: '模型' },
            { key: 'permissions', icon: '🔐', label: '权限' },
            { key: 'notifications', icon: '🔔', label: '通知' },
            { key: 'design-spec', icon: '🎯', label: '设计规范' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="modal-body">
          {activeTab === 'theme' && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>选择你喜欢的界面主题</p>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(themes).map(([key, t]) => (
                  <button key={key} onClick={() => changeTheme(key)} className="text-left">
                    <ThemePreview t={t} isSelected={themeName === key} />
                    <div className="flex items-center gap-2 mt-2.5 px-1">
                      <span className="text-lg">{t.icon}</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                      {themeName === key && (
                        <span className="ml-auto text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>✓ 当前</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'credentials' && <UserCredentialView />}

          {activeTab === 'models' && <UserModelView />}

          {activeTab === 'design-spec' && <DesignSpecPanel />}

          {activeTab === 'permissions' && (
            <>
              {loading ? (
                <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>加载中...</div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(permissions).map(([action, policy]) => {
                    if (typeof policy !== 'string') return null
                    return (
                      <div key={action} className="card flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {action === 'file_read' && '📄 读取文件'}
                            {action === 'file_write' && '✏️ 写入文件'}
                            {action === 'shell_exec' && '⚡ 执行命令'}
                            {action === 'network' && '🌐 网络访问'}
                            {action === 'other' && '📦 其他操作'}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {action === 'file_read' && 'Agent读取项目文件'}
                            {action === 'file_write' && 'Agent创建或修改文件'}
                            {action === 'shell_exec' && 'Agent执行shell命令'}
                            {action === 'network' && 'Agent访问网络资源'}
                            {action === 'other' && '其他未分类操作'}
                          </div>
                        </div>
                        <select
                          value={policy}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updatePermission(action, e.target.value)}
                          className="select-field"
                        >
                          {policyOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                  <div className="card" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning)' }}>
                    <p className="text-sm" style={{ color: 'var(--warning)' }}>
                      ⚠️ 建议: 对于不熟悉的环境，建议将"执行命令"设置为"询问用户"
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>配置桌面通知</p>
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>📱 桌面通知</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Agent回复时发送桌面通知</div>
                  </div>
                  <span className="badge" style={{
                    background: Notification.permission === 'granted' ? 'var(--success-soft)' :
                      Notification.permission === 'denied' ? 'var(--error-soft)' : 'var(--warning-soft)',
                    color: Notification.permission === 'granted' ? 'var(--success)' :
                      Notification.permission === 'denied' ? 'var(--error)' : 'var(--warning)',
                  }}>
                    {Notification.permission === 'granted' ? '已开启' :
                      Notification.permission === 'denied' ? '已拒绝' : '未开启'}
                  </span>
                </div>
                {Notification.permission !== 'granted' && (
                  <button onClick={async () => {
                    const granted = await notification.requestPermission()
                    if (granted) notification.sendNotification('通知已开启', { body: '现在你将收到Agent回复的桌面通知' })
                  }} className="btn-primary w-full py-2 text-sm">
                    开启通知权限
                  </button>
                )}
                {Notification.permission === 'granted' && (
                  <button onClick={() => notification.sendNotification('测试通知', { body: '如果你看到这条消息，说明通知功能正常' })}
                    className="btn-secondary w-full py-2 text-sm">
                    发送测试通知
                  </button>
                )}
              </div>
              <div className="card">
                <div className="text-xs space-y-2" style={{ color: 'var(--text-secondary)' }}>
                  <p>💡 <strong>通知规则:</strong></p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>仅在页面处于后台时发送通知</li>
                    <li>Agent回复时会显示消息预览</li>
                    <li>错误消息会特别标记</li>
                    <li>点击通知会自动聚焦窗口</li>
                  </ul>
                </div>
              </div>
              {Notification.permission === 'denied' && (
                <div className="card" style={{ background: 'var(--error-soft)', borderColor: 'var(--error)' }}>
                  <p className="text-sm" style={{ color: 'var(--error)' }}>
                    ⚠️ 通知权限已被拒绝。请在浏览器设置中手动开启：
                    <br />点击地址栏左侧的锁图标 → 网站设置 → 通知 → 允许
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
