import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

import type {
  AgentType,
  AgentMessage,
  AgentBase,
  SessionMessage,
  SessionOptions,
  Subtask,
  TokenRecord,
  SessionJSON,
  Credential,
  WorkflowDefinition,
  WorkflowInstance,
} from './types';
import { WebSocket } from 'ws';

// ==================== Local Interfaces ====================

/** sql.js Database thin interface (subset used in this file) */
interface SqlDb {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): {
    bind(params: unknown[]): void;
    step(): boolean;
    get(): unknown[];
    free(): void;
  };
}

/** Minimal TokenTracker interface used by SessionManager */
interface TokenTrackerLike {
  recordUsage(sessionId: string, usage: TokenRecord): void;
}

/** WSClients thin interface */
interface WSClientsLike {
  add(sessionId: string, ws: WebSocket): void;
  remove(sessionId: string, ws: WebSocket): void;
  broadcast(sessionId: string, message: AgentMessage | Record<string, unknown>): void;
  delete(sessionId: string): void;
}

/** CredentialManager thin interface */
interface CredentialManagerLike {
  getCredentialForHost(host: string): Credential | null;
}

/** Split analysis result */
interface SplitAnalysisResult {
  shouldSplit: boolean;
  reason: string;
  tasks: Array<{ description: string; complexity: string }>;
}

/** Session instance with all runtime properties + toJSON() */
interface SessionInstance {
  id: string;
  workdir: string;
  agentType: AgentType;
  agentName: string;
  conversationId: string | null;
  title: string | null;
  options: SessionOptions;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date | undefined;
  isActive: boolean;
  isWorking?: boolean;
  isStarting?: boolean;
  agent?: AgentBase;
  messages: SessionMessage[];
  lastSavedMessageCount: number;
  subtasks: Subtask[];
  workflowDefs: WorkflowDefinition[];
  workflows: WorkflowInstance[];
  userId?: string;
  toJSON(): SessionJSON;
}

// ==================== Lazy imports for .js modules ====================
// These are loaded at runtime to avoid circular dependency issues

/// <reference types="node" />

let _createAgent: ((workdir: string, agentType: AgentType, options: Record<string, unknown>) => AgentBase) | null = null;
let _getDb: (() => SqlDb) | null = null;
let _saveToFile: (() => void) | null = null;
let _credentialManager: CredentialManagerLike | null = null;
let _WSClients: (new () => WSClientsLike) | null = null;

function ensureImports(): void {
  if (_createAgent !== null) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const factoryMod = require('./agents/factory') as {
    createAgent: (workdir: string, agentType: AgentType, options: Record<string, unknown>) => AgentBase;
  };
  _createAgent = factoryMod.createAgent;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dbMod = require('./db') as { getDb: () => SqlDb; saveToFile: () => void };
  _getDb = dbMod.getDb;
  _saveToFile = dbMod.saveToFile;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _credentialManager = require('./credentialManager').default as CredentialManagerLike;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _WSClients = require('./ws-clients').default as unknown as new () => WSClientsLike;
}

// ==================== SessionManager ====================

class SessionManager {
  sessions: Map<string, SessionInstance>;
  wsClients: WSClientsLike;
  tokenTracker: TokenTrackerLike | null;
  initialized: boolean;

  constructor(tokenTracker: TokenTrackerLike | null = null) {
    ensureImports();
    this.sessions = new Map<string, SessionInstance>();
    this.wsClients = new _WSClients!();
    this.tokenTracker = tokenTracker;
    this.initialized = false;
  }

  // ==================== Git Credential Helpers ====================

  /**
   * 为工作目录配置Git凭证（如果能检测到远程主机且有凭证的话）
   */
  private _setupGitForWorkdir(workdir: string): void {
    try {
      const host = this._getGitHostFromWorkdir(workdir);
      if (host) {
        const cred = _credentialManager!.getCredentialForHost(host);
        if (cred) {
          this._applyCredentialToWorkdir(workdir, cred);
        }
      }
    } catch (e) {
      console.debug('设置Git凭证时出错:', (e as Error).message);
    }
  }

