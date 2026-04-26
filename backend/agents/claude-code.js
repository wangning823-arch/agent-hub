/**
 * Claude Code Agent适配器
 * 使用 --print --continue 模式，每次调用保持对话历史
 */
const Agent = require('./base')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

class ClaudeCodeAgent extends Agent {
  constructor(workdir, options = {}) {
    super('claude-code', workdir)
    this.conversationId = options.conversationId || null // 支持恢复已有对话
    this.options = options
    // 跟踪正在运行的子进程，用于优雅地中止/清理
    this.activeProc = null
  }

  async start() {
    // Claude Code 不需要长期运行的进程
    // 每次发消息时启动一个新进程，用 --continue 保持历史
    this.isRunning = true
    // 可选的自检，确保 claude CLI 可用
    try {
      const claudeBin = process.env.CLAUDE_CLI_PATH || 'claude'
      require('child_process').execSync(`"${claudeBin}" --version`, { stdio: 'ignore' })
    } catch (e) {
      this.isRunning = false
      throw new Error('Claude CLI 未发现或不可用，请确保 CLAUDE_CLI_PATH 指向正确的二进制，或在 PATH 中可访问。')
    }
    this.emit('started')
    
    // 发送欢迎消息
    this.emit('message', {
      type: 'status',
      content: `✅ Claude Code 已就绪`
    })
  }

