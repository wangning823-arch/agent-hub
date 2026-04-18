// API 和 WebSocket 配置
export const API_BASE = '/api'

export function getWebSocketUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const token = localStorage.getItem('access_token') || ''
  const tokenParam = token ? `&token=${token}` : ''
  return `${protocol}//${host}?session=${sessionId}${tokenParam}`
}

