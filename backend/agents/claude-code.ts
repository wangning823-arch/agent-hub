/**
 * Claude Code Agent适配器
 * 使用 --print --continue 模式，每次调用保持对话历史
 */
import Agent from './base';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { AgentMessage, AgentOptions } from '../types';

interface ClaudeCodeOptions extends AgentOptions {
  mode?: string;
  effort?: string;
  sessionId?: string;
  conversationId?: string;
  model?: string;
}

interface ContextInfo {
  model: string;
  usedTokens: string;
  totalTokens: string;
  percentage: number;
}

interface HealthCheckResult {
  ok: boolean;
  info?: string;
  error?: string;
}

interface StreamMessage {
  type: string;
  subtype?: string;
  message?: {
    content: Array<{ type: string; text: string; name?: string; input?: unknown }>;
  };
  result?: string;
  conversation_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  modelUsage?: Record<string, unknown>;
}

class ClaudeCodeAgent extends Agent {
  conversationId: string | null;
  options: ClaudeCodeOptions;
  activeProc: ChildProcess | null;
  pendingHistory: string | null;

  constructor(workdir: string, options: ClaudeCodeOptions = {}) {
    super('claude-code', workdir);
    this.conversationId = options.conversationId || null; // 支持恢复已有对话
    this.options = options;
    // 跟踪正在运行的子进程，用于优雅地中止/清理
    this.activeProc = null;
    this.pendingHistory = null;
  }

  async start(): Promise<void> {
    // Claude Code 不需要长期运行的进程
    // 每次发消息时启动一个新进程，用 --continue 保持历史
    this.isRunning = true;
    // 可选的自检，确保 claude CLI 可用
    try {
      const claudeBin = process.env.CLAUDE_CLI_PATH || 'claude';
      execSync(`"${claudeBin}" --version`, { stdio: 'ignore' });
    } catch (e) {
      this.isRunning = false;
      throw new Error('Claude CLI 未发现或不可用，请确保 CLAUDE_CLI_PATH 指向正确的二进制，或在 PATH 中可访问。');
    }
    this.emit('started');

    // 发送欢迎消息
    this.emit('message', {
      type: 'status',
      content: `✅ Claude Code 已就绪`
    });
  }

