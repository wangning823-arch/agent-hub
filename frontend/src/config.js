// API 和 WebSocket 配置
export const API_BASE = '/api'

export function getWebSocketUrl(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host  // host 包含端口号（本地:3001），域名无端口时就是纯域名
  return `${protocol}//${host}?session=${sessionId}`
}

