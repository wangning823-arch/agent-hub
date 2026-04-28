/**
 * OpenCode Agent适配器
 * 使用 opencode run 命令进行对话，支持会话恢复
 */
import Agent from './base';
import { exec, execSync, spawn, ChildProcess, ExecOptions } from 'child_process';
import * as fs from 'fs';
import type { AgentOptions } from '../types';

interface OpenCodeOptions extends AgentOptions {
  model?: string;
  agent?: string;
  variant?: string;
  sessionId?: string;
  conversationId?: string;
}

interface HealthCheckResult {
  ok: boolean;
  info?: string;
  error?: string;
}

interface ExecAsyncResult {
  stdout: string;
  stderr: string;
}

interface OpenCodeConfig {
  model?: string;
  provider?: Record<string, {
    models?: Record<string, {
      limit?: {
        context?: number;
      };
    }>;
  }>;
}

interface OpenCodeJsonMessage {
  type: string;
  subtype?: string;
  part?: {
    type?: string;
    text?: string;
    tokens?: {
      input?: number;
      output?: number;
      cache?: {
        read?: number;
        write?: number;
      };
      total?: number;
      cost?: number;
    };
    tool?: string;
    input?: unknown;
    content?: string;
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
  sessionID?: string;
}

// 尝试查找 opencode 可执行文件路径（优先找实际二进制，跳过 wrapper）
function findOpencodePath(): string {
  // 常见的实际二进制路径
  const candidates: string[] = [
    '/home/root1/.npm-global/lib/node_modules/opencode-ai/bin/.opencode',
    '/usr/local/lib/node_modules/opencode-ai/bin/.opencode',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 检查 npm 全局目录动态获取
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8' }).trim();
    const binPath = prefix + '/lib/node_modules/opencode-ai/bin/.opencode';
    if (fs.existsSync(binPath)) return binPath;
  } catch (e) {}
  // fallback 到 wrapper
  try {
    const p = execSync('which opencode 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (p) return p;
  } catch (e) {}
  return 'opencode';
}

const OPENCODE_PATH: string = findOpencodePath();
console.log('[OpenCode] 使用路径:', OPENCODE_PATH);

// 确保 PATH 包含 npm 全局目录
function getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8' }).trim();
    const binDir = prefix + '/bin';
    if (env.PATH && !env.PATH.includes(binDir)) {
      env.PATH = binDir + ':' + env.PATH;
    }
  } catch (e) {}
  return env;
}

