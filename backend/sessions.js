/**
 * 会话管理器 - 管理多个Agent会话
 */
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const ClaudeCodeAgent = require('./agents/claude-code');
const OpenCodeAgent = require('./agents/opencode');
const CodexAgent = require('./agents/codex');

class Session {
  constructor(id, agent, workdir, options = {}) {
    this.id = id;
    this.agent = agent;
    this.workdir = workdir;
    this.messages = [];
    this.createdAt = new Date();
    this.options = options;
    this.isActive = true;
    this.conversationId = null; // Claude Code的对话ID
  }

  toJSON() {
    return {
      id: this.id,
      agentName: this.agent?.name || 'unknown',
      workdir: this.workdir,
      messageCount: this.messages.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt || this.createdAt,
      options: this.options,
      isActive: this.isActive,
      conversationId: this.conversationId,
      lastMessageAt: this.messages.length > 0
        ? this.messages[this.messages.length - 1].time
        : this.createdAt,
      // 新增字段
      title: this.title || null,
      isPinned: this.isPinned || false,
      isArchived: this.isArchived || false,
      tags: this.tags || []
    };
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.wsClients = new Map(); // sessionId -> Set<WebSocket>
    this.sessionsFile = path.join(__dirname, '..', 'data', 'sessions.json');
    this.loadData();
  }

  /**
   * 加载会话数据
   */
  loadData() {
    try {
      const dataDir = path.dirname(this.sessionsFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
        // 只加载会话的元数据，不重新启动agent
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
            isActive: false, // 需要重新启动
            conversationId: sessionData.conversationId || null,
            title: sessionData.title || null,
            isPinned: sessionData.isPinned || false,
            isArchived: sessionData.isArchived || false,
            // 添加toJSON方法
            toJSON: function() {
              return {
                id: this.id,
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

  /**
   * 保存会话数据
   */
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
        messages: s.messages.slice(-50), // 只保留最近50条消息
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        options: s.options || {},
        isActive: s.isActive || false,
        conversationId: s.conversationId || s.agent?.conversationId || null
      }));

      fs.writeFileSync(this.sessionsFile, JSON.stringify(sessionsData, null, 2));
    } catch (error) {
      console.error('保存会话数据失败:', error);
    }
  }

  /**
   * 创建新会话
   */
  async createSession(workdir, agentType = 'claude-code', options = {}) {
    const id = uuidv4();
    
    // 解析绝对路径（展开 ~）
    let absoluteWorkdir = workdir;
    if (workdir.startsWith('~/')) {
      absoluteWorkdir = path.join(process.env.HOME || '/data/data/com.termux/files/home', workdir.slice(2));
    } else if (!workdir.startsWith('/')) {
      absoluteWorkdir = path.resolve(process.env.HOME || '/data/data/com.termux/files/home', workdir);
    }
    
    // 如果目录不存在，自动创建
    if (!fs.existsSync(absoluteWorkdir)) {
      fs.mkdirSync(absoluteWorkdir, { recursive: true });
      console.log(`创建目录: ${absoluteWorkdir}`);
    }
    
    // 根据类型创建Agent
    let agent;
    switch (agentType) {
      case 'claude-code':
        agent = new ClaudeCodeAgent(absoluteWorkdir, options);
        break;
      case 'opencode':
        agent = new OpenCodeAgent(absoluteWorkdir, options);
        break;
      case 'codex':
        agent = new CodexAgent(absoluteWorkdir, options);
        break;
      default:
        throw new Error(`未知的Agent类型: ${agentType}`);
    }

    // 监听Agent消息
    agent.on('message', (msg) => {
      this.broadcast(id, msg);
    });

    agent.on('error', (err) => {
      this.broadcast(id, { type: 'error', content: err.toString() });
    });

    agent.on('stopped', () => {
      this.broadcast(id, { type: 'status', content: 'Agent已停止' });
    });

    // 启动Agent
    await agent.start();

    const session = new Session(id, agent, absoluteWorkdir, options);
    this.sessions.set(id, session);

    // 保存会话数据
    this.saveData();

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话
   */
  listSessions() {
    return Array.from(this.sessions.values()).map(s => s.toJSON());
  }

  /**
   * 发送消息到会话
   */
  async sendMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 记录消息
    session.messages.push({ role: 'user', content: message, time: new Date() });

    // 发送给Agent
    await session.agent.send(message);
  }

  /**
   * 添加WebSocket客户端到会话
   */
  addClient(sessionId, ws) {
    if (!this.wsClients.has(sessionId)) {
      this.wsClients.set(sessionId, new Set());
    }
    this.wsClients.get(sessionId).add(ws);
  }

  /**
   * 移除WebSocket客户端
   */
  removeClient(sessionId, ws) {
    const clients = this.wsClients.get(sessionId);
    if (clients) {
      clients.delete(ws);
    }
  }

  /**
   * 广播消息到会话的所有客户端
   */
  broadcast(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push({ role: 'assistant', content: message, time: new Date() });
      
      // 如果消息包含对话ID，保存它
      if (message.conversationId) {
        session.conversationId = message.conversationId;
      }
      
      // 如果是token使用统计，记录它
      if (message.type === 'token_usage' && message.content) {
        // 这里可以调用tokenTracker.recordUsage
        // 但需要传入tokenTracker实例，暂时通过前端记录
      }
      
      // 定期保存（每10条消息保存一次）
      if (session.messages.length % 10 === 0) {
        this.saveData();
      }
    }

    const clients = this.wsClients.get(sessionId);
    if (clients) {
      const payload = JSON.stringify({ sessionId, ...message });
      for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(payload);
        }
      }
    }
  }

  /**
   * 停止并删除会话
   */
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

  /**
   * 重命名会话
   */
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

  /**
   * 置顶/取消置顶会话
   */
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

  /**
   * 归档/取消归档会话
   */
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

  /**
   * 获取会话消息列表
   */
  getMessages(sessionId, limit = 100, offset = 0) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const messages = session.messages.slice(-(limit + offset), offset > 0 ? -offset : undefined);
    return messages;
  }

  /**
   * 删除消息
   */
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

  /**
   * 删除最后N条消息（用于重新生成）
   */
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

  /**
   * 更新会话时间戳
   */
  touchSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
      this.saveData();
    }
  }

  /**
   * 设置会话标签
   */
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

  /**
   * 添加会话标签
   */
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

  /**
   * 移除会话标签
   */
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

  /**
   * 获取所有标签
   */
  getAllTags() {
    const tags = new Set();
    for (const session of this.sessions.values()) {
      if (session.tags) {
        session.tags.forEach(tag => tags.add(tag));
      }
    }
    return Array.from(tags);
  }

  /**
   * 按标签筛选会话
   */
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
