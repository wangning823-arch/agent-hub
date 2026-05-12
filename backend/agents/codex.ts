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
  thread_id?: string;
}

// 获取 npm 全局 bin 目录
function getNpmGlobalBin(): string | null {
  try {
    return execSync('npm config get prefix', { encoding: 'utf-8' }).trim() + '/bin';
  } catch (e) {
    return null;
  }
}

/**
 * 根据当前选择的模型更新全局 config.toml
 * 确保 model_provider 和对应的 [model_providers.xxx] section 匹配当前模型的 provider
 * 注意：Node.js 单线程，write 和 spawn 在同一事件循环中，不会被中断
 */
function updateCodexConfig(model: string): void {
  if (!model || !model.includes('/')) return;
  const [providerId, ...modelParts] = model.split('/');
  const modelId = modelParts.join('/');
  if (!providerId || !modelId) return;

  try {
    const { getDb } = require('../db');
    const db = getDb();
    if (!db) return;

    const result = db.exec(`SELECT base_url FROM providers WHERE id = '${providerId.replace(/'/g, "''")}'`);
    if (result.length === 0 || result[0].values.length === 0) return;
    const baseUrl = result[0].values[0][0] as string;

    const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || '/root', '.codex');
    const configPath = path.join(codexHome, 'config.toml');
    if (!fs.existsSync(configPath)) return;

    let content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    const sectionHeader = `[model_providers.${providerId}]`;

    let foundModel = false;
    let foundProvider = false;
    let foundProviderSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^model\s*=/)) {
        newLines.push(`model = "${modelId}"`);
        foundModel = true;
      } else if (line.match(/^model_provider\s*=/)) {
        newLines.push(`model_provider = "${providerId}"`);
        foundProvider = true;
      } else if (line.trim() === sectionHeader) {
        newLines.push(sectionHeader);
        newLines.push(`name = "${providerId}"`);
        newLines.push(`env_key = "${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY"`);
        newLines.push(`base_url = "${baseUrl}"`);
        newLines.push(`wire_api = "chat"`);
        foundProviderSection = true;
        // 跳过旧 section 的内容行（直到下一个 [section] 或文件结束）
        while (i + 1 < lines.length && !lines[i + 1].trim().startsWith('[')) {
          i++;
        }
      } else {
        newLines.push(line);
      }
    }

    if (!foundModel) newLines.push(`model = "${modelId}"`);
    if (!foundProvider) newLines.push(`model_provider = "${providerId}"`);
    if (!foundProviderSection) {
      newLines.push('');
      newLines.push(sectionHeader);
      newLines.push(`name = "${providerId}"`);
      newLines.push(`env_key = "${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY"`);
      newLines.push(`base_url = "${baseUrl}"`);
      newLines.push(`wire_api = "chat"`);
    }

    fs.writeFileSync(configPath, newLines.join('\n'));
  } catch (e) {
    console.error('[Codex] 更新 config.toml 失败:', (e as Error).message);
  }
}

// 构建 Codex 运行环境变量（包含 PATH 和所有 provider 的 API key）
// Codex 根据 config.toml 中的 model_provider 读取对应的 env_key，
// 所以需要设置所有可能的 provider API key，确保无论 config.toml 怎么配都能找到
function getCodexEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const npmBin = getNpmGlobalBin();
  if (npmBin && env.PATH && !env.PATH.includes(npmBin)) {
    env.PATH = npmBin + ':' + env.PATH;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDb } = require('../db');
    const db = getDb();
    if (db) {
      // 获取所有 provider 的 API key，全部设置到环境变量
      const result = db.exec("SELECT id, api_key FROM providers WHERE api_key IS NOT NULL AND api_key != ''");
      if (result.length > 0) {
        for (const row of result[0].values) {
          const [providerId, apiKey] = row;
          if (providerId && apiKey) {
            const envVarName = `${(providerId as string).toUpperCase().replace(/-/g, '_')}_API_KEY`;
            env[envVarName] = apiKey as string;
          }
        }
      }
    }
  } catch (e) {
    console.error('[Codex] 设置 API key 环境变量失败:', (e as Error).message);
  }

  return env;
}

class CodexAgent extends Agent {
  options: CodexOptions;
  activeProc: ChildProcess | null;
  codexSessionId: string | null;

  constructor(workdir: string, options: CodexOptions = {}) {
    super('codex', workdir);
    this.options = options;
    this.activeProc = null;
    // 恢复会话时从 conversationId 恢复 codex session
    this.codexSessionId = (options as any).conversationId || null;
  }

