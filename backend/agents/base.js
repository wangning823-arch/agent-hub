/**
 * Agent基类 - 所有CLI Agent适配器必须实现此接口
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');

class Agent extends EventEmitter {
  /**
   * @param {string} name - Agent名称
   * @param {string} workdir - 工作目录
   */
  constructor(name, workdir) {
    super();
    this.name = name;
    this.workdir = workdir;
    this.process = null;
    this.isRunning = false;
  }

  /**
   * 启动Agent进程
   * 子类必须实现
   */
  async start() {
    throw new Error('子类必须实现 start() 方法');
  }

  /**
   * 发送消息给Agent
   * 子类必须实现
   */
  async send(message) {
    throw new Error('子类必须实现 send() 方法');
  }

  /**
   * 停止Agent进程
   */
  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isRunning = false;
      this.emit('stopped');
    }
  }

  /**
   * 解析Agent输出
   * 子类可覆盖
   */
  parseOutput(data) {
    return { type: 'text', content: data.toString() };
  }
}

module.exports = Agent;