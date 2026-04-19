/**
 * OpenCode Agent适配器
 * 使用 opencode run 命令进行对话，支持会话恢复
 */
const Agent = require('./base');
const { spawn } = require('child_process');

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

      const proc = spawn(opencodePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
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
   * 处理JSON消息
   */
  handleJsonMessage(msg) {
    // OpenCode 的 JSON 输出格式
    if (msg.type === 'assistant' || msg.type === 'message') {
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
    } else if (msg.type === 'tool_result' || msg.type === 'result') {
      if (msg.content || msg.output) {
        this.emit('message', {
          type: 'tool_result',
          content: String(msg.content || msg.output)
        });
      }
    } else if (msg.type === 'error') {
      this.emit('message', {
        type: 'error',
        content: msg.message || msg.error || JSON.stringify(msg)
      });
    } else if (msg.type === 'session' || msg.session_id) {
      // 保存会话ID
      this.sessionId = msg.session_id || msg.id || msg.sessionId;
      this.emit('message', {
        type: 'conversation_id',
        content: this.sessionId,
        conversationId: this.sessionId
      });
    } else if (msg.type === 'usage' || msg.usage) {
      // Token 使用统计
      const usage = msg.usage || msg;
      this.emit('message', {
        type: 'token_usage',
        content: {
          inputTokens: usage.input_tokens || usage.promptTokens || 0,
          outputTokens: usage.output_tokens || usage.completionTokens || 0,
          cost: usage.cost || 0,
          model: usage.model || 'unknown'
        }
      });
    } else if (msg.type === 'done' || msg.type === 'complete') {
      // 完成标记，不做额外处理
    } else {
      // 未知消息类型，作为文本显示
      const text = msg.content || msg.text || msg.message || JSON.stringify(msg);
      if (text && text !== '{}') {
        this.emit('message', { type: 'text', content: String(text) });
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
