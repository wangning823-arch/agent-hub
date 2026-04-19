const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const Session = require('./models/session');
const { createAgent, resumeAgentMessages } = require('./agents/factory');
const WSClients = require('./ws-clients');

class SessionManager {
  constructor(tokenTracker = null) {
    this.sessions = new Map();
    this.wsClients = new WSClients();
    this.sessionsFile = path.join(__dirname, '..', 'data', 'sessions.json');
    this.tokenTracker = tokenTracker;
    this.loadData();
  }

  loadData() {
    try {
      const dataDir = path.dirname(this.sessionsFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
        for (const sessionData of data) {
          const session = {
            id: sessionData.id,
            workdir: sessionData.workdir,
            agentType: sessionData.agentType,
            agentName: sessionData.agentName,
            messages: sessionData.messages || [],
            createdAt: new Date(sessionData.createdAt),
            updatedAt: sessionData.updatedAt ? new Date(sessionData.updatedAt) : new Date(sessionData.createdAt),
            options: sessionData.options || {},
            isActive: false,
            conversationId: sessionData.conversationId || null,
            title: sessionData.title || null,
            isPinned: sessionData.isPinned || false,
            isArchived: sessionData.isArchived || false,
            toJSON: function() {
              return {
                id: this.id,
                agentType: this.agentType || 'claude-code',
                agentName: this.agentName || 'unknown',
                workdir: this.workdir,
                messageCount: this.messages.length,
                createdAt: this.createdAt,
                updatedAt: this.updatedAt,
                options: this.options,
                isActive: this.isActive,
                conversationId: this.conversationId,
                lastMessageAt: this.messages.length > 0
                  ? this.messages[this.messages.length - 1].time
                  : this.createdAt,
                title: this.title,
                isPinned: this.isPinned,
                isArchived: this.isArchived
              };
            }
          };
          this.sessions.set(session.id, session);
        }
        console.log(`已加载 ${this.sessions.size} 个会话`);
      }
    } catch (error) {
      console.error('加载会话数据失败:', error);
    }
  }

  saveData() {
    try {
      const dataDir = path.dirname(this.sessionsFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const sessionsData = Array.from(this.sessions.values()).map(s => ({
        id: s.id,
        workdir: s.workdir,
        agentType: s.agentType || 'claude-code',
        agentName: s.agent?.name || s.agentName,
        messages: s.messages.slice(-200),
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
        options: s.options || {},
        isActive: s.isActive || false,
        conversationId: s.conversationId || s.agent?.conversationId || null,
        title: s.title || null,
        isPinned: s.isPinned || false,
        isArchived: s.isArchived || false
      }));

      fs.writeFileSync(this.sessionsFile, JSON.stringify(sessionsData, null, 2));
    } catch (error) {
      console.error('保存会话数据失败:', error);
    }
  }

  async createSession(workdir, agentType = 'claude-code', options = {}) {
    const id = uuidv4();
    
    let absoluteWorkdir = workdir;
    if (workdir.startsWith('~/')) {
      absoluteWorkdir = path.join(process.env.HOME || '/root', workdir.slice(2));
    } else if (!workdir.startsWith('/')) {
      absoluteWorkdir = path.resolve(process.env.HOME || '/root', workdir);
    }
    
    if (!fs.existsSync(absoluteWorkdir)) {
      fs.mkdirSync(absoluteWorkdir, { recursive: true });
      console.log(`创建目录: ${absoluteWorkdir}`);
    }
    
    const agent = createAgent(absoluteWorkdir, agentType, options);
    const session = new Session(id, agent, absoluteWorkdir, options);
    session.agentType = agentType;

    agent.on('message', (msg) => this.broadcast(id, msg));
    agent.on('error', (err) => this.broadcast(id, { type: 'error', content: err.toString() }));
    agent.on('stopped', () => this.broadcast(id, { type: 'status', content: 'Agent已停止' }));

    try {
      await agent.start();
    } catch (err) {
      console.error('Agent.start 失败:', err && err.message);
      this.broadcast(id, { type: 'error', content: `Agent启动失败: ${err.message}` });
      return null;
    }

    this.sessions.set(id, session);
    this.saveData();
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map(s => s.toJSON());
  }

  async sendMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    if (!session.agent) {
      await this._resumeAgent(session);
    }

    session.messages.push({ role: 'user', content: message, time: new Date() });
    await session.agent.send(message);
  }

