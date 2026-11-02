/**
 * OpenCode Agent适配器
 * 使用 opencode run 命令进行对话，支持会话恢复
 */
import Agent from './base';
import { exec, execSync, spawn, ChildProcess, ExecOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentOptions } from '../types';

interface OpenCodeOptions extends AgentOptions {
  model?: string;
  agent?: string;
  mode?: string;
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
    reason?: string;
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
  error?: string | { message?: string; name?: string };
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
function getOpenCodeContextWindow(modelId?: string): number {
  try {
    // 先尝试从配置文件读取
    const configPath = path.join(process.env.HOME || '/root', '.config', 'opencode', 'opencode.json');
    const config: OpenCodeConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const cfgModelId = modelId || config.model;
    if (cfgModelId) {
      const [providerId, modelKey] = cfgModelId.split('/');
      const provider = config.provider?.[providerId];
      const model = provider?.models?.[modelKey];
      if (model?.limit?.context) return model.limit.context;
    }

    // 配置文件没有，从 opencode models --verbose 获取
    const output = execSync(`${OPENCODE_PATH} models --verbose`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const targetModel = modelId || 'opencode/mimo-v2.5-free';
    const modelShort = targetModel.includes('/') ? targetModel.split('/').pop()! : targetModel;
    // 按空行或模型名分割，找匹配的 JSON 块
    const blocks = output.split(/(?=^opencode\/)/m);
    for (const block of blocks) {
      if (block.includes(modelShort) || block.includes(targetModel)) {
        const jsonMatch = block.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const obj = JSON.parse(jsonMatch[0]);
          if (obj.limit?.context) return obj.limit.context;
        }
      }
    }
  } catch (e) {
    // ignore
  }
  return 200000;
}

class OpenCodeAgent extends Agent {
  opencodeSessionId: string | null;
  hubSessionId: string | null;
  options: OpenCodeOptions;
  activeProc: ChildProcess | null;
  pendingHistory: string | null;
  _lastStatusLine: string | null;
  // 本次 run 是否已收到最终 step_finish（reason=stop）
  _sawFinalStep: boolean;
  // 本次 run 是否已从 stdout 收到 error 事件
  _stdoutErrorSeen: boolean;
  // 本次 run 已上报过的日志错误（去重）
  _reportedLogErrors: Set<string>;
  contextWindow: number;

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
    this._sawFinalStep = false;
    this._stdoutErrorSeen = false;
    this._reportedLogErrors = new Set();
    this.contextWindow = 200000; // 默认值，start() 时从配置获取实际值
  }

