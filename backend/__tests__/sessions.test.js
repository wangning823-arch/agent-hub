const { describe, test, expect } = require('@jest/globals');
const request = require('supertest');
const express = require('express');
const sessionsRouter = require('../routes/sessions');

describe('POST /api/sessions', () => {
  const mockSession = {
    id: 'test-session-id',
    workdir: '/test/workdir',
    agentType: 'claude-code',
    agentName: 'Claude Code',
    messageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: false,
    isWorking: false,
    isStarting: false,
    conversationId: null,
    lastMessageAt: new Date(),
    title: null,
    isPinned: false,
    isArchived: false,
    tags: [],
    toJSON: function() { return this; }
  };

  const mockSessionManager = {
    createSession: jest.fn(() => Promise.resolve(mockSession))
  };

  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter(mockSessionManager));

  test('should create session with valid workdir', async () => {
    const response = await request(app)
      .post('/api/sessions')
      .send({ workdir: '/test/workdir' });

    expect(response.statusCode).toBe(200);
    expect(response.body.id).toBe('test-session-id');
    expect(response.body.workdir).toBe('/test/workdir');
    expect(mockSessionManager.createSession).toHaveBeenCalledWith('/test/workdir', 'claude-code', {});
  });

  test('should create session with specified agent type', async () => {
    const response = await request(app)
      .post('/api/sessions')
      .send({ workdir: '/test/workdir', agentType: 'opencode' });

    expect(response.statusCode).toBe(200);
    expect(mockSessionManager.createSession).toHaveBeenCalledWith('/test/workdir', 'opencode', {});
  });

  test('should return 400 error when workdir is missing', async () => {
    const response = await request(app)
      .post('/api/sessions')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('workdir是必需的');
  });

  test('should return 400 error for invalid agent type', async () => {
    const response = await request(app)
      .post('/api/sessions')
      .send({ workdir: '/test/workdir', agentType: 'invalid-agent' });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('不支持的Agent类型: invalid-agent');
  });
});