// 异步执行 shell 命令（不阻塞事件循环）
function execAsync(cmd: string, options?: ExecOptions): Promise<ExecAsyncResult> {
  return new Promise((resolve, reject) => {
    exec(cmd, { ...options, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(err);
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

// 读取 opencode 配置获取当前模型的 context window
function getOpenCodeContextWindow(): number {
  try {
    const path = require('path');
    const configPath = path.join(process.env.HOME || '/root', '.config', 'opencode', 'opencode.json');
    const config: OpenCodeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const modelId = config.model; // e.g. "volcengine-plan/glm-5.1"
    if (!modelId) return 0;
    const [providerId, modelKey] = modelId.split('/');
    const provider = config.provider?.[providerId];
    const model = provider?.models?.[modelKey];
    return model?.limit?.context || 0;
  } catch (e) {
    return 0;
  }
}

class OpenCodeAgent extends Agent {
  opencodeSessionId: string | null;
  hubSessionId: string | null;
  options: OpenCodeOptions;
  activeProc: ChildProcess | null;
  pendingHistory: string | null;
  _lastStatusLine: string | null;

  constructor(workdir: string, options: OpenCodeOptions = {}) {
    super('opencode', workdir);
    // opencode自己的session ID（格式为 ses_xxx），从opencode返回的消息中获取
    this.opencodeSessionId = null;
    // agent-hub的sessionId，用于内部标识
    this.hubSessionId = options.sessionId || options.conversationId || null;
    this.options = options;
    // 当前正在运行的子进程引用，用于优雅地中断/退出
    this.activeProc = null;
    // 待注入的历史上下文
    this.pendingHistory = null;
    // 最近的一条命令行输出（用于替换成单行状态提示）
    this._lastStatusLine = null;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    // 先进行可用性自检，确保 OpenCode 可用再正式就绪
    const available = await this._checkOpencodeAvailability();
    if (!available) {
      this.isRunning = false;
      throw new Error('OpenCode 可用性检查失败，请确认 OpenCode 已安装并在 PATH 中可访问。');
    }
    this.emit('started');

    // 发送欢迎消息
    this.emit('message', {
      type: 'status',
      content: `✅ OpenCode 已就绪`
    });
  }

  /**
   * 发送消息给 OpenCode
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

    // 若已有正在运行的子进程，优雅地中止再启动新的会话
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGTERM');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
    }

    console.log('[OpenCode] 发送消息:', trimmed.substring(0, Math.min(100, trimmed.length)));
    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    // 如果有待注入的历史上下文， prepend 到消息中
    let finalMessage = trimmed;
    if (this.pendingHistory) {
      finalMessage = `[之前的对话上下文]\n${this.pendingHistory}\n\n[当前消息]\n${trimmed}`;
      this.pendingHistory = null;
    }

    return new Promise((resolve, reject) => {
      // 构建命令参数
      const args: string[] = ['run'];

      // 使用 --pure 避免 plugins 导致进程挂起
      args.push('--pure');

      // 恢复会话 - 只在有opencode自己的session ID时使用
      if (this.opencodeSessionId) {
        args.push('--session', this.opencodeSessionId);
      }

      // 指定模型
      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      // 指定agent类型（build/plan）
      if (this.options.agent) {
        args.push('--agent', this.options.agent);
      }

      // 推理强度
      if (this.options.variant) {
        args.push('--variant', this.options.variant);
      }

      // JSON格式输出
      args.push('--format', 'json');

      // 添加用户消息
      args.push(finalMessage);

      // 确保 PATH 包含 npm 全局目录
      const env = getEnvWithPath();

      console.log('[OpenCode] spawn:', OPENCODE_PATH, args.slice(0, 6).join(' '), '...');

      // 直接用 spawn 传递参数数组，避免 shell 转义问题
      const proc: ChildProcess = spawn(OPENCODE_PATH, args, {
        cwd: this.workdir,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // 关闭 stdin，防止 opencode 等待输入
      proc.stdin!.end();

      // 记录当前活跃进程，方便后续中止/清理
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
          console.log('[OpenCode stderr]:', text.substring(0, 200));
        }
      });

      proc.on('close', (code) => {
        // 处理 buffer 中剩余的内容
        if (buffer.trim()) {
          this.handleOutput(buffer.trim());
        }

        // 清理活跃进程引用
        this.activeProc = null;

        if (code !== 0 && !hasOutput) {
          const err = new Error(`OpenCode 退出码: ${code}`);
          console.error('[OpenCode] exit error:', err.message);
          this.emit('message', { type: 'error', content: `OpenCode 执行失败: ${err.message}` });
          reject(err);
        } else {
          // 通知会话 agent 已停止
          this.emit('stopped', { code: 0 });
          resolve();
        }
      });

      proc.on('error', (err: Error) => {
        console.error('[OpenCode] spawn error:', err.message);
        this.emit('message', { type: 'error', content: `OpenCode 执行失败: ${err.message}` });
        this.activeProc = null;
        reject(err);
      });
    });
  }

  /**
   * 处理 OpenCode 输出
   */
  handleOutput(line: string): void {
    try {
      const msg: OpenCodeJsonMessage = JSON.parse(line);
      this.handleJsonMessage(msg);
    } catch (e) {
      // 非JSON作为单行状态提示，待前端替换显示，避免多行占位
      this._lastStatusLine = line;
      this.emit('message', { type: 'status', content: line, replace: true });
    }
  }

  // 简单可用性自检：尝试获取版本，避免直接在不可用时进入错误状态
  async _checkOpencodeAvailability(): Promise<boolean> {
    try {
      const env = getEnvWithPath();
      const cmd = `${OPENCODE_PATH} --version < /dev/null 2>/dev/null`;
      const { stdout } = await execAsync(cmd, { timeout: 10000, env, maxBuffer: 1024 * 1024 });
      console.log('[OpenCode] 版本信息:', stdout.trim());
      return true;
    } catch (e) {
      console.warn('[OpenCode] 可用性检查失败:', (e as Error).message);
      // 即使检查失败，也返回true，让实际执行时再报错
      // 这样可以避免因为检查超时导致整个session启动失败
      return true;
    }
  }

  /**
   * 处理JSON消息 - OpenCode 实际输出格式
   */
  handleJsonMessage(msg: OpenCodeJsonMessage): void {
    try {
      // OpenCode 格式: { type: "text", part: { type: "text", text: "..." } }
      if (msg.type === 'text' && msg.part?.text) {
        // 重置最近的状态行，因为现在有正式文本输出
        this._lastStatusLine = null;
        console.log('[OpenCode] emit text:', msg.part.text.substring(0, 100));
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
              contextWindow: getOpenCodeContextWindow(),
              cost: t.cost || 0,
              model: this.options.model || 'opencode'
            }
          });
        }
        // 保存 opencode自己的sessionID
        if (msg.sessionID) {
          this.opencodeSessionId = msg.sessionID;
          this.emit('message', {
            type: 'conversation_id',
            content: this.opencodeSessionId,
            conversationId: this.opencodeSessionId
          });
        }
      } else if (msg.type === 'tool_use' || msg.type === 'tool') {
        this.emit('message', {
          type: 'tool_use',
          content: JSON.stringify(msg.input || msg.args || msg.part?.input || {}, null, 2),
          metadata: { tool: msg.name || msg.tool || msg.part?.tool }
        });
      } else if (msg.type === 'tool_result' || msg.type === 'result') {
        if (msg.content || msg.output || msg.part?.content) {
          this.emit('message', {
            type: 'tool_result',
            content: String(msg.content || msg.output || msg.part?.content)
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
      console.error('[OpenCode] 处理消息异常:', (e as Error).message);
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
    // 保留 opencodeSessionId 以便恢复会话时可以继续对话
    this.emit('stopped', { code: 0 });
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt(): Promise<void> {
    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGKILL');
      } catch (e) { /* ignore */ }
      this.activeProc = null;
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' });
    }
  }

  static healthCheck(): HealthCheckResult {
    try {
      execSync(`"${OPENCODE_PATH}" --version`, { stdio: 'ignore' });
      return { ok: true, info: 'OpenCode available' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export default OpenCodeAgent;
