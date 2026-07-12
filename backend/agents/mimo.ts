/**
 * Mimo Agent适配器
 * 使用 mimo run 单进程模式，每次 send() 启动独立子进程
 * 参考 OpenCode 的实现方式，避免 server 模式的稳定性问题
 */
import Agent from './base';
import { execSync, spawn, ChildProcess } from 'child_process';
import { findMimoPath } from '../utils/mimo-path';
import type { AgentMessage, AgentOptions } from '../types';

const MIMO_PATH: string = findMimoPath();
console.log('[Mimo] 使用路径:', MIMO_PATH);

interface MimoOptions extends AgentOptions {
  model?: string;
  variant?: string;
  sessionId?: string;
  mode?: string;
  agent?: string;
}

interface MimoJsonMessage {
  type: string;
  sessionID?: string;
  part?: {
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      metadata?: Record<string, unknown>;
      title?: string;
    };
    reason?: string;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: {
        write?: number;
        read?: number;
      };
    };
    cost?: number;
    messageID?: string;
    snapshot?: string;
  };
  content?: string;
  text?: string;
  message?: string;
  input?: unknown;
  args?: unknown;
  name?: string;
  tool?: string;
  output?: string;
  error?: string;
}

interface HealthCheckResult {
  ok: boolean;
  info?: string;
  error?: string;
}

class MimoAgent extends Agent {
  mimoSessionId: string | null;
  hubSessionId: string | null;
  options: MimoOptions;
  activeProc: ChildProcess | null;
  pendingHistory: string | null;
  contextWindow: number;

  constructor(workdir: string, options: MimoOptions = {}) {
    super('mimo', workdir);
    this.mimoSessionId = options.conversationId || null;
    this.hubSessionId = options.sessionId || options.conversationId || null;
    this.options = options;
    this.activeProc = null;
    this.pendingHistory = null;
    this.contextWindow = 200000;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    try {
      execSync(`"${MIMO_PATH}" --version`, { stdio: 'ignore' });
    } catch (e) {
      this.isRunning = false;
      throw new Error('Mimo CLI 未发现或不可用，请确保 MIMO_CLI_PATH 指向正确的二进制，或在 PATH 中可访问。');
    }

    this.contextWindow = this._fetchContextWindow();
    this.emit('started');
    this.emit('message', { type: 'status', content: '✅ Mimo 已就绪' });
  }

  _fetchContextWindow(): number {
    try {
      const output = execSync(`"${MIMO_PATH}" debug config`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const config = JSON.parse(output);
      const modelId = this.options.model || 'mimo/mimo-auto';
      const modelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
      const provider = config.provider || {};
      for (const pdata of Object.values(provider) as any[]) {
        const models = pdata?.models || {};
        if (models[modelName]?.limit?.context) {
          return models[modelName].limit.context;
        }
      }
    } catch (e) {
      console.log('[Mimo] 获取上下文窗口大小失败，使用默认值 200k');
    }
    return 200000;
  }

  async send(message: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    let trimmed = typeof message !== 'string' ? String(message) : message;
    trimmed = trimmed.trim();
    if (!trimmed) {
      return Promise.resolve();
    }

    if (trimmed === '/compact') {
      console.log('[Mimo] 检测到 /compact 命令，通知 session manager 处理');
      this.emit('compact', { agentType: 'mimo', workdir: this.workdir });
      return Promise.resolve();
    }

    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGTERM');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
    }

    console.log('[Mimo] 发送消息:', trimmed.substring(0, Math.min(100, trimmed.length)));
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    let finalMessage = trimmed;
    if (this.pendingHistory) {
      finalMessage = `[之前的对话上下文]\n${this.pendingHistory}\n\n[当前消息]\n${trimmed}`;
      this.pendingHistory = null;
    }

    return new Promise((resolve, reject) => {
      const args: string[] = ['run'];

      // 使用 --pure 避免插件挂起（与 opencode 一致）
      args.push('--pure');

      // 显式指定工作目录，确保 CLI 在正确的项目路径下运行
      args.push('--dir', this.workdir);

      // 恢复会话 - 只在有 mimo 自己的 session ID 时使用
      if (this.mimoSessionId) {
        args.push('--session', this.mimoSessionId);
      }

      // 指定模型
      const model = this.options.model || 'mimo/mimo-auto';
      args.push('--model', model);

      // 推理强度
      if (this.options.variant) {
        args.push('--variant', this.options.variant);
      }

      // 权限模式：auto/bypassPermissions/build/compose 都需要跳过权限
      // build/compose 模式下进程无法交互式应答权限提示，必须自动批准
      if (this.options.mode === 'auto' || this.options.mode === 'bypassPermissions' ||
          this.options.agent || ['build', 'compose'].includes(this.options.mode as string)) {
        args.push('--dangerously-skip-permissions');
      }

      // Agent模式 (plan/build/compose)
      if (this.options.agent && ['plan', 'build', 'compose'].includes(this.options.agent)) {
        args.push('--agent', this.options.agent);
      }

      // JSON格式输出
      args.push('--format', 'json');

      // 如果消息太长，使用 --command 从 stdin 读取，避免命令行参数过长导致 E2BIG 错误
      const MESSAGE_THRESHOLD = 30000; // 30KB 阈值
      let useStdin = false;

      if (finalMessage.length > MESSAGE_THRESHOLD) {
        // 消息过长，使用 --command 模式从 stdin 读取
        args.push('--command');
        useStdin = true;
        console.log('[Mimo] 消息过长，使用 stdin 传递，长度:', finalMessage.length);
      } else {
        // 消息较短，直接作为参数传递
        args.push(finalMessage);
      }

      console.log('[Mimo] spawn:', MIMO_PATH, args.join(' '));

      const proc: ChildProcess = spawn(MIMO_PATH, args, {
        cwd: this.workdir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // 如果使用 stdin 模式，写入消息
      if (useStdin) {
        proc.stdin!.write(finalMessage);
      }
      proc.stdin!.end();
      this.activeProc = proc;

      let buffer = '';
      let hasOutput = false;
      let settled = false;

      const settle = (action: 'resolve' | 'reject', value?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        if (action === 'resolve') resolve(value);
        else reject(value);
      };

      const safetyTimer = setTimeout(() => {
        this.emit('message', { type: 'status', content: '⏳ 响应已超时超过10分钟，如需等待请点击停止按钮终止任务...' });
      }, 600000);

      proc.stdout!.on('data', (data: Buffer) => {
        hasOutput = true;
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.trim()) {
            this.handleOutput(line.trim());
          }
        }
      });

      proc.stderr!.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.log('[Mimo stderr]:', text.substring(0, 200));
        }
      });