  async resumeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    if (session.isActive) {
      return session;
    }
    await this._resumeAgent(session);
    this.saveData();
    return session;
  }

  async _resumeAgent(session) {
    const agentType = session.agentType || 'claude-code';
    const options = { ...session.options, conversationId: session.conversationId };

    const agent = createAgent(session.workdir, agentType, options);

    if (agentType === 'claude-api') {
      resumeAgentMessages(agent, session.messages);
    }

    agent.on('message', (msg) => this.broadcast(session.id, msg));
    agent.on('error', (err) => this.broadcast(session.id, { type: 'error', content: err.toString() }));
    agent.on('stopped', () => this.broadcast(session.id, { type: 'status', content: 'Agent已停止' }));

    try {
      await agent.start();
    } catch (err) {
      console.error('Agent.start 失败:', err && err.message);
      this.broadcast(session.id, { type: 'error', content: `Agent启动失败: ${err.message}` });
      throw err;
    }
    session.agent = agent;
    session.isActive = true;
    console.log(`会话 ${session.id} agent已恢复`);
  }

  addClient(sessionId, ws) {
    this.wsClients.add(sessionId, ws);
  }

  removeClient(sessionId, ws) {
    this.wsClients.remove(sessionId, ws);
  }

  broadcast(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (session) {
      const metaTypes = ['status', 'token_usage', 'conversation_id', 'title_update'];
      if (!metaTypes.includes(message.type)) {
        session.messages.push({ role: 'assistant', content: message, time: new Date() });
      }
      
      if (message.conversationId) {
        session.conversationId = message.conversationId;
      }
      
      if (message.type === 'token_usage' && message.content && this.tokenTracker) {
        const usage = message.content;
        this.tokenTracker.recordUsage(sessionId, {
          input_tokens: usage.inputTokens || 0,
          output_tokens: usage.outputTokens || 0,
          cache_read_input_tokens: usage.cacheReadTokens || 0,
          cache_creation_input_tokens: usage.cacheWriteTokens || 0,
          cost_usd: usage.cost || 0
        });
      }

      const assistantMessages = session.messages.filter(m => m.role === 'assistant' && m.content && m.content.type !== 'status' && m.content.type !== 'token_usage' && m.content.type !== 'conversation_id');
      if (assistantMessages.length === 1 && !session.title && message.type === 'text') {
        const userMsg = session.messages.find(m => m.role === 'user');
        if (userMsg) {
          const { generateTitle } = require('./claude-service');
          const userContent = typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content);
          const asstContent = typeof message.content === 'string' ? message.content : '';
          generateTitle(userContent, asstContent)
            .then(result => {
              if (!session.title) {
                session.title = result.title;
                session.updatedAt = new Date();
                this.saveData();
                this.broadcast(sessionId, { type: 'title_update', content: result.title });
              }
            })
            .catch(err => console.error('[AutoTitle] 生成失败:', err.message));
        }
      }
      
      if (session.messages.length % 10 === 0) {
        this.saveData();
      }
    }

    this.wsClients.broadcast(sessionId, message);
  }

  async removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.agent) {
        await session.agent.stop();
      }
      this.sessions.delete(sessionId);
      this.wsClients.delete(sessionId);
      this.saveData();
    }
  }

  renameSession(sessionId, title) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.title = title;
    session.updatedAt = new Date();
    this.saveData();
    return session.toJSON();
  }

  togglePinSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.isPinned = !session.isPinned;
    session.updatedAt = new Date();
    this.saveData();
    return session.toJSON();
  }

  toggleArchiveSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.isArchived = !session.isArchived;
    session.updatedAt = new Date();
    this.saveData();
    return session.toJSON();
  }

  getMessages(sessionId, limit = 100, offset = 0) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const messages = session.messages.slice(-(limit + offset), offset > 0 ? -offset : undefined);
    return messages;
  }

  deleteMessage(sessionId, messageIndex) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      throw new Error('消息索引无效');
    }
    session.messages.splice(messageIndex, 1);
    session.updatedAt = new Date();
    this.saveData();
    return { success: true, messageCount: session.messages.length };
  }

  deleteLastMessages(sessionId, count = 2) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const removed = session.messages.splice(-Math.min(count, session.messages.length));
    session.updatedAt = new Date();
    this.saveData();
    return { success: true, removed: removed.length, messageCount: session.messages.length };
  }

  touchSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
      this.saveData();
    }
  }

  setSessionTags(sessionId, tags) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.tags = tags;
    session.updatedAt = new Date();
    this.saveData();
    return session.toJSON();
  }

  addSessionTag(sessionId, tag) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    if (!session.tags) {
      session.tags = [];
    }
    if (!session.tags.includes(tag)) {
      session.tags.push(tag);
      session.updatedAt = new Date();
      this.saveData();
    }
    return session.toJSON();
  }

  removeSessionTag(sessionId, tag) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    if (session.tags) {
      session.tags = session.tags.filter(t => t !== tag);
      session.updatedAt = new Date();
      this.saveData();
    }
    return session.toJSON();
  }

  getAllTags() {
    const tags = new Set();
    for (const session of this.sessions.values()) {
      if (session.tags) {
        session.tags.forEach(tag => tags.add(tag));
      }
    }
    return Array.from(tags);
  }

  getSessionsByTag(tag) {
    const sessions = [];
    for (const session of this.sessions.values()) {
      if (session.tags && session.tags.includes(tag)) {
        sessions.push(session.toJSON());
      }
    }
    return sessions;
  }
}

module.exports = SessionManager;