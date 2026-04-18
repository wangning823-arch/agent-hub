// API 和 WebSocket 配置
export const API_BASE = '/api'

export function getWebSocketUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.hostname
  const port = window.location.port || '3001'
  return `${protocol}//${host}:${port}?session=${sessionId}`
}