  /**
   * 拦截 /context 命令，获取准确的上下文使用信息
   */
  async sendContextCommand(): Promise<void> {
    return new Promise((resolve, _reject) => {
      const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
      const args: string[] = [
        '--print',
        '--verbose',
        '--output-format', 'stream-json'
      ];
      const model = this.options.model || this._resolveDefaultModel();
      if (model) args.push('--model', model);
      // 权限模式：plan 模式下不使用 --dangerously-skip-permissions
      if (this.options.mode === 'plan') {
        args.push('--permission-mode', 'plan');
      } else {
        args.push('--dangerously-skip-permissions');
        if (this.options.mode && this.options.mode !== 'default') {
          args.push('--permission-mode', this.options.mode);
        }
      }
      // 对话隔离：与 send() 方法保持一致，检查会话文件是否存在
      if (this.conversationId) {
        args.push('--resume', this.conversationId);
      } else if (this.options.sessionId) {
        if (this._conversationFileExists(this.options.sessionId)) {
          args.push('--resume', this.options.sessionId);
        } else {
          args.push('--session-id', this.options.sessionId);
        }
      } else {
        args.push('--continue');
      }
      args.push('-p', '/context');

      console.log(`[Context] 执行: ${claudePath} ${args.join(' ')}`);
      console.log(`[Context] conversationId=${this.conversationId}, sessionId=${this.options.sessionId}`);

      const proc: ChildProcess = spawn(claudePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stderr = '';
      proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      // 超时 30 秒自动终止，防止进程挂起阻塞主流程
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        done();
      }, 30000);

      let buffer = '';
      proc.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg: StreamMessage = JSON.parse(line);
              if (msg.type === 'result' && msg.result) {
                console.log('[Context] result:', msg.result.substring(0, 200));
                const info: ContextInfo | null = this._parseContextInfo(msg.result);
                if (info) {
                  console.log('[Context] parsed:', JSON.stringify(info));
                  this.emit('message', { type: 'context_usage', content: info } as any);
                } else {
                  console.log('[Context] 解析失败');
                }
              }
            } catch (_) {}
          }
        }
      });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[Context] 进程退出, code=${code}`);
        if (stderr) console.log(`[Context] stderr: ${stderr.slice(0, 500)}`);
        done();
      });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[Context] 进程错误:`, err.message);
        done();
      });
    });
  }

  /**
   * 解析 /context 命令返回的 markdown，提取上下文使用信息
   * 格式: **Tokens:** 29.8k / 200k (15%)
   */
  _parseContextInfo(text: string): ContextInfo | null {
    try {
      const modelMatch = text.match(/\*\*Model:\*\*\s*(.+?)[\s\\]/);
      const tokensMatch = text.match(/\*\*Tokens:\*\*\s*([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?)\s*\((\d+)%\)/);
      if (!tokensMatch) return null;
      return {
        model: modelMatch ? modelMatch[1].trim() : 'unknown',
        usedTokens: tokensMatch[1],
        totalTokens: tokensMatch[2],
        percentage: parseInt(tokensMatch[3])
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 发送消息给Claude Code
   */
  async send(message: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    // 拦截 /context 命令
    if (message.trim() === '/context') {
      this.emit('message', { type: 'status', content: '📊 获取上下文信息...' });
      await this.sendContextCommand();
      return;
    }

    // 拦截 /compact 命令 - 通过 CLI 子进程实际执行上下文压缩
    if (message.trim() === '/compact') {
      console.log(`[Compact] conversationId=${this.conversationId}, sessionId=${this.options.sessionId}`);
      this.emit('message', { type: 'status', content: '🔄 正在压缩上下文...' });
      try {
        await this._executeCompact();
        this.emit('message', { type: 'status', content: '✅ 上下文压缩完成' });
        // 压缩完成后自动获取最新的上下文使用量
        await this.sendContextCommand();
      } catch (err) {
        console.error('[Compact] 失败:', (err as Error).message);
        this.emit('message', { type: 'status', content: '⚠️ 压缩失败，将在后续对话中自动管理上下文' });
      }
      return;
    }

    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    return new Promise((resolve, reject) => {
      // 直接调用 Claude Code CLI（不使用 wrapper 脚本）
      const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';

      // 构建命令参数
      const args: string[] = [
        '--print',
        '--verbose',
        '--output-format', 'stream-json'
      ];

      // 指定模型（如果用户选了的话）
      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      // 权限模式：plan 模式下不使用 --dangerously-skip-permissions，否则会覆盖 plan
      if (this.options.mode === 'plan') {
        args.push('--permission-mode', 'plan');
      } else {
        args.push('--dangerously-skip-permissions');
        if (this.options.mode && this.options.mode !== 'default') {
          args.push('--permission-mode', this.options.mode);
        }
      }

      // 非 admin 用户添加安全限制提示词
      if (this.options.userRole === 'user') {
        args.push('--append-system-prompt', `SECURITY RESTRICTION: You are running in a sandboxed environment. You MUST strictly follow these rules:
1. ONLY access and modify files within the current working directory (the directory you were started in)
2. NEVER access files outside the current directory, including parent directories, other user directories, or system directories
3. If a user asks you to access files outside the current directory, REFUSE and explain the security restriction
4. NEVER execute commands that would access files outside the current directory (e.g., cat /etc/passwd, ls /root, cd ../../)
Violation of these rules will result in session termination.`);
      }

      // 添加努力程度参数
      if (this.options.effort) {
        args.push('--effort', this.options.effort);
      }

      // 对话隔离：有 conversationId 用 --resume，没有则检查会话文件是否存在
      // 如果会话文件存在，用 --resume 恢复；如果不存在，用 --session-id 创建新会话
      if (this.conversationId) {
        args.push('--resume', this.conversationId);
      } else if (this.options.sessionId) {
        if (this._conversationFileExists(this.options.sessionId)) {
          // 会话文件存在，恢复已有会话
          args.push('--resume', this.options.sessionId);
        } else {
          // 会话文件不存在，创建新会话
          args.push('--session-id', this.options.sessionId);
        }
      } else {
        args.push('--continue');
      }

      // 添加用户消息（长度截断，防止超大输入导致崩溃）
      let userMessage = message;

      // 如果有待注入的历史上下文， prepend 到消息中
      if (this.pendingHistory) {
        userMessage = `[之前的对话上下文]\n${this.pendingHistory}\n\n[当前消息]\n${userMessage}`;
        this.pendingHistory = null;
      }
      const MAX_INPUT_SIZE = 8000;
      if (typeof userMessage === 'string' && userMessage.length > MAX_INPUT_SIZE) {
        userMessage = userMessage.substring(0, MAX_INPUT_SIZE);
        this.emit('message', { type: 'status', content: '⚠️ 输入过长，已截断以确保处理稳定' });
      }
      args.push('-p', userMessage);

      // 启动 Claude Code CLI
      const proc: ChildProcess = spawn(claudePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env
        }
      });
      // 超时提醒：10min 未响应则提示用户，可选择继续等待或点击停止按钮
      const timeoutId = setTimeout(() => {
        this.emit('message', { type: 'status', content: '⏳ 响应已超时超过10分钟，如需等待请点击停止按钮终止任务...' });
      }, 600000);
      // 清理超时定时器（在输出完成时清理）
      // 记录活跃进程，便于后续中止
      this.activeProc = proc;

      let buffer = '';
      let hasOutput = false;

      proc.stdout!.on('data', (data: Buffer) => {
        hasOutput = true;
        buffer += data.toString();

        // 按行解析
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg: StreamMessage = JSON.parse(line);
              this.handleStreamMessage(msg);

              // 保存对话ID用于后续继续
              if (msg.type === 'result' && msg.conversation_id) {
                this.conversationId = msg.conversation_id;
              }
            } catch (e) {
              // 非JSON作为文本
              this.emit('message', { type: 'text', content: line });
            }
          }
        }
      });

      proc.stderr!.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('Loaded') && !msg.includes('model')) {
          console.error('[Claude stderr]:', msg);
        }
      });

      proc.on('close', async () => {
        // 取消超时定时器
        try { clearTimeout(timeoutId); } catch {}
        // 处理剩余buffer
        if (buffer.trim()) {
          try {
            const msg: StreamMessage = JSON.parse(buffer);
            this.handleStreamMessage(msg);
          } catch (e) {
            this.emit('message', { type: 'text', content: buffer });
          }
        }

        if (!hasOutput) {
          this.emit('message', {
            type: 'error',
            content: 'Claude Code 没有返回输出，请检查配置'
          });
        }

        // 清理活跃进程引用
        this.activeProc = null;

        // 通知会话 agent 已停止
        this.emit('stopped', { code: 0 });

        resolve();

        // 每次回答后异步获取上下文使用情况（不阻塞主流程）
        this.sendContextCommand().catch(() => {});
      });

      proc.on('error', (err: Error) => {
        this.emit('message', {
          type: 'error',
          content: `启动失败: ${err.message}`
        });
        this.activeProc = null;
        reject(err);
      });
    });
  }

  /**
   * 处理stream-json消息
   */
  handleStreamMessage(msg: StreamMessage): void {
    if (msg.type === 'assistant') {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        // 文本内容
        const texts = content.filter(c => c.type === 'text').map(c => c.text);
        if (texts.length > 0) {
          this.emit('message', { type: 'text', content: texts.join('\n') });
        }

        // 工具调用
        const tools = content.filter(c => c.type === 'tool_use');
        for (const tool of tools) {
          this.emit('message', {
            type: 'tool_use',
            content: JSON.stringify(tool.input, null, 2),
            metadata: { tool: tool.name }
          });
        }
      }
    } else if (msg.type === 'result') {
      // 保存对话ID
      if (msg.conversation_id) {
        this.conversationId = msg.conversation_id;
        // 通知前端保存对话ID
        this.emit('message', {
          type: 'conversation_id',
          content: msg.conversation_id,
          conversationId: msg.conversation_id
        });
      }

      // 发送Token使用统计
      if (msg.usage) {
        // 不从 modelUsage 获取 contextWindow（该值不可靠，可能是默认值）
        // contextWindow 由前端从模型配置（contextLimit）获取
        this.emit('message', {
          type: 'token_usage',
          content: JSON.stringify({
            inputTokens: msg.usage.input_tokens || 0,
            outputTokens: msg.usage.output_tokens || 0,
            cacheReadTokens: msg.usage.cache_read_input_tokens || 0,
            cacheWriteTokens: msg.usage.cache_creation_input_tokens || 0,
            cost: msg.total_cost_usd || 0,
            model: msg.modelUsage ? Object.keys(msg.modelUsage)[0] : 'unknown'
          })
        });
      }

      // 不再单独emit result，因为assistant消息已经包含了完整内容
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      // 初始化信息
      console.log('[Claude Code] 初始化:', msg);
    }
  }

  /**
   * 发送权限审批响应（在dangerously-skip-permissions模式下不需要）
   */
  async approve(approvalId: string, allow: boolean = true): Promise<void> {
    console.log(`[权限] ${allow ? '允许' : '拒绝'} ${approvalId}`);
  }

  /**
   * 通过 CLI 子进程执行 /compact 命令，实际压缩上下文
   */
  private _executeCompact(): Promise<void> {
    return new Promise((resolve, reject) => {
      const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
      const args: string[] = ['--print'];

      // 使用 --resume 恢复现有对话并发送 /compact
      if (this.conversationId) {
        args.push('--resume', this.conversationId);
      } else if (this.options.sessionId) {
        if (this._conversationFileExists(this.options.sessionId)) {
          args.push('--resume', this.options.sessionId);
        } else {
          args.push('--session-id', this.options.sessionId);
        }
      } else {
        args.push('--continue');
      }

      // 权限模式
      if (this.options.mode === 'plan') {
        args.push('--permission-mode', 'plan');
      } else {
        args.push('--dangerously-skip-permissions');
        if (this.options.mode && this.options.mode !== 'default') {
          args.push('--permission-mode', this.options.mode);
        }
      }
      const model = this.options.model || this._resolveDefaultModel();
      if (model) {
        args.push('--model', model);
      }

      args.push('-p', '/compact');

      console.log(`[Compact] 执行: ${claudePath} ${args.join(' ')}`);

      const proc = spawn(claudePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';
      proc.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      // 超时 180 秒（compact 需要读取完整会话并总结，大文件可能需要较长时间）
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch {}
        reject(new Error('Compact 超时'));
      }, 180000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[Compact] 进程退出, code=${code}`);
        if (stderr) console.log(`[Compact] stderr: ${stderr.slice(0, 500)}`);
        if (code !== 0) {
          reject(new Error(`Compact 失败 (exit code: ${code}): ${stderr.slice(0, 200)}`));
        } else {
          done();
        }
      });
      proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  /**
   * 停止Agent
   */
  async stop(): Promise<void> {
    if (this.activeProc) {
      const pid = this.activeProc.pid;
      try {
        process.kill(-pid!, 'SIGKILL');
      } catch (e) {
        try { this.activeProc.kill('SIGKILL'); } catch (e2) { /* ignore */ }
      }
      this.activeProc = null;
    }
    this.isRunning = false;
    this.conversationId = null;
    this.emit('stopped', { code: 0 });
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt(): Promise<void> {
    if (this.activeProc) {
      const pid = this.activeProc.pid;
      try {
        process.kill(-pid!, 'SIGKILL');
      } catch (e) {
        try { this.activeProc.kill('SIGKILL'); } catch (e2) { /* ignore */ }
      }
      this.activeProc = null;
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' });
    }
  }

  // 静态健康检查：不依赖工作目录即可快速判断可用性
  static healthCheck(): HealthCheckResult {
    try {
      const claudeBin = process.env.CLAUDE_CLI_PATH || 'claude';
      execSync(`"${claudeBin}" --version`, { stdio: 'ignore' });
      return { ok: true, info: 'Claude Code CLI available' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * 解析默认模型：优先读 workdir 下的 .claude/settings.json，再读 ~/.claude/settings.json
   */
  _resolveDefaultModel(): string | null {
    try {
      // 1. 读 workdir 下的本地 settings
      const localSettings = path.join(this.workdir, '.claude', 'settings.json');
      if (fs.existsSync(localSettings)) {
        const settings = JSON.parse(fs.readFileSync(localSettings, 'utf-8'));
        if (settings.env?.ANTHROPIC_MODEL) return settings.env.ANTHROPIC_MODEL;
      }
      // 2. 读系统级 ~/.claude/settings.json
      const homeSettings = path.join(os.homedir(), '.claude', 'settings.json');
      if (fs.existsSync(homeSettings)) {
        const settings = JSON.parse(fs.readFileSync(homeSettings, 'utf-8'));
        if (settings.env?.ANTHROPIC_MODEL) return settings.env.ANTHROPIC_MODEL;
      }
    } catch (e) {
      // 读取失败，返回 null
    }
    return null;
  }

  /**
   * 检查Claude Code会话文件是否存在
   * 用于判断是否可以使用 --resume 恢复会话
   */
  _conversationFileExists(sessionId: string): boolean {
    try {
      // Claude Code存储路径: ~/.claude/projects/<project-dir>/<sessionId>.jsonl
      // project-dir是工作目录路径，/替换为-
      const projectDir = this.workdir.replace(/\//g, '-');
      const claudeDir = path.join(os.homedir(), '.claude', 'projects', projectDir);
      const filePath = path.join(claudeDir, `${sessionId}.jsonl`);
      return fs.existsSync(filePath);
    } catch (e) {
      return false;
    }
  }
}

export default ClaudeCodeAgent;
