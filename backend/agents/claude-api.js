/**
 * Claude API Agent适配器
 * 直接使用 Anthropic SDK，不依赖 CLI
 * 支持工具调用循环（agentic loop）
 */
const Agent = require('./base');
const client = require('../claude-client');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 工具定义
const TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command in the working directory. Use this to run any terminal command — file listing, git operations, build commands, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine code, config files, logs, etc.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to read (relative to workdir or absolute)'
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed, default: 1)'
        },
        limit: {
          type: 'number',
          description: 'Max number of lines to read (default: 200)'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist or overwriting if it does.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to write (relative to workdir or absolute)'
        },
        content: {
          type: 'string',
          description: 'The content to write to the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Useful for locating files by name or extension.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match (e.g. "**/*.js", "src/**/*.tsx")'
        }
      },
      required: ['pattern']
    }
  }
];

class ClaudeApiAgent extends Agent {
  constructor(workdir, options = {}) {
    super('claude-api', workdir);
    this.options = options;
    this.messages = [];           // 多轮对话历史 [{role, content}]
    this.conversationId = options.conversationId || null;
    this.model = options.model || 'claude-opus-4-6';
    this.abortController = null;  // 用于取消正在进行的请求
    this.totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
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
   * 发送消息给 Claude API（带 agentic loop）
   */
  async send(message) {
    if (!this.isRunning) {
      throw new Error('Agent未运行');
    }

    this.emit('message', { type: 'status', content: '🤔 思考中...' });

    // 添加用户消息到历史
    this.messages.push({ role: 'user', content: message });

    // 全局超时保护（较长时间，因为可能有多轮工具调用）
    const timeoutMs = this.options.timeoutMs || 300000; // 5min
    try {
      await Promise.race([
        this._agenticLoop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Claude API request timeout')), timeoutMs))
      ]);
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * Agentic loop: 调用 Claude API → 执行工具 → 喂回结果 → 循环直到纯文本回复
   */
  async _agenticLoop() {
    const MAX_TURNS = 25; // 最多25轮工具调用

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // 检查是否被中断
      if (!this.isRunning) break;

      this.emit('message', { type: 'status', content: '🤔 思考中...' });

      // 调用 API
      const response = await this._callApi();

      // 解析响应内容
      const assistantContent = [];
      const toolUses = [];
      let textContent = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
          assistantContent.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          toolUses.push(block);
          assistantContent.push(block);
        }
      }

      // 保存 assistant 消息到历史
      this.messages.push({
        role: 'assistant',
        content: assistantContent.length === 1 && assistantContent[0].type === 'text'
          ? assistantContent[0].text
          : assistantContent
      });

      // 如果有文本回复，发送给前端
      if (textContent) {
        this.emit('message', { type: 'text', content: textContent });
      }

      // 累计 token 使用量
      if (response.usage) {
        this.totalUsage.input_tokens += response.usage.input_tokens || 0;
        this.totalUsage.output_tokens += response.usage.output_tokens || 0;
        this.totalUsage.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;
        this.totalUsage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens || 0;
      }

      // 如果没有工具调用，说明回复完成了
      if (toolUses.length === 0) {
        // 发送累计 token 统计
        this._emitTokenUsage();
        break;
      }

      // 执行所有工具调用
      const toolResults = [];
      for (const toolUse of toolUses) {
        // 通知前端正在执行工具
        this.emit('message', {
          type: 'tool_use',
          content: JSON.stringify(toolUse.input, null, 2),
          metadata: { tool: toolUse.name }
        });

        // 执行工具
        const result = await this._executeTool(toolUse.name, toolUse.input);

        // 构建 tool_result 内容
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result
        });

        // 通知前端工具执行结果
        this.emit('message', {
          type: 'tool_result',
          content: result,
          metadata: { tool: toolUse.name }
        });
      }

