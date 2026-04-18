/**
 * Codex Agent适配器
 * 使用stdin/stdout与codex CLI通信
 */
const Agent = require('./base');
const { spawn } = require('child_process');

class CodexAgent extends Agent {
  constructor(workdir) {
    super('codex', workdir);
    this.buffer = '';
  }

  async start() {
    return new Promise((resolve, reject) => {
      // Codex CLI 使用 --acp --stdio 模式
      this.process = spawn('codex', ['--acp', '--stdio'], {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      this.process.stdout.on('data', (data) => {
        this.handleOutput(data);
      });

      this.process.stderr.on('data', (data) => {
        this.emit('error', { type: 'error', content: data.toString() });
      });

      this.process.on('close', (code) => {
        this.isRunning = false;
        this.emit('stopped', { code });
      });

      this.process.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(new Error('Codex未安装，请先安装: npm install -g @openai/codex'));
        } else {
          reject(err);
        }
      });

      setTimeout(() => {
        this.isRunning = true;
        this.emit('started');
        resolve();
      }, 500);
    });
  }

  handleOutput(data) {
    this.buffer += data.toString();
    
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.emit('message', message);
        } catch (e) {
          this.emit('message', { type: 'text', content: line });
        }
      }
    }
  }

  async send(message) {
    if (!this.isRunning || !this.process) {
      throw new Error('Agent未运行');
    }

    const payload = typeof message === 'string' 
      ? { type: 'user_input', content: message }
      : message;

    this.process.stdin.write(JSON.stringify(payload) + '\n');
  }
}

module.exports = CodexAgent;