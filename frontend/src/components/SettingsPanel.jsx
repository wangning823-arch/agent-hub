import React, { useState, useEffect } from 'react'
import { useTheme } from './ThemeContext'
import { useNotification } from '../hooks/useNotification'

const API_BASE = '/api'

export default function SettingsPanel({ onClose }) {
  const [permissions, setPermissions] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('theme') // theme | permissions | notifications
  const { theme, themeName, themes, changeTheme } = useTheme()
  const notification = useNotification()

  useEffect(() => {
    fetchPermissions()
  }, [])

  const fetchPermissions = async () => {
    try {
      const res = await fetch(`${API_BASE}/permissions`)
      const data = await res.json()
      setPermissions(data)
    } catch (error) {
      console.error('获取权限配置失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const updatePermission = async (action, policy) => {
    try {
      await fetch(`${API_BASE}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, policy })
      })
      setPermissions(prev => ({ ...prev, [action]: policy }))
    } catch (error) {
      console.error('更新权限失败:', error)
    }
  }

  const policyOptions = [
    { value: 'auto_allow', label: '自动允许', color: 'text-green-400' },
    { value: 'ask_user', label: '询问用户', color: 'text-yellow-400' },
    { value: 'deny', label: '拒绝', color: 'text-red-400' }
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl w-full max-w-lg mx-4 border border-gray-800 max-h-[80vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <h2 className="text-xl font-semibold text-white">设置</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* 标签页 */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setActiveTab('theme')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'theme'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🎨 主题
          </button>
          <button
            onClick={() => setActiveTab('permissions')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'permissions'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🔐 权限
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'notifications'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🔔 通知
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'theme' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-4">选择你喜欢的界面主题</p>
              
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(themes).map(([key, t]) => (
                  <button
                    key={key}
                    onClick={() => changeTheme(key)}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      themeName === key
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{t.icon}</span>
                      <span className="font-medium text-white">{t.name}</span>
                    </div>
                    
                    {/* 预览色块 */}
                    <div className="flex gap-1.5">
                      <div 
                        className="w-6 h-6 rounded-full border border-gray-600"
                        style={{ backgroundColor: t.colors.bg }}
                      />
                      <div 
                        className="w-6 h-6 rounded-full"
                        style={{ backgroundColor: t.colors.primary }}
                      />
                      <div 
                        className="w-6 h-6 rounded-full"
                        style={{ backgroundColor: t.colors.success }}
                      />
                      <div 
                        className="w-6 h-6 rounded-full"
                        style={{ backgroundColor: t.colors.warning }}
                      />
                    </div>
                    
                    {themeName === key && (
                      <div className="mt-2 text-xs text-blue-400">
                        ✓ 当前使用
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'permissions' && (
            <>
              {loading ? (
                <div className="text-center text-gray-400 py-8">加载中...</div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(permissions).map(([action, policy]) => {
                    // 跳过复杂配置
                    if (typeof policy !== 'string') return null

                    return (
                      <div key={action} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                        <div>
                          <div className="font-medium text-white">
                            {action === 'file_read' && '📄 读取文件'}
                            {action === 'file_write' && '✏️ 写入文件'}
                            {action === 'shell_exec' && '⚡ 执行命令'}
                            {action === 'network' && '🌐 网络访问'}
                            {action === 'other' && '📦 其他操作'}
                          </div>
                          <div className="text-sm text-gray-500">
                            {action === 'file_read' && 'Agent读取项目文件'}
                            {action === 'file_write' && 'Agent创建或修改文件'}
                            {action === 'shell_exec' && 'Agent执行shell命令'}
                            {action === 'network' && 'Agent访问网络资源'}
                            {action === 'other' && '其他未分类操作'}
                          </div>
                        </div>
                        <select
                          value={policy}
                          onChange={(e) => updatePermission(action, e.target.value)}
                          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
                        >
                          {policyOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}

                  <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
                    <p className="text-sm text-yellow-200">
                      ⚠️ 建议: 对于不熟悉的环境，建议将"执行命令"设置为"询问用户"
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-4">配置桌面通知</p>
              
              <div className="p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-medium text-white">📱 桌面通知</div>
                    <div className="text-sm text-gray-500">Agent回复时发送桌面通知</div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs ${
                    Notification.permission === 'granted' 
                      ? 'bg-green-900/50 text-green-400'
                      : Notification.permission === 'denied'
                      ? 'bg-red-900/50 text-red-400'
                      : 'bg-yellow-900/50 text-yellow-400'
                  }`}>
                    {Notification.permission === 'granted' ? '已开启' :
                     Notification.permission === 'denied' ? '已拒绝' : '未开启'}
                  </div>
                </div>
                
                {Notification.permission !== 'granted' && (
                  <button
                    onClick={async () => {
                      const granted = await notification.requestPermission()
                      if (granted) {
                        notification.sendNotification('通知已开启', {
                          body: '现在你将收到Agent回复的桌面通知'
                        })
                      }
                    }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    开启通知权限
                  </button>
                )}
                
                {Notification.permission === 'granted' && (
                  <button
                    onClick={() => notification.sendNotification('测试通知', {
                      body: '如果你看到这条消息，说明通知功能正常'
                    })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    发送测试通知
                  </button>
                )}
              </div>

              <div className="p-4 bg-gray-800/50 rounded-lg">
                <div className="text-sm text-gray-400 space-y-2">
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
                <div className="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
                  <p className="text-sm text-red-300">
                    ⚠️ 通知权限已被拒绝。请在浏览器设置中手动开启：
                    <br />
                    点击地址栏左侧的锁图标 → 网站设置 → 通知 → 允许
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
