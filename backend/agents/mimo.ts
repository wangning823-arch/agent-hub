/**
 * Mimo Agent适配器
 * 参考 OpenCode 实现，使用 mimo run --format json 模式
 */
import Agent from './base';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentMessage, AgentOptions } from '../types';

function findMimoPath(): string {
  const envPath = process.env.MIMOCODE_BIN_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates: string[] = [
    '/root/.nvm/versions/node/v22.22.3/lib/node_modules/@mimo-ai/cli/bin/.mimocode',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const mimoWrapper = execSync('which mimo 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (mimoWrapper) {
      const realWrapper = fs.realpathSync(mimoWrapper);
      const binDir = path.dirname(realWrapper);
      const cached = path.join(binDir, '.mimocode');
      if (fs.existsSync(cached)) return cached;

      const platformMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
      const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64' };
      const platform = platformMap[process.platform] || process.platform;
      const arch = archMap[process.arch] || process.arch;
      const cliRoot = path.resolve(binDir, '..');
      const nodeModules = path.join(cliRoot, 'node_modules');
      const names = [
        `@mimo-ai/mimocode-${platform}-${arch}`,
        `@mimo-ai/mimocode-${platform}-${arch}-baseline`,
        `@mimo-ai/mimocode-${platform}-${arch}-musl`,
        `@mimo-ai/mimocode-${platform}-${arch}-baseline-musl`,
      ];
      for (const name of names) {
        const candidate = path.join(nodeModules, name, 'bin', 'mimo');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (e) { /* ignore */ }

  return 'mimo';
}

const MIMO_PATH: string = findMimoPath();
console.log('[Mimo] 使用路径:', MIMO_PATH);

interface MimoOptions extends AgentOptions {
  model?: string;
  variant?: string;
  sessionId?: string;
  mode?: string;
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
  // 兼容其他格式
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
    // mimo自己的session ID（格式为 ses_xxx）
    // 如果传入的 sessionId 是 ses_ 开头的格式，直接使用
    if (options.sessionId && options.sessionId.startsWith('ses_')) {
      this.mimoSessionId = options.sessionId;
    } else {
      this.mimoSessionId = null;
    }
    // agent-hub的sessionId，用于内部标识
    this.hubSessionId = options.sessionId || null;
    this.options = options;
    this.activeProc = null;
    this.pendingHistory = null;
    this.contextWindow = 200000; // 默认值，start() 时从配置获取实际值
  }

  async start(): Promise<void> {
    this.isRunning = true;
    // 检查 mimo CLI 是否可用
    try {
      execSync(`"${MIMO_PATH}" --version`, { stdio: 'ignore' });
    } catch (e) {
      this.isRunning = false;
      throw new Error('Mimo CLI 未发现或不可用，请确保 MIMO_CLI_PATH 指向正确的二进制，或在 PATH 中可访问。');
    }

    // 获取模型的上下文窗口大小
    this.contextWindow = this._fetchContextWindow();

    this.emit('started');

    // 发送欢迎消息
    this.emit('message', {
      type: 'status',
      content: '✅ Mimo 已就绪'
    });
  }

  /**
   * 从 mimo debug config 获取当前模型的上下文窗口大小
   */
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

  /**
   * 发送消息给 Mimo
   */
  async send(message: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    // 简单校验输入
    let trimmed = typeof message !== 'string' ? String(message) : message;
    trimmed = trimmed.trim();
    if (!trimmed) {
      return Promise.resolve();
    }

    // 若已有正在运行的子进程，优雅地中止
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGTERM');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
    }

    console.log('[Mimo] 发送消息:', trimmed.substring(0, Math.min(100, trimmed.length)));
    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    // 如果有待注入的历史上下文， prepend 到消息中
    let finalMessage = trimmed;
    if (this.pendingHistory) {
      finalMessage = `[之前的对话上下文]\n${this.pendingHistory}\n\n[当前消息]\n${trimmed}`;
      this.pendingHistory = null;
    }

    return new Promise((resolve, reject) => {
      // 构建命令参数（参考 opencode）
      const args: string[] = ['run'];

      // 使用 --pure 避免 plugins 导致进程挂起
      args.push('--pure');

      // 恢复会话 - 只在有mimo自己的session ID时使用
      if (this.mimoSessionId) {
        args.push('--session', this.mimoSessionId);
      }

      // 指定模型，如果没有指定则使用默认模型 mimo/mimo-auto
      const model = this.options.model || 'mimo/mimo-auto';
      console.log('[Mimo] 使用模型:', model, '(options.model:', this.options.model, ')');
      args.push('--model', model);

      // 推理强度
      if (this.options.variant) {
        args.push('--variant', this.options.variant);
      }

      // 权限模式
      if (this.options.mode === 'auto' || this.options.mode === 'bypassPermissions') {
        args.push('--dangerously-skip-permissions');
      }

      // JSON格式输出
      args.push('--format', 'json');

      // 添加用户消息
      args.push(finalMessage);

      console.log('[Mimo] spawn:', MIMO_PATH, args.join(' '));

      // 直接用 spawn 传递参数数组，避免 shell 转义问题
      const proc: ChildProcess = spawn(MIMO_PATH, args, {
        cwd: this.workdir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // 关闭 stdin，防止 mimo 等待输入
      proc.stdin!.end();

      // 记录当前活跃进程
      this.activeProc = proc;

      let buffer = '';
      let hasOutput = false;

      // 实时处理 stdout 输出
      proc.stdout!.on('data', (data: Buffer) => {
        hasOutput = true;
        buffer += data.toString();
        // 按行处理
        const lines = buffer.split('\n');
        buffer = lines.pop()!; // 保留最后一个不完整的行
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
        // 处理 buffer 中剩余的内容
        if (buffer.trim()) {
          this.handleOutput(buffer.trim());
        }

        // 只有当关闭的进程仍然是当前活跃进程时才清除引用
        // 避免新进程启动后，旧进程的 close 事件误清新进程的引用
        if (this.activeProc === proc) {
          this.activeProc = null;
        }

        if (code !== 0 && !hasOutput) {
          const err = new Error(`Mimo 退出码: ${code}`);
          console.error('[Mimo] exit error:', err.message);
          this.emit('message', { type: 'error', content: `Mimo 执行失败: ${err.message}` });
          reject(err);
        } else {
          // 通知会话 agent 已停止
          this.emit('stopped', { code: 0 });
          resolve();
        }
      });

      proc.on('error', (err: Error) => {
        console.error('[Mimo] spawn error:', err.message);
        this.emit('message', { type: 'error', content: `Mimo 执行失败: ${err.message}` });
        this.activeProc = null;
        reject(err);
      });
    });
  }

  /**
   * 处理 Mimo 输出
   */
  handleOutput(line: string): void {
    try {
      const msg: MimoJsonMessage = JSON.parse(line);
      this.handleJsonMessage(msg);
    } catch (e) {
      // 非JSON作为单行状态提示
      this.emit('message', { type: 'status', content: line, replace: true });
    }
  }

  /**
   * 处理JSON消息
   */
  handleJsonMessage(msg: MimoJsonMessage): void {
    try {
      // Mimo 格式: { type: "text", part: { type: "text", text: "..." } }
      if (msg.type === 'text' && msg.part?.text) {
        console.log('[Mimo] emit text:', msg.part.text.substring(0, 100));
        this.emit('message', { type: 'text', content: msg.part.text });
      } else if (msg.type === 'step_start') {
        // 步骤开始
      } else if (msg.type === 'step_finish') {
        // 步骤完成，检查 token 统计
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
        // 保存 mimo自己的sessionID
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
        // 兼容其他可能的格式
        const content = msg.content || msg.text || msg.message || msg.part?.text;
        if (content) {
          this.emit('message', { type: 'text', content: String(content) });
        }
      } else {
        // 未知消息类型，尝试提取文本
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

  /**
   * 停止 Agent
   */
  async stop(): Promise<void> {
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGKILL');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
    }
    this.isRunning = false;
    // 保留 mimoSessionId 以便恢复会话时可以继续对话
    this.emit('stopped', { code: 0 });
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt(): Promise<void> {
    console.log('[Mimo] interrupt, activeProc:', this.activeProc ? `pid=${this.activeProc.pid}` : 'null');
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGKILL');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' });
    }
  }

  /**
   * 静态健康检查
   */
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
