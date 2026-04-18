import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'

const API_BASE = '/api'

export default function ControlPanel({ sessionId, currentOptions, onUpdateOptions, onClose }) {
  const [options, setOptions] = useState({
    modes: [],
    models: [],
    efforts: []
  })
  const [selected, setSelected] = useState({
    mode: currentOptions?.mode || 'auto',
    model: currentOptions?.model || '',
    effort: currentOptions?.effort || 'medium'
  })
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  // 加载选项
  useEffect(() => {
    loadOptions()
  }, [])

  const loadOptions = async () => {
    try {
      const data = await fetch(`${API_BASE}/options`).then(r => r.json())
      setOptions(data)
    } catch (error) {
      console.error('加载选项失败:', error)
    }
  }

  const handleUpdate = async () => {
    setLoading(true)
    try {
      // 通过WebSocket发送命令
      const ws = new WebSocket(`ws://${window.location.hostname}:3001?session=${sessionId}`)
      
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'command',
          command: 'update_options',
          params: selected
        }))
        setTimeout(() => {
          ws.close()
          onUpdateOptions(selected)
          setLoading(false)
          onClose()
        }, 500)
      }

      ws.onerror = () => {
        setLoading(false)
        toast.error('更新失败')
      }
    } catch (error) {
      setLoading(false)
      toast.error('更新失败: ' + error.message)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-full max-w-md overflow-hidden shadow-2xl border border-gray-700">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">⚙️ 会话控制</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 space-y-4">
          {/* 权限模式 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              🛡️ 权限模式
            </label>
            <div className="grid grid-cols-2 gap-2">
              {options.modes.map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setSelected(prev => ({ ...prev, mode: mode.id }))}
                  className={`p-2 rounded text-left text-sm ${
                    selected.mode === mode.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="font-medium">{mode.name}</div>
                  <div className={`text-xs ${selected.mode === mode.id ? 'text-blue-200' : 'text-gray-500'}`}>
                    {mode.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 模型选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              🧠 模型
            </label>
            <select
              value={selected.model}
              onChange={(e) => setSelected(prev => ({ ...prev, model: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white"
            >
              <option value="">使用默认模型</option>
              {options.models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
          </div>

          {/* 努力程度 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              💪 努力程度
            </label>
            <div className="flex gap-2">
              {options.efforts.map(effort => (
                <button
                  key={effort.id}
                  onClick={() => setSelected(prev => ({ ...prev, effort: effort.id }))}
                  className={`flex-1 p-2 rounded text-center text-sm ${
                    selected.effort === effort.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="font-medium">{effort.name}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white"
          >
            取消
          </button>
          <button
            onClick={handleUpdate}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '更新中...' : '应用'}
          </button>
        </div>
      </div>
    </div>
  )
}
