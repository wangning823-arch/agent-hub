/**
 * Codex Agent适配器
 * 使用 codex exec 命令进行对话
 * 注意：Codex 必须在 git 仓库内运行
 */
import Agent from './base';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentOptions } from '../types';

interface CodexOptions extends AgentOptions {
  fullAuto?: boolean;
  model?: string;
}

interface HealthCheckResult {
  ok: boolean;
  info?: string;
  error?: string;
}

interface JsonMessage {
  type: string;
  content?: string;
  text?: string;
  message?: string;
  input?: unknown;
  args?: unknown;
  name?: string;
  tool?: string;
  output?: string;
  error?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  model?: string;
  file?: string;
  path?: string;
}

// 获取 npm 全局 bin 目录
function getNpmGlobalBin(): string | null {
  try {
    return execSync('npm config get prefix', { encoding: 'utf-8' }).trim() + '/bin';
  } catch (e) {
    return null;
  }
}

// 确保 PATH 包含 npm 全局目录
function getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const npmBin = getNpmGlobalBin();
  if (npmBin && env.PATH && !env.PATH.includes(npmBin)) {
    env.PATH = npmBin + ':' + env.PATH;
  }
  return env;
}

class CodexAgent extends Agent {
  options: CodexOptions;
  activeProc: ChildProcess | null;

  constructor(workdir: string, options: CodexOptions = {}) {
    super('codex', workdir);
    this.options = options;
    // 跟踪活跃的子进程，便于停止/清理
    this.activeProc = null;
  }

  /**
   * 检查是否在 git 仓库内
   */
  isGitRepo(dir: string): boolean {
    let current = dir;
    while (true) {
      if (fs.existsSync(path.join(current, '.git'))) return true;
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }

  async start(): Promise<void> {
    // Codex 要求在 git 仓库内运行
    if (!this.isGitRepo(this.workdir)) {
      this.isRunning = false;
      throw new Error('Codex 需要在 git 仓库内运行，请先初始化仓库: git init');
    }

    this.isRunning = true;
    // 预检 Codex CLI 是否可用
    try {
      const codexBin = process.env.CODEX_CLI_PATH || 'codex';
      execSync(`"${codexBin}" --version`, { stdio: 'ignore' });
    } catch (e) {
      this.isRunning = false;
      throw new Error('Codex CLI 未发现或不可用，请确保 CODEX_CLI_PATH 指向正确的二进制，或在 PATH 中可访问。');
    }
    this.emit('started');

    // 发送欢迎消息
    this.emit('message', {
      type: 'status',
      content: `✅ Codex 已就绪`
    });
  }

  /**
   * 发送消息给 Codex
   */
  async send(message: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    return new Promise((resolve, reject) => {
      const codexPath = process.env.CODEX_CLI_PATH || 'codex';

      // 构建命令参数
      const args: string[] = ['exec'];

      // 自动批准模式
      if (this.options.fullAuto !== false) {
        args.push('--full-auto');
      }

      // 指定模型
      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      // 添加用户消息（长度截断，防止超大输入导致崩溃）
      let userMessage = message;
      const MAX_INPUT_SIZE = 8000;
      if (typeof userMessage === 'string' && userMessage.length > MAX_INPUT_SIZE) {
        userMessage = userMessage.substring(0, MAX_INPUT_SIZE);
        this.emit('message', { type: 'status', content: '⚠️ 输入过长，已截断以确保处理稳定' });
      }
      args.push(userMessage);

      const proc: ChildProcess = spawn(codexPath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getEnvWithPath()
      });
      this.activeProc = proc;

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let hasOutput = false;

      proc.stdout!.on('data', (data: Buffer) => {
        hasOutput = true;
        stdoutBuffer += data.toString();

        // 按行解析
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop()!;

        for (const line of lines) {
          if (line.trim()) {
            this.handleOutput(line.trim());
          }
        }
      });

      proc.stderr!.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        const msg = data.toString().trim();
        if (msg && !msg.includes('node') && !msg.includes('ExperimentalWarning')) {
          console.error('[Codex stderr]:', msg);
        }
      });

      proc.on('close', () => {
        // 处理剩余输出
        if (stdoutBuffer.trim()) {
          this.handleOutput(stdoutBuffer.trim());
        }

        if (!hasOutput && stderrBuffer.trim()) {
          this.emit('message', { type: 'text', content: stderrBuffer.trim() });
        }

        if (!hasOutput && !stderrBuffer.trim()) {
          this.emit('message', {
            type: 'error',
            content: 'Codex 没有返回输出，请检查配置'
          });
        }

        this.activeProc = null;
        resolve();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          this.emit('message', {
            type: 'error',
            content: 'Codex 未安装，请先安装: npm install -g @openai/codex'
          });
        } else {
          this.emit('message', {
            type: 'error',
            content: `启动失败: ${err.message}`
          });
        }
        this.activeProc = null;
        reject(err);
      });
    });
  }

  /**
   * 处理 Codex 输出
   */
  handleOutput(line: string): void {
    try {
      const msg: JsonMessage = JSON.parse(line);
      this.handleJsonMessage(msg);
    } catch (e) {
      // Codex 可能输出终端控制序列，过滤后作为文本
      const cleaned = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (cleaned) {
        this.emit('message', { type: 'text', content: cleaned });
      }
    }
  }

  /**
   * 处理JSON消息
   */
  handleJsonMessage(msg: JsonMessage): void {
    if (msg.type === 'message' || msg.type === 'assistant') {
      const content = msg.content || msg.text || msg.message;
      if (content) {
        this.emit('message', { type: 'text', content: String(content) });
      }
    } else if (msg.type === 'tool_use' || msg.type === 'tool') {
      this.emit('message', {
        type: 'tool_use',
        content: JSON.stringify(msg.input || msg.args || {}, null, 2),
        metadata: { tool: msg.name || msg.tool }
      });
    } else if (msg.type === 'tool_result') {
      this.emit('message', {
        type: 'tool_result',
        content: String(msg.content || msg.output || '')
      });
    } else if (msg.type === 'error') {
      this.emit('message', {
        type: 'error',
        content: msg.message || msg.error || JSON.stringify(msg)
      });
    } else if (msg.type === 'usage') {
      this.emit('message', {
        type: 'token_usage',
        content: JSON.stringify({
          inputTokens: msg.input_tokens || 0,
          outputTokens: msg.output_tokens || 0,
          cost: msg.cost || 0,
          model: msg.model || 'unknown'
        })
      });
    } else if (msg.type === 'diff' || msg.type === 'file_change') {
      // 文件变更
      this.emit('message', {
        type: 'file_change',
        content: JSON.stringify(msg, null, 2),
        metadata: { file: msg.file || msg.path }
      });
    } else {
      const text = msg.content || msg.text || msg.message || JSON.stringify(msg);
      if (text && text !== '{}') {
        this.emit('message', { type: 'text', content: String(text) });
      }
    }
  }

  /**
   * 停止 Agent
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

  static healthCheck(): HealthCheckResult {
    try {
      const codexBin = process.env.CODEX_CLI_PATH || 'codex';
      execSync(`"${codexBin}" --version`, { stdio: 'ignore' });
      return { ok: true, info: 'Codex available' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export default CodexAgent;
