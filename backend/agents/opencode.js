/**
 * OpenCode Agent适配器
 * 使用 opencode run 命令进行对话，支持会话恢复
 */
const Agent = require('./base');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');

// 尝试查找 opencode 可执行文件路径（优先找实际二进制，跳过 wrapper）
function findOpencodePath() {
  // 常见的实际二进制路径
  const candidates = [
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

const OPENCODE_PATH = findOpencodePath();
console.log('[OpenCode] 使用路径:', OPENCODE_PATH);

// 确保 PATH 包含 npm 全局目录
function getEnvWithPath() {
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
function execAsync(cmd, options) {
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

class OpenCodeAgent extends Agent {
  constructor(workdir, options = {}) {
    super('opencode', workdir);
    this.sessionId = options.sessionId || null;
    this.options = options;
    // 当前正在运行的子进程引用，用于优雅地中断/退出
    this.activeProc = null;
    // 最近的一条命令行输出（用于替换成单行状态提示）
    this._lastStatusLine = null;
  }

  async start() {
    this.isRunning = true;
    // 先进行可用性自检，确保 OpenCode 可用再正式就绪
    const available = await this._checkOpencodeAvailability();
    if (!available) {
      this.isRunning = false;
      this.emit('message', {
        type: 'error',
        content: 'OpenCode 可用性检查失败，请确认 OpenCode 已安装并在 PATH 中可访问。'
      });
      return;
    }
    this.emit('started');

    // 发送欢迎消息
    this.emit('message', {
      type: 'text',
      content: `✅ OpenCode 已就绪\n📁 工作目录: ${this.workdir}\n💬 发送消息开始对话`
    });
  }

  /**
   * 发送消息给 OpenCode
   */
  async send(message) {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    // 简单校验输入
    if (typeof message !== 'string') message = String(message);
    const trimmed = message.trim();
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

    return new Promise((resolve, reject) => {
      // 构建命令参数
      const args = ['run'];

      // 使用 --pure 避免 plugins 导致进程挂起
      args.push('--pure');

      // 恢复会话
      if (this.sessionId) {
        args.push('--session', this.sessionId);
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
      args.push(trimmed);

      // 确保 PATH 包含 npm 全局目录
      const env = getEnvWithPath();

      console.log('[OpenCode] spawn:', OPENCODE_PATH, args.slice(0, 6).join(' '), '...');

      // 使用 spawn + shell 模式实现流式输出
      const shellArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
      const proc = spawn('sh', ['-c', `${OPENCODE_PATH} ${shellArgs} < /dev/null`], {
        cwd: this.workdir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true
      });

      // 记录当前活跃进程，方便后续中止/清理
      this.activeProc = proc;

      let buffer = '';
      let hasOutput = false;

      // 实时处理 stdout 输出
      proc.stdout.on('data', (data) => {
        hasOutput = true;
        buffer += data.toString();
        // 按行处理
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留最后一个不完整的行
        for (const line of lines) {
          if (line.trim()) {
            this.handleOutput(line.trim());
          }
        }
      });

      proc.stderr.on('data', (data) => {
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
          resolve();
        }
      });

      proc.on('error', (err) => {
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
  handleOutput(line) {
    try {
      const msg = JSON.parse(line);
      this.handleJsonMessage(msg);
    } catch (e) {
      // 非JSON作为单行状态提示，待前端替换显示，避免多行占位
      this._lastStatusLine = line;
      this.emit('message', { type: 'status', content: line, replace: true });
    }
  }

  // 简单可用性自检：尝试获取版本，避免直接在不可用时进入错误状态
  async _checkOpencodeAvailability() {
    try {
      const env = getEnvWithPath();
      const cmd = `${OPENCODE_PATH} --version < /dev/null 2>/dev/null`;
      const { stdout } = await execAsync(cmd, { timeout: 10000, env, maxBuffer: 1024 * 1024 });
      console.log('[OpenCode] 版本信息:', stdout.trim());
      return true;
    } catch (e) {
      console.warn('[OpenCode] 可用性检查失败:', e.message);
      // 即使检查失败，也返回true，让实际执行时再报错
      // 这样可以避免因为检查超时导致整个session启动失败
      return true;
    }
  }

  /**
   * 处理JSON消息 - OpenCode 实际输出格式
   */
  handleJsonMessage(msg) {
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
            cost: t.cost || 0,
            model: 'opencode'
          }
        });
      }
      // 保存 sessionID
      if (msg.sessionID) {
        this.sessionId = msg.sessionID;
        this.emit('message', {
          type: 'conversation_id',
          content: this.sessionId,
          conversationId: this.sessionId
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
      console.error('[OpenCode] 处理消息异常:', e.message);
      this.emit('message', { type: 'error', content: `消息处理异常: ${e.message}` });
    }
  }

  /**
   * 更新配置选项
   */
  updateOptions(updates) {
    Object.assign(this.options, updates);
    this.emit('message', {
      type: 'status',
      content: `⚙️ 配置已更新: ${Object.keys(updates).join(', ')}`
    });
  }

  /**
   * 停止 Agent
   */
  async stop() {
    if (this.activeProc) {
      const pid = this.activeProc.pid;
      try {
        // 杀整个进程组（负PID），确保sh子进程里的opencode也被杀掉
        process.kill(-pid, 'SIGKILL');
      } catch (e) {
        try { this.activeProc.kill('SIGKILL'); } catch (e2) { /* ignore */ }
      }
      this.activeProc = null;
    }
    this.isRunning = false;
    this.sessionId = null;
    this.emit('stopped', { code: 0 });
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt() {
    if (this.activeProc) {
      const pid = this.activeProc.pid;
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (e) {
        try { this.activeProc.kill('SIGKILL'); } catch (e2) { /* ignore */ }
      }
      this.activeProc = null;
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' });
    }
  }

  static healthCheck() {
    try {
      const { execSync } = require('child_process');
      const opPath = typeof OPENCODE_PATH !== 'undefined' ? OPENCODE_PATH : 'opencode';
      execSync(`"${opPath}" --version`, { stdio: 'ignore' });
      return { ok: true, info: 'OpenCode available' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = OpenCodeAgent;
