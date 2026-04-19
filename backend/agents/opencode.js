/**
 * OpenCode Agent适配器
 * 使用 opencode run 命令进行对话，支持会话恢复
 */
const Agent = require('./base');
const { spawn, execSync } = require('child_process');

// 获取 npm 全局 bin 目录
function getNpmGlobalBin() {
  try {
    return execSync('npm config get prefix', { encoding: 'utf-8' }).trim() + '/bin';
  } catch (e) {
    return null;
  }
}

// 确保 PATH 包含 npm 全局目录
function getEnvWithPath() {
  const env = { ...process.env };
  const npmBin = getNpmGlobalBin();
  if (npmBin && env.PATH && !env.PATH.includes(npmBin)) {
    env.PATH = npmBin + ':' + env.PATH;
  }
  return env;
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

    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    return new Promise((resolve, reject) => {
      const opencodePath = process.env.OPENCODE_CLI_PATH || 'opencode';

      // 构建命令参数
      const args = ['run', message];

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

      // 确保 PATH 包含 npm 全局目录
      const env = getEnvWithPath();

      const proc = spawn(opencodePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let hasOutput = false;

      proc.stdout.on('data', (data) => {
        hasOutput = true;
        stdoutBuffer += data.toString();

        // 按行解析JSON
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop();

        for (const line of lines) {
          if (line.trim()) {
            this.handleOutput(line.trim());
          }
        }
      });

      proc.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        const msg = data.toString().trim();
        if (msg && !msg.includes('node') && !msg.includes('ExperimentalWarning')) {
          console.error('[OpenCode stderr]:', msg);
        }
      });

      proc.on('close', (code) => {
        // 处理剩余stdout
        if (stdoutBuffer.trim()) {
          this.handleOutput(stdoutBuffer.trim());
        }

        // 如果没有JSON输出，尝试纯文本解析
        if (!hasOutput && stderrBuffer.trim()) {
          this.emit('message', { type: 'text', content: stderrBuffer.trim() });
        }

        if (!hasOutput && !stderrBuffer.trim()) {
          this.emit('message', {
            type: 'error',
            content: 'OpenCode 没有返回输出，请检查配置'
          });
        }

        resolve();
      });

      proc.on('error', (err) => {
        if (err.code === 'ENOENT') {
          this.emit('message', {
            type: 'error',
            content: 'OpenCode 未安装，请先安装: npm install -g opencode-ai'
          });
        } else {
          this.emit('message', {
            type: 'error',
            content: `启动失败: ${err.message}`
          });
        }
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
