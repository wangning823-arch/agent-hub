import { useRef } from 'react'

interface NotificationOptions {
  body?: string
  tag?: string
  requireInteraction?: boolean
  icon?: string
  badge?: string
  [key: string]: unknown
}

interface UseNotificationReturn {
  permission: NotificationPermission
  requestPermission: () => Promise<boolean>
  sendNotification: (title: string, options?: NotificationOptions) => Notification | undefined
  notifyAgentReply: (sessionTitle: string, message: string) => void
  notifyError: (error: string) => void
  notifyComplete: (task: string) => void
}

export function useNotification(): UseNotificationReturn {
  const hasNotification: boolean = typeof Notification !== 'undefined' && 'Notification' in window
  const permissionRef = useRef<NotificationPermission>(hasNotification ? Notification.permission : 'denied')

  // 请求通知权限
  const requestPermission = async (): Promise<boolean> => {
    if (!hasNotification) {
      console.log('此浏览器不支持通知')
      return false
    }

    if (Notification.permission === 'granted') {
      return true
    }

    if (Notification.permission !== 'denied') {
      const permission: NotificationPermission = await Notification.requestPermission()
      permissionRef.current = permission
      return permission === 'granted'
    }

    return false
  }

  // 发送通知
  const sendNotification = (title: string, options: NotificationOptions = {}): Notification | undefined => {
    if (!hasNotification) return undefined
    if (Notification.permission !== 'granted') return undefined

    const notification = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options
    })

    // 点击通知时聚焦窗口
    notification.onclick = () => {
      window.focus()
      notification.close()
    }

    // 5秒后自动关闭
    setTimeout(() => notification.close(), 5000)

    return notification
  }

  // Agent回复通知
  const notifyAgentReply = (sessionTitle: string, message: string): void => {
    const truncatedMessage: string = message.length > 100
      ? message.slice(0, 100) + '...'
      : message

    sendNotification(`💬 ${sessionTitle}`, {
      body: truncatedMessage,
      tag: 'agent-reply',
      requireInteraction: false
    })
  }

  // 错误通知
  const notifyError = (error: string): void => {
    sendNotification('❌ 发生错误', {
      body: error,
      tag: 'error',
      requireInteraction: true
    })
  }

  // 完成任务通知
  const notifyComplete = (task: string): void => {
    sendNotification('✅ 任务完成', {
      body: task,
      tag: 'complete'
    })
  }

  return {
    permission: permissionRef.current,
    requestPermission,
    sendNotification,
    notifyAgentReply,
    notifyError,
    notifyComplete
  }
}

export default useNotification
