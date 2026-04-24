import { describe, test, expect, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import ChatPanel from '../components/ChatPanel'

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: () => {},
    scrollToIndex: () => {}
  })
}))

jest.mock('../components/Toast', () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn()
  })
}))

jest.mock('../hooks/useNotification', () => ({
  useNotification: () => ({
    notifyAgentReply: jest.fn(),
    notifyError: jest.fn()
  })
}))

jest.mock('../config', () => ({
  API_BASE: 'http://localhost:3001/api',
  getWebSocketUrl: () => 'ws://localhost:3001/ws'
}))

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ modes: [], models: [], efforts: [] }),
    ok: true
  })
)

global.WebSocket = jest.fn(() => ({
  send: jest.fn(),
  close: jest.fn(),
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
  readyState: 1
}))

describe('ChatPanel', () => {
  const mockProps = {
    sessionId: 'test-session-id',
    agentType: 'claude-code',
    onWorkingChange: jest.fn(),
    onStartingChange: jest.fn(),
    isWorking: false,
    isStarting: false
  }

  test('renders correctly with basic props', () => {
    render(<ChatPanel {...mockProps} />)
    
    expect(screen.getByText('开始对话吧')).toBeInTheDocument()
    expect(screen.getByText('输入消息与 Agent 交互')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument()
    
    expect(screen.getByTitle('发送')).toBeInTheDocument()
    expect(screen.getByTitle('上传文件')).toBeInTheDocument()
  })

  test('disables input when isWorking is true', () => {
    render(<ChatPanel {...mockProps} isWorking={true} />)
    
    const input = screen.getByPlaceholderText('任务进行中，请等待完成...')
    expect(input).toBeDisabled()
  })

  test('disables input when isStarting is true', () => {
    render(<ChatPanel {...mockProps} isStarting={true} />)
    
    const input = screen.getByPlaceholderText('Agent启动中，请稍候...')
    expect(input).toBeDisabled()
  })
})
