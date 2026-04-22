const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Session = require('./models/session');
const { createAgent, resumeAgentMessages } = require('./agents/factory');
const WSClients = require('./ws-clients');
const { getDb, saveToFile } = require('./db');
const credentialManager = require('./credentialManager');

class SessionManager {
  constructor(tokenTracker = null) {
    this.sessions = new Map();
    this.wsClients = new WSClients();
    this.tokenTracker = tokenTracker;
    this.initialized = false;
  }

  /**
   * 为工作目录配置Git凭证（如果能检测到远程主机且有凭证的话）
   * @param {string} workdir
   */
  _setupGitForWorkdir(workdir) {
    try {
      const host = this._getGitHostFromWorkdir(workdir);
      if (host) {
        const cred = credentialManager.getCredentialForHost(host);
        if (cred) {
          this._applyCredentialToWorkdir(workdir, cred);
        }
      }
    } catch (e) {
      // 忽略错误，不影响会话创建
      console.debug('设置Git凭证时出错:', e.message);
    }
  }

  /**
   * 从工作目录检测Git远程主机（如github.com）
   * @param {string} workdir
   * @returns {string|null}
   */
  _getGitHostFromWorkdir(workdir) {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) return null;

      // 获取远程URL
      let url;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      } catch (e) {
        // 如果没有origin，尝试第一个远程
        const remotes = execSync('git remote', {
          cwd: workdir,
          encoding: 'utf8'
        })
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (remotes.length === 0) return null;
        url = execSync(`git config --local --get remote.${remotes[0]}.url`, {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      }
      if (!url) return null;

      // 解析主机名
      if (url.startsWith('https://')) {
        const after = url.substring(8);
        const slash = after.indexOf('/');
        if (slash !== -1) {
          return after.substring(0, slash);
        }
      } else if (url.startsWith('git@')) {
        const after = url.substring(4);
        const colon = after.indexOf(':');
        if (colon !== -1) {
          return after.substring(0, colon);
        }
      } else if (url.startsWith('ssh://')) {
        const after = url.substring(6);
        const at = after.indexOf('@');
        if (at !== -1) {
          const afterAt = after.substring(at + 1);
          const slash = afterAt.indexOf('/');
          if (slash !== -1) {
            return afterAt.substring(0, slash);
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 将凭证应用到指定工作目录的Git配置
   * @param {string} workdir
   * @param {Object} cred - 从CredentialManager获取的凭证对象
   * @returns {Object} {success: boolean, message: string}
   */
  _applyCredentialToWorkdir(workdir, cred) {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: false, message: '非Git仓库' };
      }

      if (cred.type === 'token') {
        // 配置凭证助手
        execSync(`git config --local credential.helper "store --file=.git/credentials"`, {
          cwd: workdir
        });
        // 写入凭证文件
        const username = cred.username || 'git';
        if (!cred.secret) {
          return { success: false, message: 'Token缺失' };
        }
        const credentialsLine = `https://${username}:${cred.secret}@${cred.host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8)); // 仅所有者可读写
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        // 配置使用SSH
        execSync('git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"', {
          cwd: workdir
        });
        // 如果提供了私钥数据，写入临时文件并指定
        if (cred.keyData) {
          const keyPath = path.join(workdir, '.git', 'id_rsa');
          fs.writeFileSync(keyPath, cred.keyData, { encoding: 'utf8' });
          fs.chmodSync(keyPath, parseInt('600', 8));
          execSync(`git config --local core.sshCommand "ssh -i ${keyPath} -o StrictHostKeyChecking=no"`, {
            cwd: workdir
          });
        }
        return { success: true, message: 'SSH凭证已配置' };
      } else {
        return { success: false, message: `未知凭证类型: ${cred.type}` };
      }
    } catch (error) {
      return { success: false, message: `配置失败: ${error.message}` };
    }
  }

  async init() {
    if (this.initialized) return;
    this.loadData();
    this.initialized = true;
  }

  loadData() {
    const db = getDb();
    const rows = db.exec(`
      SELECT id, workdir, agent_type, agent_name, conversation_id, title, options, 
             is_pinned, is_archived, tags, created_at, updated_at
      FROM sessions ORDER BY updated_at DESC
    `);
    
    if (rows.length === 0) return;
    
    const columns = rows[0].columns;
    const values = rows[0].values;
    
    for (const row of values) {
      const sessionData = {};
      columns.forEach((col, i) => {
        sessionData[col] = row[i];
      });
      
      const msgRows = db.exec(`
        SELECT role, content, time FROM messages 
        WHERE session_id = '${sessionData.id.replace(/'/g, "''")}' ORDER BY id
      `);
      
      const messages = msgRows.length > 0 ? msgRows[0].values.map(m => {
        let content = m[1];
        if (m[0] === 'assistant' && typeof content === 'string') {
          try { content = JSON.parse(content); } catch(e) {}
        }
        return { role: m[0], content, time: m[2] };
      }) : [];
      
      const session = {
        id: sessionData.id,
        workdir: sessionData.workdir,
        agentType: sessionData.agent_type,
        agentName: sessionData.agent_name,
        conversationId: sessionData.conversation_id,
        title: sessionData.title,
        options: JSON.parse(sessionData.options || '{}'),
        isPinned: sessionData.is_pinned === 1,
        isArchived: sessionData.is_archived === 1,
        tags: JSON.parse(sessionData.tags || '[]'),
        createdAt: new Date(sessionData.created_at),
        updatedAt: new Date(sessionData.updated_at),
        isActive: false,
        messages: messages,
  toJSON() {
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
            isWorking: this.isWorking || false,
            isStarting: this.isStarting || false,
            conversationId: this.conversationId,
            lastMessageAt: this.messages.length > 0
              ? this.messages[this.messages.length - 1].time
              : this.createdAt,
            title: this.title,
            isPinned: this.isPinned,
            isArchived: this.isArchived,
            tags: this.tags
          };
        }
      };
      this.sessions.set(session.id, session);
    }
    console.log(`已加载 ${this.sessions.size} 个会话`);
  }

  saveSession(session) {
    const db = getDb();
    
    db.run(`
      INSERT OR REPLACE INTO sessions (id, workdir, agent_type, agent_name, conversation_id, title, options, is_pinned, is_archived, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.workdir,
      session.agentType || 'claude-code',
      session.agentName || session.agent?.name || 'unknown',
      session.conversationId || null,
      session.title || null,
      JSON.stringify(session.options || {}),
      session.isPinned ? 1 : 0,
      session.isArchived ? 1 : 0,
      JSON.stringify(session.tags || []),
      session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
      session.updatedAt instanceof Date ? session.updatedAt.toISOString() : new Date().toISOString()
    ]);

    db.run(`DELETE FROM messages WHERE session_id = ?`, [session.id]);
    
    const messagesToSave = session.messages.slice(-200);
    for (const msg of messagesToSave) {
      const content = typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
      db.run('INSERT INTO messages (session_id, role, content, time) VALUES (?, ?, ?, ?)', 
        [session.id, msg.role, content, msg.time]);
    }
    
    saveToFile();
  }

  saveData() {
    for (const session of this.sessions.values()) {
      this.saveSession(session);
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
    
    const fs = require('fs');
    if (!fs.existsSync(absoluteWorkdir)) {
      fs.mkdirSync(absoluteWorkdir, { recursive: true });
      console.log(`创建目录: ${absoluteWorkdir}`);
    }
    
    // 为工作目录配置Git凭证（如果能检测到远程主机且有凭证的话）
    this._setupGitForWorkdir(absoluteWorkdir);
    
    const agent = createAgent(absoluteWorkdir, agentType, options);
    const session = new Session(id, agent, absoluteWorkdir, options);
    session.agentType = agentType;

    agent.on('message', (msg) => this.broadcast(id, msg));
    agent.on('error', (err) => this.broadcast(id, { type: 'error', content: err.toString() }));
    // 注意：不再监听 stopped 事件，因为任务完成后 agent 仍然可用

    try {
      await agent.start();
    } catch (err) {
      console.error('Agent.start 失败:', err && err.message);
      this.broadcast(id, { type: 'error', content: `Agent启动失败: ${err.message}` });
      return null;
    }

    this.sessions.set(id, session);
    this.saveSession(session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map(s => s.toJSON());
  }

  isAgentRunning(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.isActive && session.agent && !session.agent.killed;
  }

  async sendMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 如果正在执行，拒绝新的消息
    if (session.isWorking) {
      throw new Error('Agent正在执行任务，请等待完成后再发送');
    }

    if (!session.agent) {
      session.isStarting = true;
      this.broadcast(sessionId, { type: 'status', content: 'agent_starting' });
      try {
        await this._resumeAgent(session);
      } finally {
        session.isStarting = false;
        this.broadcast(sessionId, { type: 'status', content: 'agent_started' });
      }
    }

    session.messages.push({ role: 'user', content: message, time: new Date().toISOString() });
    this.saveSession(session);

    // 标记任务开始
    session.isWorking = true;
    this.broadcast(sessionId, { type: 'status', content: 'task_started' });

    let agentError = null;
    try {
      await session.agent.send(message);
    } catch (error) {
      agentError = error;
      this.broadcast(sessionId, { type: 'error', content: `任务执行错误: ${error.message}` });
    } finally {
      // 标记任务结束
      session.isWorking = false;
      this.broadcast(sessionId, { type: 'status', content: 'task_done' });

      // 不销毁 agent，保持会话连续性
      this.saveSession(session);
    }

    // 不再在错误时销毁 agent，保留 agent 以便重试和重连
    // 错误信息已通过 broadcast 发送，agent 仍保持活跃
  }

  async resumeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    if (session.isActive) {
      return session;
    }
    session.isStarting = true;
    this.broadcast(sessionId, { type: 'status', content: 'agent_starting' });
    try {
      await this._resumeAgent(session);
      this.broadcast(sessionId, { type: 'status', content: 'agent_started' });
    } catch (err) {
      session.isActive = false;
      this.broadcast(sessionId, { type: 'error', content: `Agent启动失败: ${err.message}` });
      throw err;
    } finally {
      session.isStarting = false;
    }
    this.saveSession(session);
    return session;
  }

  async _resumeAgent(session) {
    const agentType = session.agentType || 'claude-code';
    const options = { ...session.options, conversationId: session.conversationId };

    // 为工作目录配置Git凭证（如果能检测到远程主机且有凭证的话）
    this._setupGitForWorkdir(session.workdir);

    const agent = createAgent(session.workdir, agentType, options);

    if (agentType === 'claude-api') {
      resumeAgentMessages(agent, session.messages);
    }

    agent.on('message', (msg) => this.broadcast(session.id, msg));
    agent.on('error', (err) => this.broadcast(session.id, { type: 'error', content: err.toString() }));
    // 注意：不再监听 stopped 事件，因为任务完成后 agent 仍然可用

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
        session.messages.push({ role: 'assistant', content: message, time: new Date().toISOString() });
        this.saveSession(session);
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
                this.saveSession(session);
                this.broadcast(sessionId, { type: 'title_update', content: result.title });
              }
            })
            .catch(err => console.error('[AutoTitle] 生成失败:', err.message));
        }
      }
      
      if (session.messages.length % 10 === 0) {
        this.saveSession(session);
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
      
      const db = getDb();
      db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      saveToFile();
    }
  }

  renameSession(sessionId, title) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.title = title;
    session.updatedAt = new Date();
    this.saveSession(session);
    return session.toJSON();
  }

  togglePinSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.isPinned = !session.isPinned;
    session.updatedAt = new Date();
    this.saveSession(session);
    return session.toJSON();
  }

  toggleArchiveSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.isArchived = !session.isArchived;
    session.updatedAt = new Date();
    this.saveSession(session);
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
    this.saveSession(session);
    return { success: true, messageCount: session.messages.length };
  }

  deleteLastMessages(sessionId, count = 2) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const removed = session.messages.splice(-Math.min(count, session.messages.length));
    session.updatedAt = new Date();
    this.saveSession(session);
    return { success: true, removed: removed.length, messageCount: session.messages.length };
  }

  touchSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
      this.saveSession(session);
    }
  }

  setSessionTags(sessionId, tags) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.tags = tags;
    session.updatedAt = new Date();
    this.saveSession(session);
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
      this.saveSession(session);
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
      this.saveSession(session);
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