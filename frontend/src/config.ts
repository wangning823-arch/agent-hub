// API 和 WebSocket 配置
export const API_BASE: string = '/api'

export function getWebSocketUrl(sessionId: string): string {
  const protocol: string = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host: string = window.location.host
  const token: string = localStorage.getItem('access_token') || ''
  const tokenParam: string = token ? `&token=${token}` : ''
  return `${protocol}//${host}?session=${sessionId}${tokenParam}`
}
