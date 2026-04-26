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
             is_pinned, is_archived, tags, created_at, updated_at, subtasks
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
        WHERE session_id = '${sessionData.id.replace(/'/g, "''")}' ORDER BY time
      `);
      
      const messages = msgRows.length > 0 ? msgRows[0].values.map(m => {
        let content = m[1];
        if (m[0] === 'assistant' && typeof content === 'string') {
          try { content = JSON.parse(content); } catch(e) {}
        }
        return { role: m[0], content, time: Number(m[2]) };
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
        lastSavedMessageCount: messages.length,
        subtasks: JSON.parse(sessionData.subtasks || '[]'),
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
    
    db.run('BEGIN TRANSACTION');
    
    try {
      db.run(`
        INSERT OR REPLACE INTO sessions (id, workdir, agent_type, agent_name, conversation_id, title, options, is_pinned, is_archived, tags, created_at, updated_at, subtasks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        session.updatedAt instanceof Date ? session.updatedAt.toISOString() : new Date().toISOString(),
        JSON.stringify(session.subtasks || [])
      ]);

      const messagesToSave = session.messages.slice(-200);
      
      if (session.messages.length < (session.lastSavedMessageCount || 0)) {
        db.run(`DELETE FROM messages WHERE session_id = ?`, [session.id]);
        for (const msg of messagesToSave) {
          const content = typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
          db.run('INSERT INTO messages (session_id, role, content, time) VALUES (?, ?, ?, ?)',
            [session.id, msg.role, content, msg.time || Date.now()]);
        }
      } else {
        const newMessages = session.messages.slice(session.lastSavedMessageCount || 0);
        const messagesToInsert = newMessages.slice(Math.max(newMessages.length - 200, 0));
        for (const msg of messagesToInsert) {
          const content = typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
          db.run('INSERT INTO messages (session_id, role, content, time) VALUES (?, ?, ?, ?)',
            [session.id, msg.role, content, msg.time || Date.now()]);
        }
      }
      
      session.lastSavedMessageCount = session.messages.length;
      
      db.run('COMMIT');
      saveToFile();
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
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
    
    const agent = createAgent(absoluteWorkdir, agentType, { ...options, sessionId: id });
    const session = new Session(id, agent, absoluteWorkdir, options);
    session.agentType = agentType;

    agent.on('message', (msg) => this.broadcast(id, msg));
    agent.on('error', (err) => this.broadcast(id, { type: 'error', content: err.toString() }));
    agent.on('stopped', () => {
      session.isActive = false;
      this.broadcast(id, { type: 'status', content: 'agent_stopped' });
      this.saveSession(session);
      this._generateSummaryIfNeeded(session);
    });

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
    return session.isActive && session.agent && session.agent.isRunning;
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

    session.messages.push({ role: 'user', content: message, time: Date.now() });
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
    const options = { ...session.options, conversationId: session.conversationId, sessionId: session.id };

    // 检查工作目录是否存在
    const fs = require('fs');
    if (!fs.existsSync(session.workdir)) {
      throw new Error(`工作目录不存在: ${session.workdir}`);
    }

    // 为工作目录配置Git凭证（如果能检测到远程主机且有凭证的话）
    this._setupGitForWorkdir(session.workdir);

    const agent = createAgent(session.workdir, agentType, options);

    // 如果没有 conversationId，说明 agent 无法从本地存储恢复历史，需要注入消息
    if (!session.conversationId && session.messages.length > 0) {
      // 构建历史上下文：摘要（如有）+ 最近10条对话
      const historyLines = [];
      // 查找是否已有摘要消息
      const summaryMsg = session.messages.find(m =>
        m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[之前对话的摘要]')
      );
      if (summaryMsg) {
        historyLines.push(summaryMsg.content);
      }
      // 取最近10条对话（排除摘要本身）
      const recentMessages = session.messages
        .filter(m => m !== summaryMsg && (m.role === 'user' || m.role === 'assistant'))
        .slice(-10);
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? '用户' : '助手';
        let content = typeof msg.content === 'string'
          ? msg.content
          : (msg.content?.content || JSON.stringify(msg.content));
        if (typeof content !== 'string') content = JSON.stringify(content);
        if (content && content.trim()) {
          historyLines.push(`[${role}]: ${content.slice(0, 500)}`);
        }
      }
      if (historyLines.length > 0) {
        agent.pendingHistory = historyLines.join('\n\n');
      }
    }

    agent.on('message', (msg) => this.broadcast(session.id, msg));
    agent.on('error', (err) => this.broadcast(session.id, { type: 'error', content: err.toString() }));
    agent.on('stopped', () => {
      session.isActive = false;
      this.broadcast(session.id, { type: 'status', content: 'agent_stopped' });
      this.saveSession(session);
      this._generateSummaryIfNeeded(session);
    });

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
      const metaTypes = ['status', 'token_usage', 'conversation_id', 'title_update', 'context_usage', 'subtask_status'];
      if (!metaTypes.includes(message.type)) {
        session.messages.push({ role: 'assistant', content: message, time: Date.now() });
        this.saveSession(session);
      }
      
      if (message.conversationId) {
        session.conversationId = message.conversationId;
        this.saveSession(session);
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

  deleteMessageByTime(sessionId, messageTime) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const timeNum = typeof messageTime === 'number' ? messageTime : parseInt(messageTime, 10);
    if (isNaN(timeNum)) {
      throw new Error('无效的时间戳');
    }
    const index = session.messages.findIndex(m => {
      const mTime = typeof m.time === 'number' ? m.time : parseInt(m.time, 10);
      return mTime === timeNum;
    });
    if (index === -1) {
      throw new Error('消息不存在');
    }
    session.messages.splice(index, 1);
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

  /**
   * 自动生成会话摘要（已废弃，改为按需生成）
   * 保留方法签名避免报错，实际由前端调用 /restore-memory 接口触发
   */
  _generateSummaryIfNeeded(session) {
    // 不再自动生成，由用户手动触发恢复记忆
  }

  // ==================== 子任务相关方法 ====================

  /**
   * 捕获 agent 返回文本
   */
  _captureAgentResponse(agent, message) {
    return new Promise((resolve) => {
      let responseText = '';
      const handler = (msg) => {
        if (msg.type === 'text') {
          responseText += msg.content;
        } else if (msg.type === 'assistant') {
          const texts = (msg.message?.content || [])
            .filter(c => c.type === 'text').map(c => c.text);
          responseText += texts.join('\n');
        }
      };
      agent.on('message', handler);
      agent.send(message).then(() => {
        agent.removeListener('message', handler);
        resolve(responseText);
      }).catch(() => {
        agent.removeListener('message', handler);
        resolve(responseText);
      });
    });
  }

  /**
   * 解析分析结果 JSON
   */
  _parseSplitResult(text) {
    if (!text) return null;
    // 策略1: 从 markdown 代码块提取
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1].trim());
        if (typeof data.shouldSplit === 'boolean') return data;
      } catch {}
    }
    // 策略2: 找第一个完整的 JSON 对象（非贪婪匹配最近的 }）
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        if (typeof data.shouldSplit === 'boolean') return data;
      } catch {}
    }
    // 策略3: 逐字符找匹配的 {}（处理嵌套数组）
    const firstBrace = text.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0;
      for (let i = firstBrace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              const data = JSON.parse(text.substring(firstBrace, i + 1));
              if (typeof data.shouldSplit === 'boolean') return data;
            } catch {}
            break;
          }
        }
      }
    }
    return null;
  }

  /**
   * 执行任务拆分分析
   */
  async executeSplitAnalysis(sessionId, message) {
    const { SPLIT_ANALYZER_PROMPT } = require('./prompts/split-analyzer');
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const analysisPrompt = SPLIT_ANALYZER_PROMPT.replace('{message}', message);

    // 创建临时分析 agent（不复用当前 session 的 agent，避免干扰）
    const tempAgent = createAgent(session.workdir, session.agentType, {
      ...session.options,
      sessionId: uuidv4()
    });

    try {
      await tempAgent.start();
      const responseText = await this._captureAgentResponse(tempAgent, analysisPrompt);
      console.log('[拆分分析] Agent 原始回复:', responseText?.substring(0, 500));
      const result = this._parseSplitResult(responseText);
      console.log('[拆分分析] 解析结果:', JSON.stringify(result));
      await tempAgent.stop();
      return result;
    } catch (err) {
      console.error('任务拆分分析失败:', err.message);
      await tempAgent.stop().catch(() => {});
      return null;
    }
  }

  /**
   * 执行单个子任务
   */
  async executeSubtask(sessionId, subtaskId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const subtask = session.subtasks.find(s => s.id === subtaskId);
    if (!subtask || subtask.status === 'running') return;

    subtask.status = 'running';
    this.broadcast(sessionId, { type: 'subtask_status', subtask_id: subtaskId, status: 'running' });

    // 创建临时 agent（使用合法 UUID 作为 sessionId）
    const agent = createAgent(session.workdir, session.agentType, {
      ...session.options,
      sessionId: uuidv4(),
      model: subtask.model || session.options?.model
    });

    let handler = null;
    let saveTimer = null;
    try {
      await agent.start();

      // 监听 agent 事件，带 subtask_id 广播，同时累积结构化消息
      handler = (msg) => {
        this.broadcast(sessionId, { ...msg, subtask_id: subtaskId });
        subtask.messages = subtask.messages || [];
        if (msg.type === 'text') {
          subtask.messages.push({ type: 'text', content: msg.content, time: Date.now() });
        } else if (msg.type === 'assistant') {
          const texts = (msg.message?.content || [])
            .filter(c => c.type === 'text').map(c => c.text);
          if (texts.length > 0) {
            subtask.messages.push({ type: 'assistant', content: texts.join('\n'), time: Date.now() });
          }
        } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
          subtask.messages.push({ type: msg.type, content: msg.content || '', time: Date.now() });
        }
        // 派生 result 字符串（向后兼容）
        subtask.result = subtask.messages.map(m => m.content || '').filter(Boolean).join('\n');
      };
      agent.on('message', handler);

      // 每 5 秒自动保存一次，防止异常终止时结果丢失
      saveTimer = setInterval(() => this.saveSession(session), 5000);

      await agent.send(subtask.description);

      // 标记完成
      subtask.status = 'done';
      subtask.completedAt = Date.now();
      this.broadcast(sessionId, { type: 'subtask_status', subtask_id: subtaskId, status: 'done' });
    } catch (err) {
      subtask.status = 'error';
      subtask.error = err.message;
      this.broadcast(sessionId, { type: 'subtask_status', subtask_id: subtaskId, status: 'error', error: err.message });
    } finally {
      if (saveTimer) clearInterval(saveTimer);
      if (handler) agent.removeListener('message', handler);
      await agent.stop().catch(() => {});
    }

    this.saveSession(session);
  }

  /**
   * 并行执行所有 pending 子任务
   */
  async executeAllSubtasks(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const pending = session.subtasks.filter(s => s.status === 'pending');
    await Promise.allSettled(pending.map(s => this.executeSubtask(sessionId, s.id)));
  }

  /**
   * 取消子任务
   */
  cancelSubtask(sessionId, subtaskId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const subtask = session.subtasks.find(s => s.id === subtaskId);
    if (!subtask) throw new Error('子任务不存在');

    subtask.status = 'error';
    subtask.error = '用户取消';
    this.broadcast(sessionId, { type: 'subtask_status', subtask_id: subtaskId, status: 'error', error: '用户取消' });
    this.saveSession(session);
  }

  /**
   * 更新子任务
   */
  updateSubtask(sessionId, subtaskId, updates) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const subtask = session.subtasks.find(s => s.id === subtaskId);
    if (!subtask) throw new Error('子任务不存在');

    Object.assign(subtask, updates);
    this.saveSession(session);
    return subtask;
  }

  /**
   * 删除子任务
   */
  deleteSubtask(sessionId, subtaskId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    session.subtasks = session.subtasks.filter(s => s.id !== subtaskId);
    this.saveSession(session);
  }

  /**
   * 获取子任务列表
   */
  getSubtasks(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');
    return session.subtasks || [];
  }
}

module.exports = SessionManager;