/**
 * OpenCode Agent适配器
 * 使用 opencode run 命令进行对话，支持会话恢复
 */
const Agent = require('./base');
const { exec, execSync } = require('child_process');
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
  }

  async start() {
    this.isRunning = true;
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

    console.log('[OpenCode] 发送消息:', message.substring(0, 100));
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
      args.push(message);

      // 确保 PATH 包含 npm 全局目录
      const env = getEnvWithPath();

      // 通过 shell 执行，解决二进制 stdout 缓冲问题
      const shellCmd = `${OPENCODE_PATH} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')} < /dev/null`;

      console.log('[OpenCode] exec:', shellCmd.substring(0, 200));

      execAsync(shellCmd, {
        cwd: this.workdir,
        env,
        timeout: 120000
      }).then(({ stdout }) => {
        // 处理 stdout 输出
        if (stdout) {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              this.handleOutput(line.trim());
            }
          }
        }
        resolve();
      }).catch((err) => {
        // exec 超时时也会有 stdout 输出
        if (err.stdout) {
          const lines = err.stdout.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              this.handleOutput(line.trim());
            }
          }
          resolve();
        } else {
          console.error('[OpenCode] exec error:', err.message);
          this.emit('message', { type: 'error', content: `OpenCode 执行失败: ${err.message}` });
          reject(err);
        }
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
      // 非JSON作为纯文本
      this.emit('message', { type: 'text', content: line });
    }
  }

  /**
   * 处理JSON消息 - OpenCode 实际输出格式
   */
  handleJsonMessage(msg) {
    // OpenCode 格式: { type: "text", part: { type: "text", text: "..." } }
    if (msg.type === 'text' && msg.part?.text) {
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
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isRunning = false;
    this.sessionId = null;
    this.emit('stopped', { code: 0 });
  }
}

module.exports = OpenCodeAgent;