  /**
   * 为用户工作目录生成 CLAUDE.md 沙箱限制文件
   * 限制 Claude 只能访问当前目录内的文件
   */
  private _generateClaudeMdForSandbox(workdir: string): void {
    const claudeMdPath = path.join(workdir, 'CLAUDE.md');
    const sandboxContent = `# Security Sandbox

## CRITICAL: File Access Restriction

You are running in a sandboxed environment. You MUST strictly follow these rules:

1. **ONLY access files within the current working directory** (\`.\`)
2. **NEVER access files outside the current directory**, including:
   - Parent directories (e.g., \`../\`, \`../../\`)
   - Other user directories (e.g., \`/home/\`, \`/root/\`, \`/Users/\`)
   - System directories (e.g., \`/etc/\`, \`/var/\`, \`/usr/\`)
3. **NEVER use absolute paths** that point outside the current directory
4. **NEVER execute commands** that access files outside the current directory (e.g., \`cat /etc/passwd\`, \`ls /root\`)

## Allowed Operations

- Read, write, and modify files within the current directory
- Run git commands within the current directory
- Execute build/test commands defined in the project

## Prohibited Operations

- Accessing \`~/\` or any home directory other than the current project
- Reading system files or configuration outside the project
- Executing \`curl\`, \`wget\`, or other tools to access external resources without explicit user permission
- Any file operation that escapes the current directory boundary

Violation of these rules will result in immediate termination of the session.
`;
    try {
      // 只在 CLAUDE.md 不存在时创建，避免覆盖用户自定义内容
      if (!fs.existsSync(claudeMdPath)) {
        fs.writeFileSync(claudeMdPath, sandboxContent, 'utf8');
        console.log(`[Sandbox] 生成 CLAUDE.md: ${claudeMdPath}`);
      }
    } catch (e) {
      console.debug('生成 CLAUDE.md 失败:', (e as Error).message);
    }
  }

  /**
   * 从工作目录检测Git远程主机（如github.com）
   */
  private _getGitHostFromWorkdir(workdir: string): string | null {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) return null;

