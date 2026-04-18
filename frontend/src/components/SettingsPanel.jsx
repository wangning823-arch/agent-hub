import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export default function SettingsPanel({ onClose }) {
  const [permissions, setPermissions] = useState({})
  const [loading, setLoading] = useState(true)

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

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="text-white">加载中...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-full max-w-lg mx-4 border border-border max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">权限设置</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {Object.entries(permissions).map(([action, policy]) => {
            // 跳过复杂配置
            if (typeof policy !== 'string') return null

            return (
              <div key={action} className="flex items-center justify-between p-3 bg-background rounded-lg">
                <div>
                  <div className="font-medium">
                    {action === 'file_read' && '读取文件'}
                    {action === 'file_write' && '写入文件'}
                    {action === 'shell_exec' && '执行命令'}
                    {action === 'network' && '网络访问'}
                    {action === 'other' && '其他操作'}
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
                  className="bg-card border border-border rounded px-3 py-1"
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
        </div>

        <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <p className="text-sm text-yellow-200">
            ⚠️ 建议: 对于不熟悉的环境，建议将"执行命令"设置为"询问用户"
          </p>
        </div>
      </div>
    </div>
  )
}