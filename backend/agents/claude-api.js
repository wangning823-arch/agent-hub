/**
 * Claude API Agent适配器
 * 直接使用 Anthropic SDK，不依赖 CLI
 * 使用自定义工具定义（兼容第三方 API 代理）+ agentic loop
 * 支持 bash 执行 + str_replace_editor 精准编辑
 */
const Agent = require('./base');
const client = require('../claude-client');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 工具定义（使用 input_schema，兼容第三方 API 代理）
const TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command in the working directory. Use for any terminal operation: list files, run git, install packages, build, test, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'str_replace_editor',
    description: 'A text editor tool for viewing, creating, and editing files. Supports these commands:\n- view: View file contents or list directory (params: path, view_range?)\n- create: Create a new file (params: path, file_text)\n- str_replace: Replace a unique string in a file with new text (params: path, old_str, new_str)\n- insert: Insert text after a specific line number (params: path, insert_line, new_str)\n- undo_edit: Undo the last edit to a file (params: path)',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'create', 'str_replace', 'insert', 'undo_edit'],
          description: 'The editor command to execute'
        },
        path: { type: 'string', description: 'Path to the file or directory (relative to workdir or absolute)' },
        view_range: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional [start_line, end_line] for view command (1-indexed, inclusive)'
        },
        file_text: { type: 'string', description: 'Content for create command' },
        old_str: { type: 'string', description: 'Exact string to find and replace (must be unique in file)' },
        new_str: { type: 'string', description: 'Replacement string' },
        insert_line: { type: 'number', description: 'Line number after which to insert (0 = insert at beginning)' }
      },
      required: ['command', 'path']
    }
  }
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
    this._editHistory = {};
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

    const timeoutMs = this.options.timeoutMs || 600000;
    try {
      await Promise.race([
        this._agenticLoop(),
        new Promise((resolve) => setTimeout(() => {
          this.emit('message', { type: 'status', content: '⏳ 请求超时，继续等待响应...' });
          // 超时不中断，让 agenticLoop 继续运行
        }, timeoutMs))
      ]);
    } catch (error) {
      if (error.message === 'Aborted') {
        this.emit('message', { type: 'status', content: '⏹️ 请求已中断' });
      } else {
        this._handleError(error);
      }
    }
  }

  async _agenticLoop() {
    const MAX_TURNS = 30;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (!this.isRunning) break;

      let response;
      try {
        response = await this._callApi();
      } catch (error) {
        console.error(`[Claude API] Turn ${turn + 1} failed:`, error.message);
        throw error;
      }

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

      this.messages.push({
        role: 'assistant',
        content: assistantContent.length === 1 && assistantContent[0].type === 'text'
          ? assistantContent[0].text
          : assistantContent
      });

      if (textContent) {
        this.emit('message', { type: 'text', content: textContent });
      }

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

      // 执行工具
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
          content: result.length > 1000 ? result.substring(0, 1000) + '...' : result,
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

  async _callApi() {
    const params = {
      model: this.model,
      max_tokens: this.options.maxTokens || 16000,
      messages: this.messages,
      tools: TOOLS,
    };

    if (this.options.thinking !== false) {
      params.thinking = { type: 'adaptive' };
    }

    if (this.options.effort) {
      params.output_config = { effort: this.options.effort };
    }

    const defaultSystem = `You are a Claude Agent, an AI coding assistant. You have tools to read, write, and edit files, execute shell commands.

Available tools:
- bash: Execute any shell command (ls, cat, grep, git, npm, python, etc.)
- str_replace_editor: View files, create files, make precise text replacements, insert at line, undo edits

Guidelines:
- Always use tools to explore and understand the project. Don't just explain — take action.
- When editing code, use str_replace_editor with str_replace for precise edits.
- Always work within: ${this.workdir}
- Read files before editing. Understand context before making changes.
- Verify changes after editing (run tests, check syntax).`;

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

  // ──────────────────── Bash ────────────────────

  _execBash(input) {
    const command = input.command;
    if (!command) return 'Error: No command provided';

    const MAX_OUTPUT = 30000;
    try {
      const result = execSync(command, {
        cwd: this.workdir,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = result || '';
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n... [truncated, total ${result.length} chars]`;
      }
      return output || '(command succeeded, no output)';
    } catch (error) {
      let errMsg = '';
      if (error.stdout) errMsg += error.stdout.toString();
      if (error.stderr) errMsg += (errMsg ? '\n' : '') + error.stderr.toString();
      if (!errMsg) errMsg = error.message;
      if (error.status != null) errMsg = `Exit code: ${error.status}\n${errMsg}`;
      if (errMsg.length > MAX_OUTPUT) errMsg = errMsg.substring(0, MAX_OUTPUT) + '\n... [truncated]';
      return errMsg;
    }
  }

  // ──────────────────── Editor ────────────────────

  _execEditor(input) {
    const { command, path: filePath } = input;
    if (!command) return 'Error: No command provided';
    if (!filePath) return 'Error: No path provided';

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

  _editorView(resolvedPath, input) {
    if (!fs.existsSync(resolvedPath)) {
      return `Error: Path not found: ${input.path}`;
    }

    const stat = fs.statSync(resolvedPath);

    if (stat.isDirectory()) {
      try {
        const result = execSync(`ls -la "${resolvedPath}"`, { encoding: 'utf8', timeout: 5000 });
        return result || '(empty directory)';
      } catch (e) {
        return `Error listing directory: ${e.message}`;
      }
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');
    const viewRange = input.view_range;

    if (viewRange && Array.isArray(viewRange) && viewRange.length === 2) {
      const [start, end] = viewRange;
      const s = Math.max(1, start);
      const e = Math.min(lines.length, end);
      const selected = lines.slice(s - 1, e);
      const numbered = selected.map((line, i) => `${s + i}\t${line}`).join('\n');
      if (e < lines.length) return `${numbered}\n... [file has ${lines.length} lines total]`;
      return numbered;
    }

    if (lines.length > 500) {
      const head = lines.slice(0, 500).map((line, i) => `${i + 1}\t${line}`).join('\n');
      return `${head}\n... [file has ${lines.length} lines, showing first 500. Use view_range to see other parts]`;
    }

    return lines.map((line, i) => `${i + 1}\t${line}`).join('\n') || '(empty file)';
  }

  _editorCreate(resolvedPath, input) {
    if (fs.existsSync(resolvedPath)) {
      return `Error: File already exists at ${input.path}. Use str_replace to edit it.`;
    }

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const content = input.file_text || '';
    fs.writeFileSync(resolvedPath, content, 'utf8');
    this._saveEditHistory(resolvedPath, null, content);

    return `File created at ${input.path} (${content.split('\n').length} lines)`;
  }

  _editorStrReplace(resolvedPath, input) {
    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found: ${input.path}`;
    }

    const { old_str, new_str } = input;
    if (old_str === undefined || new_str === undefined) {
      return 'Error: Both old_str and new_str are required';
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const count = content.split(old_str).length - 1;

    if (count === 0) {
      return `Error: Could not find the string to replace in ${input.path}. Make sure the text matches exactly (including whitespace and indentation).`;
    }
    if (count > 1) {
      return `Error: Found ${count} occurrences of the string in ${input.path}. The string to replace must be unique. Add more surrounding context to make it unique.`;
    }

    const newContent = content.replace(old_str, new_str);
    this._saveEditHistory(resolvedPath, content, newContent);
    fs.writeFileSync(resolvedPath, newContent, 'utf8');

    const beforeLines = content.substring(0, content.indexOf(old_str)).split('\n').length;
    const oldLineCount = old_str.split('\n').length;
    const newLineCount = new_str.split('\n').length;
    const totalLines = newContent.split('\n').length;

    return `The file ${input.path} has been edited successfully. Lines ${beforeLines}-${beforeLines + oldLineCount - 1} replaced with ${newLineCount} new line(s). File now has ${totalLines} lines.`;
  }

  _editorInsert(resolvedPath, input) {
    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found: ${input.path}`;
    }

    const { insert_line, new_str } = input;
    if (insert_line === undefined || new_str === undefined) {
      return 'Error: Both insert_line and new_str are required';
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const lines = content.split('\n');

    if (insert_line < 0 || insert_line > lines.length) {
      return `Error: insert_line must be between 0 and ${lines.length}`;
    }

    lines.splice(insert_line, 0, new_str);
    const newContent = lines.join('\n');
    this._saveEditHistory(resolvedPath, content, newContent);
    fs.writeFileSync(resolvedPath, newContent, 'utf8');

    return `Inserted ${new_str.split('\n').length} line(s) after line ${insert_line} in ${input.path}. File now has ${lines.length} lines.`;
  }

  _editorUndo(resolvedPath) {
    const history = this._editHistory[resolvedPath];
    if (!history || history.length === 0) {
      return `Error: No edit history found for ${resolvedPath}`;
    }

    const lastEdit = history.pop();

    if (lastEdit.originalContent === null) {
      fs.unlinkSync(resolvedPath);
      return `Undone: File removed (was created by last edit)`;
    }

    fs.writeFileSync(resolvedPath, lastEdit.originalContent, 'utf8');
    return `Undone: Restored ${resolvedPath} to previous state (${lastEdit.originalContent.split('\n').length} lines)`;
  }

  _saveEditHistory(filePath, originalContent, newContent) {
    if (!this._editHistory[filePath]) this._editHistory[filePath] = [];
    this._editHistory[filePath].push({ originalContent, newContent });
    if (this._editHistory[filePath].length > 20) this._editHistory[filePath].shift();
  }

  // ──────────────────── Token ────────────────────

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