  /**
   * 更新选项时同步 conversationId 到 codexSessionId
   */
  updateOptions(newOptions: Record<string, unknown>): void {
    super.updateOptions(newOptions);
    if (newOptions.conversationId) {
      this.codexSessionId = newOptions.conversationId as string;
    }
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
    // Codex 要求在 git 仓库内运行，如果不是则自动初始化
    if (!this.isGitRepo(this.workdir)) {
      try {
        execSync('git init', { cwd: this.workdir, stdio: 'ignore' });
        console.log(`[Codex] 自动初始化 git 仓库: ${this.workdir}`);
      } catch (e) {
        this.isRunning = false;
        throw new Error('Codex 需要在 git 仓库内运行，且无法自动初始化: ' + (e as Error).message);
      }
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
   * 首次用 codex exec 获取 session_id，后续用 codex resume 保持会话连续性
   */
  async send(message: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    return new Promise((resolve, reject) => {
      const codexPath = process.env.CODEX_CLI_PATH || 'codex';

      // 根据当前选择的模型动态更新 config.toml 的 model_provider 和 section
      const fullModel = this.options.model || '';
      updateCodexConfig(fullModel);

      // 提取 model_id 部分传给 --model 参数
      let modelId = fullModel;
      if (modelId.includes('/')) {
        modelId = modelId.split('/').slice(1).join('/');
      }

      // 构建命令参数：首次用 exec，后续用 resume 保持会话
      const args: string[] = [];
      const isResume = !!this.codexSessionId;
      if (isResume) {
        args.push('resume', this.codexSessionId!);
      } else {
        args.push('exec');
      }

      // 自动批准模式
      if (this.options.fullAuto !== false) {
        args.push('--full-auto');
      }

      // 指定模型
      if (modelId) {
        args.push('--model', modelId);
      }

      // JSON 输出以便解析 session_id（仅 exec 支持 --json，resume 不支持）
      if (!isResume) {
        args.push('--json');
      }

      // 添加用户消息（长度截断，防止超大输入导致崩溃）
      let userMessage = message;
      const MAX_INPUT_SIZE = 8000;
      if (typeof userMessage === 'string' && userMessage.length > MAX_INPUT_SIZE) {
        userMessage = userMessage.substring(0, MAX_INPUT_SIZE);
        this.emit('message', { type: 'status', content: '⚠️ 输入过长，已截断以确保处理稳定' });
      }
      args.push(userMessage);

      console.log(`[Codex] 执行: codex ${args.slice(0, 2).join(' ')} (session: ${this.codexSessionId || 'new'})`);

      // 设置所有 provider 的 API key 环境变量
      const proc: ChildProcess = spawn(codexPath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getCodexEnv()
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

      proc.on('close', (code) => {
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

        console.log(`[Codex] 进程退出，exit code: ${code}, session: ${this.codexSessionId || 'none'}`);

        this.activeProc = null;
        // 注意：不在这里 emit stopped，让会话保持活跃以便后续 resume
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
    // 捕获 session_id 用于后续 resume
    if (msg.type === 'thread.started' && msg.thread_id) {
      this.codexSessionId = msg.thread_id;
      console.log(`[Codex] 获取 session_id: ${this.codexSessionId}`);
      this.emit('message', {
        type: 'conversation_id',
        conversationId: this.codexSessionId
      } as any);
    } else if (msg.type === 'item.completed') {
      // codex 输出的 item.completed 包含 agent 消息文本
      const item = (msg as any).item;
      if (item && item.type === 'agent_message' && item.text) {
        this.emit('message', { type: 'text', content: String(item.text) });
      }
    } else if (msg.type === 'message' || msg.type === 'assistant') {
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
    } else if (msg.type === 'turn.failed') {
      // resume 失败时清除 session_id，下次回退到 exec 重新开始
      console.log(`[Codex] turn.failed，清除 session_id 以便下次重新开始`);
      this.codexSessionId = null;
      this.emit('message', {
        type: 'error',
        content: '会话恢复失败，下次将开启新对话（之前的上下文可能丢失）'
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
    } else if (msg.type === 'turn.completed') {
      const usage = (msg as any).usage;
      if (usage) {
        this.emit('message', {
          type: 'token_usage',
          content: JSON.stringify({
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            cost: usage.cost || 0,
            model: usage.model || 'unknown'
          })
        });
      }
    } else if (msg.type === 'diff' || msg.type === 'file_change') {
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
