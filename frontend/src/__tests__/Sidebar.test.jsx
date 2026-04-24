import { describe, test, expect, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import Sidebar from '../components/Sidebar'

jest.mock('../components/Toast', () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn()
  })
}))

jest.mock('../config', () => ({
  API_BASE: 'http://localhost:3001/api',
  getWebSocketUrl: () => 'ws://localhost:3001/ws'
}))

global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({ tags: [], skills: [] }),
    ok: true
  })
)

describe('Sidebar', () => {
  const mockSessions = [
    {
      id: 'session-1',
      workdir: '/test/project-1',
      agentType: 'claude-code',
      title: 'Test Session 1',
      isActive: true,
      isWorking: false,
      isPinned: false,
      isArchived: false,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'session-2',
      workdir: '/test/project-2',
      agentType: 'opencode',
      title: 'Test Session 2',
      isActive: false,
      isWorking: true,
      isPinned: true,
      isArchived: false,
      tags: ['work', 'important'],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]

  const mockProps = {
    sessions: mockSessions,
    activeSession: 'session-1',
    agentType: 'claude-code',
    sessionOptions: {},
    onSelectSession: jest.fn(),
    onCloseSession: jest.fn(),
    onResumeSession: jest.fn(),
    onNewSession: jest.fn(),
    onOpenProject: jest.fn(),
    onUpdateOptions: jest.fn(),
    onRenameSession: jest.fn(),
    onPinSession: jest.fn(),
    onArchiveSession: jest.fn(),
    onUpdateTags: jest.fn()
  }

  test('renders correctly with session list', () => {
    render(<Sidebar {...mockProps} />)
    
    expect(screen.getByText('Agent Hub')).toBeInTheDocument()
    expect(screen.getByText('📁 项目管理')).toBeInTheDocument()
    expect(screen.getByText(/会话列表/i)).toBeInTheDocument()
    
    expect(screen.getByText('Test Session 1')).toBeInTheDocument()
    expect(screen.getByText('Test Session 2')).toBeInTheDocument()
    expect(screen.getByText('新建会话')).toBeInTheDocument()
  })

  test('shows correct agent labels for sessions', () => {
    render(<Sidebar {...mockProps} />)
    
    expect(screen.getByText('CC')).toBeInTheDocument()
    expect(screen.getByText('OC')).toBeInTheDocument()
  })

  test('displays tags for sessions that have them', () => {
    render(<Sidebar {...mockProps} />)
    
    expect(screen.getByText('work')).toBeInTheDocument()
    expect(screen.getByText('important')).toBeInTheDocument()
  })

  test('shows pinned icon for pinned sessions', () => {
    render(<Sidebar {...mockProps} />)
    
    expect(screen.getByText('📌')).toBeInTheDocument()
  })
})