      proc.on('close', (code) => {
        if (buffer.trim()) {
          this.handleOutput(buffer.trim());
        }

        if (this.activeProc === proc) {
          this.activeProc = null;
        }

        if (code !== 0 && code !== null && !hasOutput) {
          const err = new Error(`Mimo 退出码: ${code}`);
          console.error('[Mimo] exit error:', err.message);
          this.emit('message', { type: 'error', content: `Mimo 执行失败: ${err.message}` });
          this.mimoSessionId = null;
          settle('reject', err);
        } else {
          // 通知会话 agent 已停止（与 claude-code/opencode 一致）
          this.emit('stopped', { code: 0 });
          settle('resolve');
        }
      });

      proc.on('error', (err: Error) => {
        console.error('[Mimo] spawn error:', err.message);
        this.emit('message', { type: 'error', content: `Mimo 执行失败: ${err.message}` });
        this.activeProc = null;
        settle('reject', err);
      });

      (this as any)._safetyTimer = safetyTimer;
    });
  }

  handleOutput(line: string): void {
    try {
      const msg: MimoJsonMessage = JSON.parse(line);
      this.handleJsonMessage(msg);
    } catch (e) {
      this.emit('message', { type: 'status', content: line, replace: true });
    }
  }

  handleJsonMessage(msg: MimoJsonMessage): void {
    try {
      if (msg.type === 'text' && msg.part?.text) {
        this.emit('message', { type: 'text', content: msg.part.text });
      } else if (msg.type === 'step_start') {
        // 步骤开始
      } else if (msg.type === 'step_finish') {
        if (msg.part?.tokens) {
          const t = msg.part.tokens;
          this.emit('message', {
            type: 'token_usage',
            content: {
              inputTokens: t.input || 0,
              outputTokens: t.output || 0,
              cacheReadTokens: t.cache?.read || 0,
              cacheWriteTokens: t.cache?.write || 0,
              totalTokens: t.total || 0,
              contextWindow: this.contextWindow,
              cost: msg.part.cost || 0,
              model: this.options.model || 'mimo/mimo-auto'
            }
          });
        }
        if (msg.sessionID) {
          this.mimoSessionId = msg.sessionID;
          this.emit('message', {
            type: 'conversation_id',
            content: this.mimoSessionId,
            conversationId: this.mimoSessionId
          });
        }
      } else if (msg.type === 'tool_use' || msg.type === 'tool') {
        this.emit('message', {
          type: 'tool_use',
          content: JSON.stringify(msg.input || msg.args || msg.part?.state?.input || {}, null, 2),
          metadata: { tool: msg.name || msg.tool || msg.part?.tool }
        });
      } else if (msg.type === 'tool_result' || msg.type === 'result') {
        if (msg.content || msg.output || msg.part?.state?.output) {
          this.emit('message', {
            type: 'tool_result',
            content: String(msg.content || msg.output || msg.part?.state?.output)
          });
        }
      } else if (msg.type === 'error') {
        this.emit('message', {
          type: 'error',
          content: msg.message || msg.error || JSON.stringify(msg)
        });
      } else if (msg.type === 'message' || msg.type === 'assistant') {
        const content = msg.content || msg.text || msg.message || msg.part?.text;
        if (content) {
          this.emit('message', { type: 'text', content: String(content) });
        }
      } else {
        const text = msg.part?.text || msg.content || msg.text || msg.message;
        if (text && typeof text === 'string' && text.trim()) {
          this.emit('message', { type: 'text', content: text });
        }
      }
    } catch (e) {
      console.error('[Mimo] 处理消息异常:', (e as Error).message);
      this.emit('message', { type: 'error', content: `消息处理异常: ${(e as Error).message}` });
    }
  }

  async stop(): Promise<void> {
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGKILL');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
    }
    this.isRunning = false;
    this.emit('stopped', { code: 0 });
  }

  async interrupt(): Promise<void> {
    console.log('[Mimo] interrupt, activeProc:', this.activeProc ? `pid=${this.activeProc.pid}` : 'null');
    if ((this as any)._safetyTimer) {
      clearTimeout((this as any)._safetyTimer);
      (this as any)._safetyTimer = null;
    }
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGTERM');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' });
    }
  }

  static healthCheck(): HealthCheckResult {
    try {
      execSync(`"${MIMO_PATH}" --version`, { stdio: 'ignore' });
      return { ok: true, info: 'Mimo CLI available' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export default MimoAgent;