  async start(): Promise<void> {
    this.isRunning = true;
    // 先进行可用性自检，确保 OpenCode 可用再正式就绪
    const available = await this._checkOpencodeAvailability();
    if (!available) {
      this.isRunning = false;
      throw new Error('OpenCode 可用性检查失败，请确认 OpenCode 已安装并在 PATH 中可访问。');
    }

    // 获取模型的上下文窗口大小
    this.contextWindow = getOpenCodeContextWindow(this.options.model);

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

    // 拦截 /compact 命令 - opencode run 模式不支持内部命令，通过事件通知 session manager 处理
    if (trimmed === '/compact') {
      console.log('[OpenCode] 检测到 /compact 命令，通知 session manager 处理');
      this.emit('compact', { agentType: 'opencode', workdir: this.workdir });
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

      // 显式指定工作目录，确保 CLI 在正确的项目路径下运行
      args.push('--dir', this.workdir);

      // 恢复会话 - 只在有opencode自己的session ID时使用
      if (this.opencodeSessionId) {
        args.push('--session', this.opencodeSessionId);
      }

      // 指定模型
      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      // 指定agent类型（build/plan）：优先用 agent，否则从 mode 映射
      const agentType = this.options.agent || this.options.mode;
      if (agentType) {
        args.push('--agent', agentType);
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
      let stderrTail = '';
      let hasOutput = false;
      let timedOut = false;

      // 重置本次运行的完成/错误追踪
      this._sawFinalStep = false;
      this._stdoutErrorSeen = false;
      this._reportedLogErrors = new Set();

      // ===== 无输出看门狗 =====
      // opencode 挂住（如免费额度耗尽后进程不退出）会导致会话 isWorking 永远为 true，
      // 前端输入框一直禁用——先提示，超时后强制终止并明确报错
      let warnTimer: ReturnType<typeof setTimeout> | null = null;
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const clearWatchdog = (): void => {
        if (warnTimer) clearTimeout(warnTimer);
        if (killTimer) clearTimeout(killTimer);
        warnTimer = null;
        killTimer = null;
      };
      const resetWatchdog = (): void => {
        clearWatchdog();
        warnTimer = setTimeout(() => {
          this.emit('message', {
            type: 'status',
            content: '⏳ OpenCode 已 5 分钟无输出（可能是免费模型用量受限或网络问题），继续等待中...'
          });
        }, 5 * 60 * 1000);
        killTimer = setTimeout(() => {
          timedOut = true;
          this.emit('message', {
            type: 'error',
            content: 'OpenCode 超时：15 分钟无输出，已自动终止本次任务。若使用的是免费模型，很可能已达到使用次数上限，请稍后重试或更换模型。'
          });
          try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        }, 15 * 60 * 1000);
      };
      resetWatchdog();

      // ===== 免费额度/流错误检测 =====
      // opencode 把 stream error（如 Free usage limit reached）只写进日志文件，
      // 不输出到 stdout/stderr，这里主动监视日志，第一时间把错误显示到状态栏
      const opencodeLogPath = path.join(process.env.HOME || '/root', '.local/share/opencode/log/opencode.log');
      const runStartedAt = new Date().toISOString();
      let logOffset = 0;
      try { logOffset = fs.statSync(opencodeLogPath).size; } catch { /* 日志不存在则跳过 */ }

      const readNewLogErrors = (): string[] => {
        const found: string[] = [];
        try {
          const stat = fs.statSync(opencodeLogPath);
          if (stat.size <= logOffset) return found;
          const len = Math.min(stat.size - logOffset, 1024 * 1024);
          const buf = Buffer.alloc(len);
          const fd = fs.openSync(opencodeLogPath, 'r');
          try { fs.readSync(fd, buf, 0, len, logOffset); } finally { fs.closeSync(fd); }
          logOffset += len;
          for (const line of buf.toString('utf8').split('\n')) {
            if (!line.includes('level=ERROR')) continue;
            const ts = line.match(/timestamp=(\S+)/)?.[1];
            if (!ts || ts < runStartedAt) continue;
            const text = line.match(/error\.error="([^"]*)"/)?.[1]
              || line.match(/message="([^"]*)"/)?.[1]
              || line.slice(0, 300);
            if (!text || this._reportedLogErrors.has(text)) continue;
            this._reportedLogErrors.add(text);
            found.push(text);
          }
        } catch { /* 读取失败忽略 */ }
        return found;
      };

      const reportError = (text: string): void => {
        const isUsageLimit = /usage limit|rate limit|quota|限额|用量/i.test(text);
        this.emit('message', {
          type: 'error',
          content: isUsageLimit
            ? `OpenCode 免费模型用量受限：${text}`
            : `OpenCode 错误：${text}`
        });
      };

      const logWatcher = setInterval(() => {
        if (this._stdoutErrorSeen) { clearInterval(logWatcher); return; }
        for (const text of readNewLogErrors()) reportError(text);
      }, 10000);

      const cleanupRun = (): void => {
        clearWatchdog();
        clearInterval(logWatcher);
      };

      // 实时处理 stdout 输出
      proc.stdout!.on('data', (data: Buffer) => {
        hasOutput = true;
        resetWatchdog();
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
        const text = data.toString();
        stderrTail = (stderrTail + text).slice(-2000);
        const trimmed = text.trim();
        if (trimmed) {
          console.log('[OpenCode stderr]:', trimmed.substring(0, 200));
        }
      });

      proc.on('close', (code) => {
        cleanupRun();

        // 处理 buffer 中剩余的内容
        if (buffer.trim()) {
          this.handleOutput(buffer.trim());
        }

        // 只清理仍属于本次运行的进程引用（避免被中断/顶替后的旧进程误清新进程）
        const isCurrent = this.activeProc === proc;
        if (isCurrent) {
          this.activeProc = null;
        }

        if (timedOut) {
          // 超时错误已在看门狗中上报
          this.emit('stopped', { code: 0 });
          resolve();
          return;
        }

        if (code !== 0 && code !== null && !hasOutput) {
          const detail = stderrTail.trim() || readNewLogErrors().join('; ');
          const err = new Error(`OpenCode 退出码: ${code}${detail ? ` — ${detail.slice(-300)}` : ''}`);
          console.error('[OpenCode] exit error:', err.message);
          this.emit('message', { type: 'error', content: `OpenCode 执行失败: ${err.message}` });
          reject(err);
          return;
        }

        // 运行提前结束（没有收到最终 step_finish）且不是被中断/被下一条消息顶掉：
        // 先查日志报出真实错误（如免费额度耗尽），否则给出通用诊断
        if (isCurrent && !this._sawFinalStep && !this._stdoutErrorSeen) {
          const logErrors = readNewLogErrors();
          if (logErrors.length > 0) {
            reportError(logErrors[0]);
          } else {
            const reason = code === null ? '进程被终止' : `退出码 ${code}`;
            const detail = stderrTail.trim();
            this.emit('message', {
              type: 'error',
              content: `OpenCode 运行提前结束（${reason}），未收到最终回复。${detail ? `stderr: ${detail.slice(-300)}` : '可能是免费模型用量受限或进程异常，请重试。'}`
            });
          }
        }

        // 通知会话 agent 已停止
        this.emit('stopped', { code: 0 });
        resolve();
      });

      proc.on('error', (err: Error) => {
        cleanupRun();
        console.error('[OpenCode] spawn error:', err.message);
        this.emit('message', { type: 'error', content: `OpenCode 执行失败: ${err.message}` });
        if (this.activeProc === proc) {
          this.activeProc = null;
        }
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
        if (msg.part?.reason === 'stop') {
          // 正常结束标记（用于识别运行提前终止）
          this._sawFinalStep = true;
        }
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
        this._stdoutErrorSeen = true;
        // error 可能是字符串也可能是对象，必须转成字符串，否则前端 setStatusMessage(对象) 会导致 React 崩溃
        let text: string;
        if (msg.message) {
          text = String(msg.message);
        } else if (typeof msg.error === 'string') {
          text = msg.error;
        } else if (msg.error && typeof msg.error === 'object') {
          const e = msg.error as { message?: string; name?: string };
          text = String(e.message || e.name || JSON.stringify(e));
        } else {
          text = JSON.stringify(msg);
        }
        const isUsageLimit = /usage limit|rate limit|quota|限额|用量/i.test(text);
        this.emit('message', {
          type: 'error',
          content: isUsageLimit ? `OpenCode 免费模型用量受限：${text}` : text
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
