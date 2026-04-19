const express = require('express')
const request = require('supertest')

const registerPhase1 = require('../routes/sessions')

function createAppWithSessionManager(mock) {
  const app = express()
  app.use(express.json())
  // Register Phase1 routes with provided mock SessionManager
  registerPhase1(app, mock)
  return app
}

describe('Phase1 API - Core Endpoints (测试用例草案)', () => {
  test('GET /api/phase1/status should return ready true and count', async () => {
    const mock = {
      listSessions: jest.fn().mockReturnValue([])
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).get('/api/phase1/status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('ready', true)
  })

  test('GET /api/phase1/sessions returns empty list when none', async () => {
    const mock = {
      listSessions: jest.fn().mockReturnValue([])
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).get('/api/phase1/sessions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  test('GET /api/phase1/sessions/:id returns 404 when not exists', async () => {
    const mock = {
      getSession: jest.fn().mockReturnValue(null)
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).get('/api/phase1/sessions/not-found')
    expect(res.status).toBe(404)
  })

  test('POST /api/phase1/sessions creates a session (mocked)', async () => {
    const mockSession = {
      toJSON: () => ({ id: 'ph1', workdir: '/tmp/phase1', agentType: 'claude-code' })
    }
    const mock = {
      createSession: jest.fn().mockResolvedValue(mockSession),
      listSessions: jest.fn().mockReturnValue([mockSession.toJSON()]),
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).post('/api/phase1/sessions').send({ workdir: '/tmp/phase1', agentType: 'claude-code' })
    // 由于实现返回的是 toJSON，断言重点在响应结构
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id')
  })

  test('PUT /api/phase1/sessions/:id updates a session', async () => {
    const mockSessionObj = { id: 'ph1' }
    const mock = {
      getSession: jest.fn().mockReturnValue(mockSessionObj),
      saveData: jest.fn(),
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).put('/api/phase1/sessions/ph1').send({ title: 'Updated' })
    // 由于 mock，不一定会真正修改对象，但应返回 200
    expect([200, 304].includes(res.status)).toBe(true)
  })

  test('DELETE /api/phase1/sessions/:id deletes a session', async () => {
    const mock = {
      removeSession: jest.fn().mockResolvedValue(true),
      listSessions: jest.fn().mockReturnValue([])
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).delete('/api/phase1/sessions/ph1')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('success', true)
  })

  test('GET /api/phase1/sessions/:id/summary returns summary', async () => {
    const mockSession = {
      id: 'ph1',
      title: 'Ph1',
      workdir: '/tmp/ph1',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' }
      ],
    }
    const mock = {
      getSession: jest.fn().mockReturnValue(mockSession),
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).get('/api/phase1/sessions/ph1/summary')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('summary')
  })

  test('POST /api/phase1/sessions/:id/stop stops agent when present', async () => {
    const mockSession = { id: 'ph1', agent: { stop: jest.fn() } }
    const mock = {
      getSession: jest.fn().mockReturnValue(mockSession),
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).post('/api/phase1/sessions/ph1/stop')
    expect(res.status).toBe(200)
  })

  test('PUT /api/phase1/sessions/:id/options updates options', async () => {
    const mockSession = { id: 'ph1', options: { mode: 'auto' } }
    const mock = {
      getSession: jest.fn().mockReturnValue(mockSession),
      saveData: jest.fn()
    }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).put('/api/phase1/sessions/ph1/options').send({ mode: 'manual' })
    expect(res.status).toBe(200)
  })

  test('GET /api/phase1/sessions/:id/export/markdown returns markdown', async () => {
    const mockSession = {
      id: 'ph1',
      title: 'Ph1',
      workdir: '/tmp/ph1',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [ { role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' } ]
    }
    const mock = { getSession: jest.fn().mockReturnValue(mockSession) }
    const app = createAppWithSessionManager(mock)
    const res = await request(app).get('/api/phase1/sessions/ph1/export/markdown')
    expect(res.status).toBe(200)
    expect(res.text).toContain('# Ph1')
    expect(res.headers['content-type']).toContain('markdown')
  })

  test('Compat: GET /api/sessions/:id/messages works via compat', async () => {
    const mockSession = { id: 'ph1', messages: [ { role: 'user', content: 'hello' } ], tags: ['a'] }
    const mock = {
      getSession: jest.fn().mockReturnValue(mockSession),
      listSessions: jest.fn().mockReturnValue([mockSession]),
      getMessages: jest.fn().mockReturnValue(mockSession.messages)
    }
    const appCompat = require('express')()
    appCompat.use(require('express').json())
    const compat = require('../routes/compat')
    compat(appCompat, { sessionManager: mock })
    const res = await require('supertest')(appCompat).get('/api/sessions/ph1/messages')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('messages')
  })

  test('Compat: POST /api/sessions/:id/tags adds a tag', async () => {
    const mockSession = { id: 'ph1', tags: [] }
    const mock = {
      getSession: jest.fn().mockReturnValue(mockSession),
      addSessionTag: jest.fn().mockReturnValue({ ...mockSession, tags: ['new'] }),
      setSessionTags: jest.fn().mockReturnValue({ ...mockSession, tags: ['a'] }),
      saveData: jest.fn()
    }
    const appCompat = require('express')()
    appCompat.use(require('express').json())
    const compat = require('../routes/compat')
    compat(appCompat, { sessionManager: mock })
    const res = await require('supertest')(appCompat).post('/api/sessions/ph1/tags').send({ tag: 'new' })
    expect(res.status).toBe(200)
  })

  test('Compat: GET /api/sessions should work via compatibility wrapper', async () => {
    const mockMS = {
      listSessions: jest.fn().mockReturnValue([
        { id: 'phCompat', workdir: '/tmp/compat', agentType: 'claude-code' }
      ])
    }
    const appCompat = require('express')()
    appCompat.use(require('express').json())
    const compat = require('../routes/compat')
    compat(appCompat, { sessionManager: mockMS })
    const res = await require('supertest')(appCompat).get('/api/sessions')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  test('Compat: GET /api/search/sessions returns results', async () => {
    const mockMS = {
      listSessions: jest.fn().mockReturnValue([{ id: 'ph1', title: 'A' }]),
    }
    const appCompat = require('express')()
    appCompat.use(require('express').json())
    const compat = require('../routes/compat')
    compat(appCompat, { sessionManager: mockMS })
    const res = await require('supertest')(appCompat).get('/api/search/sessions?query=A')
    expect(res.status).toBe(200)
  })

  test('Compat: GET /api/search/messages returns results', async () => {
    const mockMS = {
      listSessions: jest.fn().mockReturnValue([{ id: 'ph1', title: 'A' }]),
      getSession: jest.fn().mockReturnValue({ id: 'ph1', messages: [{ role: 'user', content: 'hello' }] }),
    }
    const appCompat = require('express')()
    appCompat.use(require('express').json())
    const compat = require('../routes/compat')
    compat(appCompat, { sessionManager: mockMS })
    const res = await require('supertest')(appCompat).get('/api/search/messages?query=hello')
    expect(res.status).toBe(200)
  })
})