      let url: string;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir,
          encoding: 'utf8',
        }).trim();
      } catch (e) {
        const remotes = execSync('git remote', {
          cwd: workdir,
          encoding: 'utf8',
        })
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (remotes.length === 0) return null;
        url = execSync(`git config --local --get remote.${remotes[0]}.url`, {
          cwd: workdir,
          encoding: 'utf8',
        }).trim();
      }
      if (!url) return null;

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
   */
  private _applyCredentialToWorkdir(
    workdir: string,
    cred: Credential,
  ): { success: boolean; message: string } {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: false, message: '非Git仓库' };
      }

      if (cred.type === 'token') {
        execSync(
          `git config --local credential.helper "store --file=.git/credentials"`,
          { cwd: workdir },
        );
        const username = cred.username || 'git';
        if (!cred.secret) {
          return { success: false, message: 'Token缺失' };
        }
        const credentialsLine = `https://${username}:${cred.secret}@${cred.host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8));
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        execSync(
          'git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"',
          { cwd: workdir },
        );
        if (cred.keyData) {
          const keyPath = path.join(workdir, '.git', 'id_rsa');
          fs.writeFileSync(keyPath, cred.keyData, { encoding: 'utf8' });
          fs.chmodSync(keyPath, parseInt('600', 8));
          execSync(
            `git config --local core.sshCommand "ssh -i ${keyPath} -o StrictHostKeyChecking=no"`,
            { cwd: workdir },
          );
        }
        return { success: true, message: 'SSH凭证已配置' };
      } else {
        return { success: false, message: `未知凭证类型: ${cred.type}` };
      }
    } catch (error) {
      return { success: false, message: `配置失败: ${(error as Error).message}` };
    }
  }

  // ==================== Lifecycle ====================

  async init(): Promise<void> {
    if (this.initialized) return;
    this.loadData();
    this.initialized = true;
  }

  loadData(): void {
    const db = _getDb!();
    const rows = db.exec(`
      SELECT id, workdir, agent_type, agent_name, conversation_id, title, options,
             is_pinned, is_archived, tags, created_at, updated_at, subtasks,
             workflow_defs, workflows, user_id
      FROM sessions ORDER BY updated_at DESC
    `);

    if (rows.length === 0) return;

    const columns = rows[0].columns;
    const values = rows[0].values;

    for (const row of values) {
      const sessionData: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => {
        sessionData[col] = row[i];
      });

      const stmt = db.prepare(
        'SELECT role, content, time FROM messages WHERE session_id = ? ORDER BY time'
      );
      stmt.bind([sessionData.id as string]);
      const msgValues: unknown[][] = [];
      while (stmt.step()) {
        msgValues.push(stmt.get());
      }
      stmt.free();
      const msgRows = msgValues.length > 0
        ? [{ columns: ['role', 'content', 'time'], values: msgValues }]
        : [];

      const messages: SessionMessage[] =
        msgRows.length > 0
          ? msgRows[0].values.map((m: unknown[]) => {
              let content: string | AgentMessage = m[1] as string;
              if (m[0] === 'assistant' && typeof content === 'string') {
                try {
                  content = JSON.parse(content) as AgentMessage;
                } catch (e) {
                  /* keep as string */
                }
              }
              return { role: m[0] as SessionMessage['role'], content, time: Number(m[2]) };
            })
          : [];

      const session: SessionInstance = {
        id: sessionData.id as string,
        workdir: sessionData.workdir as string,
        agentType: (sessionData.agent_type as AgentType) || 'claude-code',
        agentName: (sessionData.agent_name as string) || 'unknown',
        conversationId: (sessionData.conversation_id as string) || null,
        title: (sessionData.title as string) || null,
        options: JSON.parse((sessionData.options as string) || '{}') as SessionOptions,
        isPinned: sessionData.is_pinned === 1,
        isArchived: sessionData.is_archived === 1,
        tags: JSON.parse((sessionData.tags as string) || '[]') as string[],
        createdAt: new Date(sessionData.created_at as string),
        updatedAt: new Date(sessionData.updated_at as string),
        isActive: false,
        messages,
        lastSavedMessageCount: messages.length,
        subtasks: JSON.parse((sessionData.subtasks as string) || '[]') as Subtask[],
        workflowDefs: JSON.parse((sessionData.workflow_defs as string) || '[]') as WorkflowDefinition[],
        workflows: JSON.parse((sessionData.workflows as string) || '[]') as WorkflowInstance[],
        userId: (sessionData.user_id as string) || undefined,
        toJSON(): SessionJSON {
          return {
            id: this.id,
            agentType: this.agentType || 'claude-code',
            agentName: this.agentName || 'unknown',
            workdir: this.workdir,
            messageCount: this.messages.length,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt || this.createdAt,
            options: this.options,
            isActive: this.isActive,
            isWorking: this.isWorking || false,
            isStarting: this.isStarting || false,
            conversationId: this.conversationId,
            lastMessageAt:
              this.messages.length > 0
                ? new Date(this.messages[this.messages.length - 1].time)
                : this.createdAt,
            title: this.title,
            isPinned: this.isPinned,
            isArchived: this.isArchived,
            tags: this.tags,
          };
        },
      };
      this.sessions.set(session.id, session);
    }
    console.log(`已加载 ${this.sessions.size} 个会话`);
  }

  saveSession(session: SessionInstance): void {
    const db = _getDb!();

    db.run('BEGIN TRANSACTION');

    try {
      db.run(
        `
        INSERT OR REPLACE INTO sessions (id, workdir, agent_type, agent_name, conversation_id, title, options, is_pinned, is_archived, tags, created_at, updated_at, subtasks, workflow_defs, workflows, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
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
          session.createdAt instanceof Date
            ? session.createdAt.toISOString()
            : String(session.createdAt),
          session.updatedAt instanceof Date
            ? session.updatedAt.toISOString()
            : new Date().toISOString(),
          JSON.stringify(session.subtasks || []),
          JSON.stringify(session.workflowDefs || []),
          JSON.stringify(session.workflows || []),
          session.userId || null,
        ],
      );

      const messagesToSave = session.messages.slice(-200);

      if (session.messages.length < (session.lastSavedMessageCount || 0)) {
        db.run(`DELETE FROM messages WHERE session_id = ?`, [session.id]);
        for (const msg of messagesToSave) {
          const content =
            typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
          db.run(
            'INSERT INTO messages (session_id, role, content, time) VALUES (?, ?, ?, ?)',
            [session.id, msg.role, content, msg.time || Date.now()],
          );
        }
      } else {
        const newMessages = session.messages.slice(session.lastSavedMessageCount || 0);
        const messagesToInsert = newMessages.slice(Math.max(newMessages.length - 200, 0));
        for (const msg of messagesToInsert) {
          const content =
            typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
          db.run(
            'INSERT INTO messages (session_id, role, content, time) VALUES (?, ?, ?, ?)',
            [session.id, msg.role, content, msg.time || Date.now()],
          );
        }
      }

      session.lastSavedMessageCount = session.messages.length;

      db.run('COMMIT');
      _saveToFile!();
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  }

  saveData(): void {
    for (const session of this.sessions.values()) {
      this.saveSession(session);
    }
  }

  async createSession(
    workdir: string,
    agentType: AgentType = 'claude-code',
    options: SessionOptions = {},
    userId?: string,
  ): Promise<SessionInstance | null> {
    const id = uuidv4();

    let absoluteWorkdir = workdir;
    if (workdir.startsWith('~/')) {
      absoluteWorkdir = path.join(process.env.HOME || '/root', workdir.slice(2));
    } else if (!workdir.startsWith('/')) {
      absoluteWorkdir = path.resolve(process.env.HOME || '/root', workdir);
    }

    // 验证 workdir 必须在用户目录内（非 admin 用户）
    if (userId) {
      // 从数据库获取用户的 homeDir
      const db = _getDb!();
      const result = db.exec(`SELECT home_dir FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
      if (result.length > 0 && result[0].values.length > 0) {
        const userHome = result[0].values[0][0] as string;
        const resolvedWorkdir = path.resolve(absoluteWorkdir);
        const resolvedHome = path.resolve(userHome);
        if (!resolvedWorkdir.startsWith(resolvedHome)) {
          throw new Error(`工作目录必须在用户目录 ${userHome} 内`);
        }
      }
    }

    if (!fs.existsSync(absoluteWorkdir)) {
      fs.mkdirSync(absoluteWorkdir, { recursive: true });
      console.log(`创建目录: ${absoluteWorkdir}`);
    }

    // 为非 admin 用户生成 CLAUDE.md 限制文件访问范围
    if (userId) {
      this._generateClaudeMdForSandbox(absoluteWorkdir);
    }

    this._setupGitForWorkdir(absoluteWorkdir);

    const agent = _createAgent!(absoluteWorkdir, agentType, { ...options, sessionId: id, userId, userRole: userId ? 'user' : undefined });
    const session: SessionInstance = {
      id,
      workdir: absoluteWorkdir,
      agentType,
      agentName: agent.name || 'unknown',
      conversationId: null,
      title: null,
      options,
      isPinned: false,
      isArchived: false,
      tags: [],
      createdAt: new Date(),
      updatedAt: undefined,
      isActive: true,
      isWorking: false,
      isStarting: false,
      agent,
      messages: [],
      lastSavedMessageCount: 0,
      subtasks: [],
      workflowDefs: [],
      workflows: [],
      userId,
      toJSON(): SessionJSON {
        return {
          id: this.id,
          agentType: this.agentType || 'claude-code',
          agentName: this.agentName || 'unknown',
          workdir: this.workdir,
          messageCount: this.messages.length,
          createdAt: this.createdAt,
          updatedAt: this.updatedAt || this.createdAt,
          options: this.options,
          isActive: this.isActive,
          isWorking: this.isWorking || false,
          isStarting: this.isStarting || false,
          conversationId: this.conversationId,
          lastMessageAt:
            this.messages.length > 0
              ? new Date(this.messages[this.messages.length - 1].time)
              : this.createdAt,
          title: this.title,
          isPinned: this.isPinned,
          isArchived: this.isArchived,
          tags: this.tags,
        };
      },
    };

    agent.on('message', (msg: AgentMessage) => this.broadcast(id, msg));
    agent.on('error', (err: Error) =>
      this.broadcast(id, { type: 'error', content: err.toString() }),
    );
    agent.on('stopped', () => {
      this.broadcast(id, { type: 'status', content: 'agent_stopped' });
      this.saveSession(session);
      this._generateSummaryIfNeeded(session);
    });

    try {
      await agent.start();
    } catch (err) {
      console.error('Agent.start 失败:', err && (err as Error).message);
      this.broadcast(id, {
        type: 'error',
        content: `Agent启动失败: ${(err as Error).message}`,
      });
      return null;
    }

    this.sessions.set(id, session);
    this.saveSession(session);
    return session;
  }

  getSession(sessionId: string): SessionInstance | undefined {
    return this.sessions.get(sessionId);
  }

  updateSessionOptions(sessionId: string, newOptions: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');
    session.options = { ...session.options, ...newOptions };
    if (session.agent) {
      session.agent.updateOptions(newOptions);
    }
    this.saveSession(session);
  }

  listSessions(userId?: string): SessionJSON[] {
    let sessions = Array.from(this.sessions.values());
    if (userId) {
      sessions = sessions.filter(s => s.userId === userId || !s.userId);
    }
    return sessions.map((s) => s.toJSON());
  }

  isAgentRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return !!(session.isActive && session.agent && session.agent.isRunning);
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

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

    // 处理图片引用：将 /uploads/ 路径复制到项目 workdir 内
    message = await this._processUploadRefs(message, session.workdir);

    session.messages.push({ role: 'user', content: message, time: Date.now() });
    this.saveSession(session);

    session.isWorking = true;
    this.broadcast(sessionId, { type: 'status', content: 'task_started' });

    let agentError: Error | null = null;
    try {
      await session.agent!.send(message);
    } catch (error) {
      agentError = error as Error;
      this.broadcast(sessionId, {
        type: 'error',
        content: `任务执行错误: ${agentError.message}`,
      });
    } finally {
      session.isWorking = false;
      this.broadcast(sessionId, { type: 'status', content: 'task_done' });
      this.saveSession(session);
    }
  }

  async resumeSession(sessionId: string): Promise<SessionInstance> {
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
      this.broadcast(sessionId, {
        type: 'error',
        content: `Agent启动失败: ${(err as Error).message}`,
      });
      throw err;
    } finally {
      session.isStarting = false;
    }
    this.saveSession(session);
    return session;
  }

  private async _processUploadRefs(message: string, workdir: string): Promise<string> {
    // 匹配 [图片: name](/uploads/...) 和 ![](uploads/...) 格式
    const uploadPattern = /\[([^\]]*)\]\(\/uploads\/([^)]+)\)/g;
    const matches = [...message.matchAll(uploadPattern)];
    if (matches.length === 0) return message;

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const localDir = path.join(workdir, '.agent-uploads');

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    let result = message;
    for (const match of matches) {
      const [fullMatch, label, fileRef] = match;
      const srcPath = path.join(uploadsDir, fileRef);
      if (fs.existsSync(srcPath)) {
        const fileName = path.basename(fileRef);
        const destPath = path.join(localDir, fileName);
        fs.copyFileSync(srcPath, destPath);
        // 替换为 workdir 内的绝对路径
        result = result.replace(fullMatch, `[${label}](${destPath})`);
      }
    }
    return result;
  }

  private async _resumeAgent(session: SessionInstance): Promise<void> {
    const agentType = session.agentType || 'claude-code';
    const options: Record<string, unknown> = {
      ...session.options,
      conversationId: session.conversationId,
      sessionId: session.id,
      userId: session.userId,
      userRole: session.userId ? 'user' : undefined,
    };

    if (!fs.existsSync(session.workdir)) {
      throw new Error(`工作目录不存在: ${session.workdir}`);
    }

    this._setupGitForWorkdir(session.workdir);

    const agent = _createAgent!(session.workdir, agentType, options);

    if (!session.conversationId && session.messages.length > 0) {
      const historyLines: string[] = [];
      const summaryMsg = session.messages.find(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[之前对话的摘要]'),
      );
      if (summaryMsg) {
        historyLines.push(summaryMsg.content as string);
      }
      const recentMessages = session.messages
        .filter((m) => m !== summaryMsg && (m.role === 'user' || m.role === 'assistant'))
        .slice(-10);
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? '用户' : '助手';
        const content: string = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        if (content.trim()) {
          historyLines.push(`[${role}]: ${content.slice(0, 500)}`);
        }
      }
      if (historyLines.length > 0) {
        agent.pendingHistory = historyLines.join('\n\n');
      }
    }

    agent.on('message', (msg: AgentMessage) => this.broadcast(session.id, msg));
    agent.on('error', (err: Error) =>
      this.broadcast(session.id, { type: 'error', content: err.toString() }),
    );
    agent.on('stopped', () => {
      this.broadcast(session.id, { type: 'status', content: 'agent_stopped' });
      this.saveSession(session);
      this._generateSummaryIfNeeded(session);
    });

    try {
      await agent.start();
    } catch (err) {
      console.error('Agent.start 失败:', err && (err as Error).message);
      this.broadcast(session.id, {
        type: 'error',
        content: `Agent启动失败: ${(err as Error).message}`,
      });
      throw err;
    }
    session.agent = agent;
    session.isActive = true;
    console.log(`会话 ${session.id} agent已恢复`);
  }

  addClient(sessionId: string, ws: WebSocket): void {
    this.wsClients.add(sessionId, ws);
  }

  removeClient(sessionId: string, ws: WebSocket): void {
    this.wsClients.remove(sessionId, ws);
  }

  broadcast(sessionId: string, message: AgentMessage | Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const msg = message as AgentMessage;
      const metaTypes = [
        'status',
        'token_usage',
        'conversation_id',
        'title_update',
        'context_usage',
        'subtask_status',
        'workflow_status',
        'workflow_step_status',
        'workflow_step_message',
      ];
      if (!metaTypes.includes(msg.type) && !msg.subtask_id && !(msg as any).workflow_id) {
        session.messages.push({ role: 'assistant', content: msg, time: Date.now() });
        this.saveSession(session);
      }

      if (msg.conversationId && !msg.subtask_id) {
        session.conversationId = msg.conversationId;
        this.saveSession(session);
      }

      if (msg.type === 'token_usage' && msg.content && this.tokenTracker) {
        const raw: Record<string, any> = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content as Record<string, any>;
        this.tokenTracker.recordUsage(sessionId, {
          input_tokens: raw.input_tokens || raw.inputTokens || 0,
          output_tokens: raw.output_tokens || raw.outputTokens || 0,
          cache_read_input_tokens: raw.cache_read_input_tokens || raw.cacheReadTokens || 0,
          cache_creation_input_tokens: raw.cache_creation_input_tokens || raw.cacheWriteTokens || 0,
          cost_usd: raw.cost_usd || raw.cost || 0,
        });
      }

      if (session.messages.length % 10 === 0) {
        this.saveSession(session);
      }
    }

    this.wsClients.broadcast(sessionId, message as AgentMessage);
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.agent) {
        await session.agent.stop();
      }
      this.sessions.delete(sessionId);
      this.wsClients.delete(sessionId);

      const db = _getDb!();
      db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      _saveToFile!();
    }
  }

  renameSession(sessionId: string, title: string): SessionJSON {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.title = title;
    session.updatedAt = new Date();
    this.saveSession(session);
    return session.toJSON();
  }

  togglePinSession(sessionId: string): SessionJSON {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.isPinned = !session.isPinned;
    session.updatedAt = new Date();
    this.saveSession(session);
    return session.toJSON();
  }

  toggleArchiveSession(sessionId: string): SessionJSON {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.isArchived = !session.isArchived;
    session.updatedAt = new Date();
    this.saveSession(session);
    return session.toJSON();
  }

  getMessages(sessionId: string, limit: number = 100, offset: number = 0): SessionMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    return session.messages.slice(-(limit + offset), offset > 0 ? -offset : undefined);
  }

  deleteMessage(
    sessionId: string,
    messageIndex: number,
  ): { success: boolean; messageCount: number } {
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

  deleteMessageByTime(
    sessionId: string,
    messageTime: number | string,
  ): { success: boolean; messageCount: number } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const timeNum = typeof messageTime === 'number' ? messageTime : parseInt(String(messageTime), 10);
    if (isNaN(timeNum)) {
      throw new Error('无效的时间戳');
    }
    const index = session.messages.findIndex((m) => {
      const mTime = typeof m.time === 'number' ? m.time : parseInt(String(m.time), 10);
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

  deleteLastMessages(
    sessionId: string,
    count: number = 2,
  ): { success: boolean; removed: number; messageCount: number } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const removed = session.messages.splice(-Math.min(count, session.messages.length));
    session.updatedAt = new Date();
    this.saveSession(session);
    return { success: true, removed: removed.length, messageCount: session.messages.length };
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
      this.saveSession(session);
    }
  }

  setSessionTags(sessionId: string, tags: string[]): SessionJSON {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    session.tags = tags;
    session.updatedAt = new Date();
    this.saveSession(session);
    return session.toJSON();
  }

  addSessionTag(sessionId: string, tag: string): SessionJSON {
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

  removeSessionTag(sessionId: string, tag: string): SessionJSON {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    if (session.tags) {
      session.tags = session.tags.filter((t) => t !== tag);
      session.updatedAt = new Date();
      this.saveSession(session);
    }
    return session.toJSON();
  }

  getAllTags(userId?: string): string[] {
    const tags = new Set<string>();
    for (const session of this.sessions.values()) {
      if (userId && session.userId !== userId && session.userId) continue;
      if (session.tags) {
        session.tags.forEach((tag) => tags.add(tag));
      }
    }
    return Array.from(tags);
  }

  getSessionsByTag(tag: string, userId?: string): SessionJSON[] {
    const sessions: SessionJSON[] = [];
    for (const session of this.sessions.values()) {
      if (userId && session.userId !== userId && session.userId) continue;
      if (session.tags && session.tags.includes(tag)) {
        sessions.push(session.toJSON());
      }
    }
    return sessions;
  }

  // ==================== Workflow Definition CRUD ====================

  getWorkflowDefs(sessionId: string): WorkflowDefinition[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    return session.workflowDefs || [];
  }

  saveWorkflowDef(sessionId: string, def: WorkflowDefinition): WorkflowDefinition {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    if (!session.workflowDefs) session.workflowDefs = [];
    session.workflowDefs.push(def);
    this.saveSession(session);
    return def;
  }

  updateWorkflowDef(sessionId: string, defId: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    const def = (session.workflowDefs || []).find(d => d.id === defId);
    if (!def) throw new Error(`工作流定义不存在: ${defId}`);
    Object.assign(def, updates, { updatedAt: Date.now() });
    this.saveSession(session);
    return def;
  }

  deleteWorkflowDef(sessionId: string, defId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    const before = (session.workflowDefs || []).length;
    session.workflowDefs = (session.workflowDefs || []).filter(d => d.id !== defId);
    this.saveSession(session);
    return (session.workflowDefs || []).length < before;
  }

  // ==================== Workflow Instance CRUD ====================

  getWorkflows(sessionId: string): WorkflowInstance[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    return session.workflows || [];
  }

  getWorkflow(sessionId: string, workflowId: string): WorkflowInstance | null {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    return (session.workflows || []).find(w => w.id === workflowId) || null;
  }

  saveWorkflow(sessionId: string, instance: WorkflowInstance): WorkflowInstance {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    if (!session.workflows) session.workflows = [];
    const idx = session.workflows.findIndex(w => w.id === instance.id);
    if (idx >= 0) {
      session.workflows[idx] = instance;
    } else {
      session.workflows.push(instance);
    }
    this.saveSession(session);
    return instance;
  }

  deleteWorkflow(sessionId: string, workflowId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话不存在: ${sessionId}`);
    const before = (session.workflows || []).length;
    session.workflows = (session.workflows || []).filter(w => w.id !== workflowId);
    this.saveSession(session);
    return (session.workflows || []).length < before;
  }

  /**
   * 自动生成会话摘要（已废弃，改为按需生成）
   */
  private _generateSummaryIfNeeded(_session: SessionInstance): void {
    // 不再自动生成，由用户手动触发恢复记忆
  }

  // ==================== 子任务相关方法 ====================

  /**
   * 捕获 agent 返回文本
   */
  private _captureAgentResponse(agent: AgentBase, message: string): Promise<string> {
    return new Promise<string>((resolve) => {
      let responseText = '';
      const handler = (msg: AgentMessage): void => {
        if (msg.type === 'text') {
          responseText += msg.content;
        } else if (msg.type === 'assistant') {
          const texts = (msg.message?.content || [])
            .filter((c: { type: string; text: string }) => c.type === 'text')
            .map((c: { type: string; text: string }) => c.text);
          responseText += texts.join('\n');
        }
      };
      agent.on('message', handler);
      agent
        .send(message)
        .then(() => {
          agent.removeListener('message', handler);
          resolve(responseText);
        })
        .catch(() => {
          agent.removeListener('message', handler);
          resolve(responseText);
        });
    });
  }

  /**
   * 解析分析结果 JSON
   */
  private _parseSplitResult(text: string | null): SplitAnalysisResult | null {
    if (!text) return null;
    // 策略1: 从 markdown 代码块提取
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1].trim()) as SplitAnalysisResult;
        if (typeof data.shouldSplit === 'boolean') return data;
      } catch (e) { /* ignore */ }
    }
    // 策略2: 找第一个完整的 JSON 对象（非贪婪匹配最近的 }）
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]) as SplitAnalysisResult;
        if (typeof data.shouldSplit === 'boolean') return data;
      } catch (e) { /* ignore */ }
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
              const data = JSON.parse(text.substring(firstBrace, i + 1)) as SplitAnalysisResult;
              if (typeof data.shouldSplit === 'boolean') return data;
            } catch (e) { /* ignore */ }
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
  async executeSplitAnalysis(
    sessionId: string,
    message: string,
  ): Promise<SplitAnalysisResult | null> {
    const { SPLIT_ANALYZER_PROMPT } = require('./prompts/split-analyzer') as {
      SPLIT_ANALYZER_PROMPT: string;
    };
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const analysisPrompt = SPLIT_ANALYZER_PROMPT.replace('{message}', message);

    const tempAgent = _createAgent!(session.workdir, session.agentType, {
      ...session.options,
      sessionId: uuidv4(),
      userId: session.userId,
      userRole: session.userId ? 'user' : undefined,
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
      console.error('任务拆分分析失败:', (err as Error).message);
      await tempAgent.stop().catch(() => {});
      return null;
    }
  }

  /**
   * 执行单个子任务
   */
  async executeSubtask(sessionId: string, subtaskId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const subtask = session.subtasks.find((s) => s.id === subtaskId);
    if (!subtask || subtask.status === 'running') return;

    subtask.status = 'running';
    this.broadcast(sessionId, {
      type: 'subtask_status',
      content: '',
      subtask_id: subtaskId,
      status: 'running',
    });

    const agent = _createAgent!(session.workdir, session.agentType, {
      ...session.options,
      sessionId: uuidv4(),
      model: subtask.model || session.options?.model,
      userId: session.userId,
      userRole: session.userId ? 'user' : undefined,
    });

    let handler: ((msg: AgentMessage) => void) | null = null;
    let saveTimer: ReturnType<typeof setInterval> | null = null;
    try {
      await agent.start();

      handler = (msg: AgentMessage): void => {
        this.broadcast(sessionId, { ...msg, subtask_id: subtaskId });
        subtask.messages = subtask.messages || [];
        if (msg.type === 'text') {
          subtask.messages.push({ type: 'text', content: String(msg.content), time: Date.now() });
        } else if (msg.type === 'assistant') {
          const texts = (msg.message?.content || [])
            .filter((c: { type: string; text: string }) => c.type === 'text')
            .map((c: { type: string; text: string }) => c.text);
          if (texts.length > 0) {
            subtask.messages.push({
              type: 'assistant',
              content: texts.join('\n'),
              time: Date.now(),
            });
          }
        } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
          subtask.messages.push({
            type: msg.type,
            content: String(msg.content || ''),
            time: Date.now(),
          });
        }
        subtask.result = subtask.messages
          .map((m) => m.content || '')
          .filter(Boolean)
          .join('\n');
      };
      agent.on('message', handler);

      saveTimer = setInterval(() => this.saveSession(session), 5000);

      await agent.send(subtask.description);

      subtask.status = 'done';
      subtask.completedAt = Date.now();
      this.broadcast(sessionId, {
        type: 'subtask_status',
        content: '',
        subtask_id: subtaskId,
        status: 'done',
      });
    } catch (err) {
      subtask.status = 'error';
      subtask.error = (err as Error).message;
      this.broadcast(sessionId, {
        type: 'subtask_status',
        content: '',
        subtask_id: subtaskId,
        status: 'error',
        error: (err as Error).message,
      });
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
  async executeAllSubtasks(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const pending = session.subtasks.filter((s) => s.status === 'pending');
    await Promise.allSettled(pending.map((s) => this.executeSubtask(sessionId, s.id)));
  }

  /**
   * 取消子任务
   */
  cancelSubtask(sessionId: string, subtaskId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const subtask = session.subtasks.find((s) => s.id === subtaskId);
    if (!subtask) throw new Error('子任务不存在');

    subtask.status = 'error';
    subtask.error = '用户取消';
    this.broadcast(sessionId, {
      type: 'subtask_status',
      content: '',
      subtask_id: subtaskId,
      status: 'error',
      error: '用户取消',
    });
    this.saveSession(session);
  }

  /**
   * 更新子任务
   */
  updateSubtask(
    sessionId: string,
    subtaskId: string,
    updates: Partial<Subtask>,
  ): Subtask {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    const subtask = session.subtasks.find((s) => s.id === subtaskId);
    if (!subtask) throw new Error('子任务不存在');

    Object.assign(subtask, updates);
    this.saveSession(session);
    return subtask;
  }

  /**
   * 删除子任务
   */
  deleteSubtask(sessionId: string, subtaskId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');

    session.subtasks = session.subtasks.filter((s) => s.id !== subtaskId);
    this.saveSession(session);
  }

  /**
   * 获取子任务列表
   */
  getSubtasks(sessionId: string): Subtask[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('会话不存在');
    return session.subtasks || [];
  }
}

export default SessionManager;