      // 将工具结果作为 user 消息喂回给 Claude
      this.messages.push({ role: 'user', content: toolResults });
    }

    // 生成 conversationId
    if (!this.conversationId) {
      this.conversationId = require('uuid').v4();
      this.emit('message', {
        type: 'conversation_id',
        content: this.conversationId,
        conversationId: this.conversationId
      });
    }
  }

  /**
   * 调用 Claude API（单次，非流式以简化工具处理）
   */
  async _callApi() {
    // 构建 API 参数
    const params = {
      model: this.model,
      max_tokens: this.options.maxTokens || 16000,
      messages: this.messages,
      tools: TOOLS,
    };

    // Adaptive thinking
    if (this.options.thinking !== false) {
      params.thinking = { type: 'adaptive' };
    }

    // Effort 级别
    if (this.options.effort) {
      params.output_config = { effort: this.options.effort };
    }

    // System prompt
    const defaultSystem = `You are a Claude Agent, an AI coding assistant integrated into Agent Hub. You have access to tools to read/write files, execute shell commands, and search code.

Key guidelines:
- Use tools to explore the project and complete tasks. Don't just explain — take action.
- Execute commands with the bash tool to understand the project structure, run builds, check git status, etc.
- Use read_file to examine source code and configuration files.
- Always work within the project directory: ${this.workdir}
- When asked about a project, start by exploring it — list files, read key configs, check git log.
- Be thorough: read multiple files if needed to fully understand the context.`;

    params.system = this.options.system || defaultSystem;

    this.abortController = new AbortController();

    try {
      const response = await client.messages.create(params, {
        signal: this.abortController.signal
      });
      this.abortController = null;
      return response;
    } catch (e) {
      this.abortController = null;
      throw e;
    }
  }

  /**
   * 执行工具调用
   */
  async _executeTool(toolName, input) {
    try {
      switch (toolName) {
        case 'bash':
          return this._execBash(input.command);
        case 'read_file':
          return this._execReadFile(input.file_path, input.offset, input.limit);
        case 'write_file':
          return this._execWriteFile(input.file_path, input.content);
        case 'glob':
          return this._execGlob(input.pattern);
        default:
          return `Error: Unknown tool "${toolName}"`;
      }
    } catch (error) {
      return `Error executing ${toolName}: ${error.message}`;
    }
  }

  /**
   * 执行 bash 命令
   */
  _execBash(command) {
    const MAX_OUTPUT = 30000; // 30KB 输出限制
    const TIMEOUT = 30000;    // 30s 超时

    try {
      const result = execSync(command, {
        cwd: this.workdir,
        encoding: 'utf8',
        timeout: TIMEOUT,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = result;
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n... [输出已截断，共 ${result.length} 字符]`;
      }
      return output || '(命令执行成功，无输出)';
    } catch (error) {
      let errMsg = '';
      if (error.stdout) errMsg += error.stdout.toString();
      if (error.stderr) errMsg += '\n' + error.stderr.toString();
      if (!errMsg) errMsg = error.message;

      if (error.status) {
        errMsg = `Exit code: ${error.status}\n${errMsg}`;
      }
      if (errMsg.length > MAX_OUTPUT) {
        errMsg = errMsg.substring(0, MAX_OUTPUT) + '\n... [输出已截断]';
      }
      return errMsg;
    }
  }

  /**
   * 读取文件
   */
  _execReadFile(filePath, offset = 1, limit = 200) {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.workdir, filePath);

    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found: ${filePath}`;
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return `Error: "${filePath}" is a directory, not a file. Use bash with "ls" to list it.`;
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    const start = Math.max(0, offset - 1);
    const end = Math.min(lines.length, start + limit);
    const selected = lines.slice(start, end);

    // 添加行号
    const numbered = selected.map((line, i) => `${start + i + 1}|${line}`).join('\n');

    if (end < lines.length) {
      return `${numbered}\n... [文件共 ${lines.length} 行，显示 ${start + 1}-${end} 行]`;
    }
    return numbered || '(空文件)';
  }

  /**
   * 写入文件
   */
  _execWriteFile(filePath, content) {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.workdir, filePath);

    // 确保目录存在
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, 'utf8');
    const lines = content.split('\n').length;
    return `File written successfully: ${filePath} (${lines} lines, ${content.length} chars)`;
  }

  /**
   * Glob 文件搜索
   */
  _execGlob(pattern) {
    try {
      const result = execSync(`find . -path './.git' -prune -o -name '${pattern.replace(/'/g, "\\'")}' -print`, {
        cwd: this.workdir,
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024
      }).trim();

      if (!result) {
        return `No files found matching pattern: ${pattern}`;
      }

      const files = result.split('\n');
      if (files.length > 50) {
        return files.slice(0, 50).join('\n') + `\n... [共 ${files.length} 个文件，仅显示前 50 个]`;
      }
      return result;
    } catch (error) {
      return `Error searching files: ${error.message}`;
    }
  }

  /**
   * 发送 token 使用统计
   */
  _emitTokenUsage() {
    if (this.totalUsage.input_tokens > 0 || this.totalUsage.output_tokens > 0) {
      this.emit('message', {
        type: 'token_usage',
        content: {
          inputTokens: this.totalUsage.input_tokens,
          outputTokens: this.totalUsage.output_tokens,
          cacheReadTokens: this.totalUsage.cache_read_input_tokens,
          cacheWriteTokens: this.totalUsage.cache_creation_input_tokens,
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    this.conversationId = null;
    this.emit('stopped', { code: 0 });
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' });
    }
  }

  static healthCheck() {
    try {
      require('../claude-client');
      return { ok: true, info: 'Claude API client available' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = ClaudeApiAgent;
