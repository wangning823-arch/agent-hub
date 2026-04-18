/**
 * Claude API Agent适配器
 * 直接使用 Anthropic SDK，不依赖 CLI
 */
const Agent = require('./base');
const client = require('../claude-client');

class ClaudeApiAgent extends Agent {
  constructor(workdir, options = {}) {
    super('claude-api', workdir);
    this.options = options;
    this.messages = [];           // 多轮对话历史 [{role, content}]
    this.conversationId = options.conversationId || null;
    this.model = options.model || 'claude-opus-4-6';
    this.abortController = null;  // 用于取消正在进行的请求
  }

  async start() {
    this.isRunning = true;
    this.emit('started');
    this.emit('message', {
      type: 'text',
      content: `Claude API Agent 已就绪\n📁 工作目录: ${this.workdir}\n🤖 模型: ${this.model}\n💬 发送消息开始对话`
    });
  }

  /**
   * 发送消息给 Claude API（流式）
   */
  async send(message) {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    // 添加用户消息到历史
    this.messages.push({ role: 'user', content: message });

    try {
      await this._streamChat();
    } catch (error) {
      // 重试逻辑：429 限流和 5xx 服务器错误
      if (error.status === 429 || (error.status && error.status >= 500)) {
        this.emit('message', { type: 'status', content: '⏳ API 限流，3秒后重试...' });
        await new Promise(r => setTimeout(r, 3000));
        try {
          await this._streamChat();
        } catch (retryError) {
          this._handleError(retryError);
        }
      } else {
        this._handleError(error);
      }
    }
  }

  /**
   * 核心流式对话方法
   */
  async _streamChat() {
    // 构建 API 参数
    const params = {
      model: this.model,
      max_tokens: this.options.maxTokens || 64000,
      messages: this.messages,
    };

    // Adaptive thinking
    if (this.options.thinking !== false) {
      params.thinking = { type: 'adaptive' };
    }

    // Effort 级别
    if (this.options.effort) {
      params.output_config = { effort: this.options.effort };
    }

    // System prompt（如果有）
    if (this.options.system) {
      params.system = this.options.system;
    }

    // 流式调用
    this.abortController = new AbortController();
    const stream = client.messages.stream(params);

    let assistantText = '';
    let thinkingText = '';

    // 监听流式事件（仅累积，不逐条发送）
    stream.on('text', (text) => {
      assistantText += text;
    });

    stream.on('thinking', (thinking) => {
      thinkingText += thinking;
    });

    // 等待最终消息
    const finalMessage = await stream.finalMessage();
    this.abortController = null;

    // 发送完整的文本回复（合并为一条消息）
    if (assistantText) {
      this.emit('message', { type: 'text', content: assistantText });
    }

    // 处理工具调用
    const assistantContent = [];
    for (const block of finalMessage.content) {
      if (block.type === 'text') {
        assistantContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        assistantContent.push(block);
        this.emit('message', {
          type: 'tool_use',
          content: JSON.stringify(block.input, null, 2),
          metadata: { tool: block.name }
        });
      }
    }
    this.messages.push({ role: 'assistant', content: assistantContent.length === 1 && assistantContent[0].type === 'text'
      ? assistantContent[0].text
      : assistantContent
    });

    // 生成 conversationId（SDK 不提供，用消息哈希标识）
    if (!this.conversationId) {
      this.conversationId = require('uuid').v4();
      this.emit('message', {
        type: 'conversation_id',
        content: this.conversationId,
        conversationId: this.conversationId
      });
    }

    // Token 使用统计
    if (finalMessage.usage) {
      this.emit('message', {
        type: 'token_usage',
        content: {
          inputTokens: finalMessage.usage.input_tokens || 0,
          outputTokens: finalMessage.usage.output_tokens || 0,
          cacheReadTokens: finalMessage.usage.cache_read_input_tokens || 0,
          cacheWriteTokens: finalMessage.usage.cache_creation_input_tokens || 0,
          cost: 0,
          model: this.model
        }
      });
    }
  }

  /**
   * 处理错误
   */
  _handleError(error) {
    const status = error.status;
    let message = error.message || '未知错误';

    if (status === 401) {
      message = 'API Key 无效，请检查配置';
    } else if (status === 403) {
      message = 'API 访问被拒绝（403），可能是模型不支持或代理不兼容，建议切换到 Claude Code 模式';
    } else if (status === 429) {
      message = 'API 请求过于频繁，请稍后重试';
    } else if (status === 413) {
      message = '请求内容过大，请减少对话历史或文件大小';
    } else if (status >= 500) {
      message = `API 服务器错误 (${status}): ${message}`;
    }

    this.emit('message', { type: 'error', content: `❌ ${message}` });

    // 移除最后一条失败的用户消息，以便重试
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'user') {
      this.messages.pop();
    }
  }

  /**
   * 更新配置选项
   */
  updateOptions(updates) {
    Object.assign(this.options, updates);
    if (updates.model) {
      this.model = updates.model;
    }
    this.emit('message', {
      type: 'status',
      content: `⚙️ 配置已更新: ${Object.keys(updates).join(', ')}`
    });
  }

  /**
   * 停止 Agent
   */
  async stop() {
    // 取消正在进行的请求
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    this.conversationId = null;
    this.emit('stopped', { code: 0 });
  }
}

module.exports = ClaudeApiAgent;
