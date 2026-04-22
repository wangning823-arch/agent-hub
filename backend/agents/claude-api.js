/**
 * Claude API Agent适配器
 * 直接使用 Anthropic SDK，不依赖 CLI
 * 使用 Anthropic 内置工具（bash + str_replace_editor）+ agentic loop
 * 与 Claude Code CLI 拥有同等的工具能力
 */
const Agent = require('./base');
const client = require('../claude-client');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Anthropic 内置工具定义（无需 input_schema，Anthropic 内部处理）
const BUILTIN_TOOLS = [
  { name: 'bash', type: 'bash_20250124' },
  { name: 'str_replace_editor', type: 'text_editor_20250124' },
];

class ClaudeApiAgent extends Agent {
  constructor(workdir, options = {}) {
    super('claude-api', workdir);
    this.options = options;
    this.messages = [];
    this.conversationId = options.conversationId || null;
    this.model = options.model || 'claude-opus-4-6';
    this.abortController = null;
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

  async send(message) {
    if (!this.isRunning) throw new Error('Agent未运行');

    this.emit('message', { type: 'status', content: '🤔 思考中...' });
    this.messages.push({ role: 'user', content: message });

    const timeoutMs = this.options.timeoutMs || 300000; // 5min 全局超时
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
   * Agentic loop: API 调用 → 工具执行 → 结果喂回 → 循环直到纯文本回复
   */
  async _agenticLoop() {
    const MAX_TURNS = 30;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (!this.isRunning) break;

      this.emit('message', { type: 'status', content: '🤔 思考中...' });

      const response = await this._callApi();

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

      // 保存 assistant 消息
      this.messages.push({
        role: 'assistant',
        content: assistantContent.length === 1 && assistantContent[0].type === 'text'
          ? assistantContent[0].text
          : assistantContent
      });

      if (textContent) {
        this.emit('message', { type: 'text', content: textContent });
      }

      // 累计 token
      if (response.usage) {
        this.totalUsage.input_tokens += response.usage.input_tokens || 0;
        this.totalUsage.output_tokens += response.usage.output_tokens || 0;
        this.totalUsage.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;
        this.totalUsage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens || 0;
      }

      // 没有工具调用 = 回复完成
      if (toolUses.length === 0) {
        this._emitTokenUsage();
        break;
      }

      // 执行工具并收集结果
      const toolResults = [];
      for (const toolUse of toolUses) {
        this.emit('message', {
          type: 'tool_use',
          content: JSON.stringify(toolUse.input, null, 2),
          metadata: { tool: toolUse.name }
        });

        const result = this._executeTool(toolUse.name, toolUse.input);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result
        });

        this.emit('message', {
          type: 'tool_result',
          content: result,
          metadata: { tool: toolUse.name }
        });
      }

      this.messages.push({ role: 'user', content: toolResults });
    }

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
   * 调用 Claude API
   */
  async _callApi() {
    const params = {
      model: this.model,
      max_tokens: this.options.maxTokens || 16000,
      messages: this.messages,
      tools: BUILTIN_TOOLS,
    };

    if (this.options.thinking !== false) {
      params.thinking = { type: 'adaptive' };
    }

    if (this.options.effort) {
      params.output_config = { effort: this.options.effort };
    }

    const defaultSystem = `You are a Claude Agent, an AI coding assistant. You have access to tools to read, write, and edit files, execute shell commands, and search code.

Key capabilities:
- bash: Execute any shell command (ls, cat, grep, git, npm, etc.)
- str_replace_editor: View files, create new files, make precise edits (find-and-replace, insert at line), undo edits

Guidelines:
- Use tools to explore and understand the project before making changes.
- When editing code, use str_replace_editor with the str_replace command for precise edits — don't rewrite entire files unless necessary.
- Always work within: ${this.workdir}
- Be thorough: read files before editing them. Understand context before making changes.
- After making changes, verify them (run tests, check syntax, etc.).`;

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
  _executeTool(toolName, input) {
    try {
      switch (toolName) {
        case 'bash': return this._execBash(input);
        case 'str_replace_editor': return this._execEditor(input);
        default: return `Error: Unknown tool "${toolName}"`;
      }
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  // ──────────────────── Bash 工具 ────────────────────

  _execBash(input) {
    const command = input.command;
    if (!command) return 'Error: No command provided';

    const MAX_OUTPUT = 30000;
    const TIMEOUT = 60000; // 60s

    try {
      const result = execSync(command, {
        cwd: this.workdir,
        encoding: 'utf8',
        timeout: TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = result || '';
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n... [输出已截断，共 ${result.length} 字符]`;
      }
      return output || '(命令执行成功，无输出)';
    } catch (error) {
      let errMsg = '';
      if (error.stdout) errMsg += error.stdout.toString();
      if (error.stderr) errMsg += (errMsg ? '\n' : '') + error.stderr.toString();
      if (!errMsg) errMsg = error.message;
      if (error.status != null) errMsg = `Exit code: ${error.status}\n${errMsg}`;
      if (errMsg.length > MAX_OUTPUT) errMsg = errMsg.substring(0, MAX_OUTPUT) + '\n... [输出已截断]';
      return errMsg;
    }
  }

  // ──────────────────── 文本编辑器工具 ────────────────────

  _execEditor(input) {
    const { command, path: filePath } = input;
    if (!command) return 'Error: No command provided';
    if (!filePath) return 'Error: No path provided';

    // 解析路径
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.workdir, filePath);

    switch (command) {
      case 'view': return this._editorView(resolvedPath, input);
      case 'create': return this._editorCreate(resolvedPath, input);
      case 'str_replace': return this._editorStrReplace(resolvedPath, input);
      case 'insert': return this._editorInsert(resolvedPath, input);
      case 'undo_edit': return this._editorUndo(resolvedPath);
      default: return `Error: Unknown editor command "${command}"`;
    }
  }

  /**
   * view: 查看文件或目录内容
   */
  _editorView(resolvedPath, input) {
    if (!fs.existsSync(resolvedPath)) {
      return `Error: Path not found: ${input.path}`;
    }

    const stat = fs.statSync(resolvedPath);

    if (stat.isDirectory()) {
      try {
        const result = execSync(`ls -la "${resolvedPath}"`, {
          encoding: 'utf8',
          timeout: 5000
        });
        return result || '(空目录)';
      } catch (e) {
        return `Error listing directory: ${e.message}`;
      }
    }

    // 文件查看
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    const viewRange = input.view_range;

    if (viewRange && Array.isArray(viewRange) && viewRange.length === 2) {
      const [start, end] = viewRange;
      const s = Math.max(1, start);
      const e = Math.min(lines.length, end);
      const selected = lines.slice(s - 1, e);
      const numbered = selected.map((line, i) => `${s + i}\t${line}`).join('\n');
      if (e < lines.length) {
        return `${numbered}\n... [文件共 ${lines.length} 行]`;
      }
      return numbered;
    }

    // 完整查看（大文件截断）
    if (lines.length > 500) {
      const head = lines.slice(0, 500).map((line, i) => `${i + 1}\t${line}`).join('\n');
      return `${head}\n... [文件共 ${lines.length} 行，仅显示前 500 行。使用 view_range 查看其他部分]`;
    }

    return lines.map((line, i) => `${i + 1}\t${line}`).join('\n') || '(空文件)';
  }

  /**
   * create: 创建新文件
   */
  _editorCreate(resolvedPath, input) {
    if (fs.existsSync(resolvedPath)) {
      return `Error: File already exists at ${input.path}. Use str_replace to edit it.`;
    }

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = input.file_text || '';
    fs.writeFileSync(resolvedPath, content, 'utf8');

    // 保存编辑历史用于 undo
    this._saveEditHistory(resolvedPath, null, content);

    const lines = content.split('\n').length;
    return `File created successfully at ${input.path} (${lines} lines)`;
  }

  /**
   * str_replace: 精准查找替换
   */
  _editorStrReplace(resolvedPath, input) {
    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found: ${input.path}`;
    }

    const oldStr = input.old_str;
    const newStr = input.new_str;

    if (oldStr === undefined || newStr === undefined) {
      return 'Error: Both old_str and new_str are required';
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');

    // 精确匹配检查
    const count = content.split(oldStr).length - 1;
    if (count === 0) {
      return `Error: Could not find the string to replace in ${input.path}. Make sure the text matches exactly (including whitespace and indentation).`;
    }
    if (count > 1) {
      return `Error: Found ${count} occurrences of the string in ${input.path}. The string to replace must be unique. Add more context to make it unique.`;
    }

    const newContent = content.replace(oldStr, newStr);
    this._saveEditHistory(resolvedPath, content, newContent);
    fs.writeFileSync(resolvedPath, newContent, 'utf8');

    // 显示修改区域
    const beforeLines = content.substring(0, content.indexOf(oldStr)).split('\n').length;
    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;
    const totalLines = newContent.split('\n').length;

    return `Replacement successful in ${input.path}. Lines ${beforeLines}-${beforeLines + oldLines - 1} replaced with ${newLines} new lines. File now has ${totalLines} lines.`;
  }

  /**
   * insert: 在指定行后插入内容
   */
  _editorInsert(resolvedPath, input) {
    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found: ${input.path}`;
    }

    const insertLine = input.insert_line;
    const newStr = input.new_str;

    if (insertLine === undefined || newStr === undefined) {
      return 'Error: Both insert_line and new_str are required';
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');

    if (insertLine < 0 || insertLine > lines.length) {
      return `Error: insert_line must be between 0 and ${lines.length}`;
    }

    lines.splice(insertLine, 0, newStr);
    const newContent = lines.join('\n');

    this._saveEditHistory(resolvedPath, content, newContent);
    fs.writeFileSync(resolvedPath, newContent, 'utf8');

    return `Inserted ${newStr.split('\n').length} line(s) after line ${insertLine} in ${input.path}. File now has ${lines.length} lines.`;
  }

  /**
   * undo_edit: 撤销最后一次编辑
   */
  _editorUndo(resolvedPath) {
    if (!this._editHistory || !this._editHistory[resolvedPath] || this._editHistory[resolvedPath].length === 0) {
      return `Error: No edit history found for ${resolvedPath}`;
    }

    const history = this._editHistory[resolvedPath];
    const lastEdit = history.pop();

    if (lastEdit.originalContent === null) {
      // 之前是 create，删除文件
      fs.unlinkSync(resolvedPath);
      return `Undone: File ${resolvedPath} removed (was created by last edit)`;
    }

    fs.writeFileSync(resolvedPath, lastEdit.originalContent, 'utf8');
    return `Undone: Restored ${resolvedPath} to previous state (${lastEdit.originalContent.split('\n').length} lines)`;
  }

  /**
   * 保存编辑历史（用于 undo）
   */
  _saveEditHistory(filePath, originalContent, newContent) {
    if (!this._editHistory) this._editHistory = {};
    if (!this._editHistory[filePath]) this._editHistory[filePath] = [];
    this._editHistory[filePath].push({ originalContent, newContent });
    // 最多保留 20 步历史
    if (this._editHistory[filePath].length > 20) {
      this._editHistory[filePath].shift();
    }
  }

  // ──────────────────── Token 统计 ────────────────────

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

  _handleError(error) {
    const status = error.status;
    let message = error.message || '未知错误';

    if (status === 401) message = 'API Key 无效，请检查配置';
    else if (status === 403) message = 'API 访问被拒绝（403），可能是模型不支持或代理不兼容，建议切换到 Claude Code 模式';
    else if (status === 429) message = 'API 请求过于频繁，请稍后重试';
    else if (status === 413) message = '请求内容过大，请减少对话历史或文件大小';
    else if (status >= 500) message = `API 服务器错误 (${status}): ${message}`;

    this.emit('message', { type: 'error', content: `❌ ${message}` });
  }

  updateOptions(updates) {
    Object.assign(this.options, updates);
    if (updates.model) this.model = updates.model;
    this.emit('message', { type: 'status', content: `⚙️ 配置已更新: ${Object.keys(updates).join(', ')}` });
  }

  async stop() {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
    this.isRunning = false;
    this.conversationId = null;
    this.emit('stopped', { code: 0 });
  }

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