  /**
   * 发送消息给Claude Code
   */
  async send(message) {
    if (!this.isRunning) {
      throw new Error('Agent未运行')
    }

    // 通知前端正在处理
    this.emit('message', { type: 'status', content: '🤔 思考中...' })

    return new Promise((resolve, reject) => {
      // 直接调用 Claude Code CLI（不使用 wrapper 脚本）
      const claudePath = process.env.CLAUDE_CLI_PATH || 'claude'

      // 构建命令参数
      const args = [
        '--print',
        '--verbose',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json'
      ]

      // 指定模型（如果用户选了的话）
      if (this.options.model) {
        args.push('--model', this.options.model)
      }
      
      // 添加模式参数
      if (this.options.mode) {
        args.push('--permission-mode', this.options.mode)
      }
      
      // 添加努力程度参数
      if (this.options.effort) {
        args.push('--effort', this.options.effort)
      }

      // 对话隔离：有 conversationId 用 --resume，没有则检查会话文件是否存在
      // 如果会话文件存在，用 --resume 恢复；如果不存在，用 --session-id 创建新会话
      if (this.conversationId) {
        args.push('--resume', this.conversationId)
      } else if (this.options.sessionId) {
        if (this._conversationFileExists(this.options.sessionId)) {
          // 会话文件存在，恢复已有会话
          args.push('--resume', this.options.sessionId)
        } else {
          // 会话文件不存在，创建新会话
          args.push('--session-id', this.options.sessionId)
        }
      } else {
        args.push('--continue')
      }

      // 添加用户消息（长度截断，防止超大输入导致崩溃）
      let userMessage = message

      // 如果有待注入的历史上下文， prepend 到消息中
      if (this.pendingHistory) {
        userMessage = `[之前的对话上下文]\n${this.pendingHistory}\n\n[当前消息]\n${userMessage}`
        this.pendingHistory = null
      }
      const MAX_INPUT_SIZE = 8000
      if (typeof userMessage === 'string' && userMessage.length > MAX_INPUT_SIZE) {
        userMessage = userMessage.substring(0, MAX_INPUT_SIZE)
        this.emit('message', { type: 'status', content: '⚠️ 输入过长，已截断以确保处理稳定' })
      }
      args.push('-p', userMessage)

      // 启动 Claude Code CLI
      const proc = spawn(claudePath, args, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env
        }
      })
      // 超时提醒：10min 未响应则提示用户，可选择继续等待或点击停止按钮
      const timeoutId = setTimeout(() => {
        this.emit('message', { type: 'status', content: '⏳ 响应已超时超过10分钟，如需等待请点击停止按钮终止任务...' })
      }, 600000)
      // 清理超时定时器（在输出完成时清理）
      // 记录活跃进程，便于后续中止
      this.activeProc = proc

      let buffer = ''
      let hasOutput = false

      proc.stdout.on('data', (data) => {
        hasOutput = true
        buffer += data.toString()
        
        // 按行解析
        const lines = buffer.split('\n')
        buffer = lines.pop()
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line)
              this.handleStreamMessage(msg)
              
              // 保存对话ID用于后续继续
              if (msg.type === 'result' && msg.conversation_id) {
                this.conversationId = msg.conversation_id
              }
            } catch (e) {
              // 非JSON作为文本
              this.emit('message', { type: 'text', content: line })
            }
          }
        }
      })

      proc.stderr.on('data', (data) => {
        const msg = data.toString().trim()
        if (msg && !msg.includes('Loaded') && !msg.includes('model')) {
          console.error('[Claude stderr]:', msg)
        }
      })

      proc.on('close', (code) => {
        // 取消超时定时器
        try { clearTimeout(timeoutId) } catch {}
        // 处理剩余buffer
        if (buffer.trim()) {
          try {
            const msg = JSON.parse(buffer)
            this.handleStreamMessage(msg)
          } catch (e) {
            this.emit('message', { type: 'text', content: buffer })
          }
        }
        
        if (!hasOutput) {
          this.emit('message', { 
            type: 'error', 
            content: 'Claude Code 没有返回输出，请检查配置' 
          })
        }
        
        // 清理活跃进程引用
        this.activeProc = null
        resolve()
      })

      proc.on('error', (err) => {
        this.emit('message', { 
          type: 'error',
          content: `启动失败: ${err.message}` 
        })
        this.activeProc = null
        reject(err)
      })
    })
  }

  /**
   * 处理stream-json消息
   */
  handleStreamMessage(msg) {
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        // 文本内容
        const texts = content.filter(c => c.type === 'text').map(c => c.text)
        if (texts.length > 0) {
          this.emit('message', { type: 'text', content: texts.join('\n') })
        }
        
        // 工具调用
        const tools = content.filter(c => c.type === 'tool_use')
        for (const tool of tools) {
          this.emit('message', {
            type: 'tool_use',
            content: JSON.stringify(tool.input, null, 2),
            metadata: { tool: tool.name }
          })
        }
      }
    } else if (msg.type === 'result') {
      // 保存对话ID
      if (msg.conversation_id) {
        this.conversationId = msg.conversation_id
        // 通知前端保存对话ID
        this.emit('message', {
          type: 'conversation_id',
          content: msg.conversation_id,
          conversationId: msg.conversation_id
        })
      }
      
      // 发送Token使用统计
      if (msg.usage) {
        // 不从 modelUsage 获取 contextWindow（该值不可靠，可能是默认值）
        // contextWindow 由前端从模型配置（contextLimit）获取
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
        })
      }
      
      // 不再单独emit result，因为assistant消息已经包含了完整内容
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      // 初始化信息
      console.log('[Claude Code] 初始化:', msg)
    }
  }

  /**
   * 发送权限审批响应（在dangerously-skip-permissions模式下不需要）
   */
  async approve(approvalId, allow = true) {
    console.log(`[权限] ${allow ? '允许' : '拒绝'} ${approvalId}`)
  }

  /**
   * 更新配置选项
   */
  updateOptions(updates) {
    Object.assign(this.options, updates)
    this.emit('message', {
      type: 'status',
      content: `⚙️ 配置已更新: ${Object.keys(updates).join(', ')}`
    })
  }

  /**
   * 停止Agent
   */
  async stop() {
    if (this.activeProc) {
      const pid = this.activeProc.pid
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (e) {
        try { this.activeProc.kill('SIGKILL') } catch (e2) { /* ignore */ }
      }
      this.activeProc = null
    }
    this.isRunning = false
    this.conversationId = null
    this.emit('stopped', { code: 0 })
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt() {
    if (this.activeProc) {
      const pid = this.activeProc.pid
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (e) {
        try { this.activeProc.kill('SIGKILL') } catch (e2) { /* ignore */ }
      }
      this.activeProc = null
      this.emit('message', { type: 'status', content: '⏹️ 任务已中断' })
    }
  }

  // 静态健康检查：不依赖工作目录即可快速判断可用性
  static healthCheck() {
    try {
      const claudeBin = process.env.CLAUDE_CLI_PATH || 'claude'
      const { execSync } = require('child_process')
      execSync(`"${claudeBin}" --version`, { stdio: 'ignore' })
      return { ok: true, info: 'Claude Code CLI available' }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  /**
   * 检查Claude Code会话文件是否存在
   * 用于判断是否可以使用 --resume 恢复会话
   */
  _conversationFileExists(sessionId) {
    try {
      // Claude Code存储路径: ~/.claude/projects/<project-dir>/<sessionId>.jsonl
      // project-dir是工作目录路径，/替换为-
      const projectDir = this.workdir.replace(/\//g, '-')
      const claudeDir = path.join(os.homedir(), '.claude', 'projects', projectDir)
      const filePath = path.join(claudeDir, `${sessionId}.jsonl`)
      return fs.existsSync(filePath)
    } catch (e) {
      return false
    }
  }
}

module.exports = ClaudeCodeAgent