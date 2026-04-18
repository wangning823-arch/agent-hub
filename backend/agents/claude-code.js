/**
 * Claude Code Agent适配器
 * 使用 --print --continue 模式，每次调用保持对话历史
 */
const Agent = require('./base');
const { spawn } = require('child_process');
const path = require('path');

class ClaudeCodeAgent extends Agent {
  constructor(workdir, options = {}) {
    super('claude-code', workdir);
    this.conversationId = options.conversationId || null; // 支持恢复已有对话
    this.options = options;
  }

  async start() {
    // Claude Code 不需要长期运行的进程
    // 每次发消息时启动一个新进程，用 --continue 保持历史
    this.isRunning = true;
    this.emit('started');
    
    // 发送欢迎消息
    this.emit('message', {
      type: 'text',
      content: `✅ Claude Code 已就绪\n📁 工作目录: ${this.workdir}\n💬 发送消息开始对话`
    });
  }

  /**
   * 发送消息给Claude Code
   */
  async send(message) {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    return new Promise((resolve, reject) => {
      // 直接调用 Claude Code CLI（不使用 wrapper 脚本）
      const claudePath = process.env.CLAUDE_CLI_PATH || 'claude';

      // 构建命令参数
      const args = [
        '--print',
        '--verbose',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json'
      ];

      // 指定模型（如果用户选了的话）
      if (this.options.model) {
        args.push('--model', this.options.model);
      }
      
      // 添加模式参数
      if (this.options.mode) {
        args.push('--permission-mode', this.options.mode);
      }
      
      // 添加努力程度参数
      if (this.options.effort) {
        args.push('--effort', this.options.effort);
      }
      
      // 如果有之前的对话，使用 --resume 保持上下文
      if (this.conversationId) {
        args.push('--resume', this.conversationId);
      } else {
        args.push('--continue');
      }
      
      // 添加用户消息
      args.push('-p', message);

      const proc = spawn(claudePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env
        }
      });

      let buffer = '';
      let hasOutput = false;

      proc.stdout.on('data', (data) => {
        hasOutput = true;
        buffer += data.toString();
        
        // 按行解析
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
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

      proc.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('Loaded') && !msg.includes('model')) {
          console.error('[Claude stderr]:', msg);
        }
      });

      proc.on('close', (code) => {
        // 处理剩余buffer
        if (buffer.trim()) {
          try {
            const msg = JSON.parse(buffer);
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
        
        resolve();
      });

      proc.on('error', (err) => {
        this.emit('message', { 
          type: 'error', 
          content: `启动失败: ${err.message}` 
        });
        reject(err);
      });
    });
  }

  /**
   * 处理stream-json消息
   */
  handleStreamMessage(msg) {
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
        this.emit('message', {
          type: 'token_usage',
          content: {
            inputTokens: msg.usage.input_tokens || 0,
            outputTokens: msg.usage.output_tokens || 0,
            cacheReadTokens: msg.usage.cache_read_input_tokens || 0,
            cacheWriteTokens: msg.usage.cache_creation_input_tokens || 0,
            cost: msg.total_cost_usd || 0,
            model: msg.modelUsage ? Object.keys(msg.modelUsage)[0] : 'unknown'
          }
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
  async approve(approvalId, allow = true) {
    console.log(`[权限] ${allow ? '允许' : '拒绝'} ${approvalId}`);
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
   * 停止Agent
   */
  async stop() {
    this.isRunning = false;
    this.conversationId = null;
    this.emit('stopped', { code: 0 });
  }
}

module.exports = ClaudeCodeAgent;
