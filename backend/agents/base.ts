/**
 * Agent基类 - 所有CLI Agent适配器必须实现此接口
 */
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentMessage } from '../types';

// Ensure Agent properly inherits from EventEmitter
interface Agent extends EventEmitter {}

class Agent extends EventEmitter {
  name: string;
  workdir: string;
  process: ChildProcess | null;
  isRunning: boolean;
  activeProc: ChildProcess | null;
  options: Record<string, unknown>;

  constructor(name: string, workdir: string) {
    super();
    this.name = name;
    this.workdir = workdir;
    this.process = null;
    this.isRunning = false;
    this.activeProc = null;
    this.options = {};
  }

  /**
   * 启动Agent进程
   * 子类必须实现
   */
  async start(): Promise<void> {
    throw new Error('子类必须实现 start() 方法');
  }

  /**
   * 发送消息给Agent
   * 子类必须实现
   */
  async send(message: string): Promise<void> {
    throw new Error('子类必须实现 send() 方法');
  }

  /**
   * 停止Agent进程
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isRunning = false;
      this.emit('stopped');
    }
  }

  /**
   * 中断当前正在运行的任务，保持Agent可用
   */
  async interrupt(): Promise<void> {
    if (this.activeProc) {
      try { this.activeProc.kill('SIGKILL'); } catch (e) { /* ignore */ }
      this.activeProc = null;
    }
    this.emit('interrupted');
  }

  /**
   * 运行时更新选项（如切换模式）
   */
  updateOptions(newOptions: Record<string, unknown>): void {
    Object.assign(this.options || {}, newOptions);
  }

  /**
   * 解析Agent输出
   * 子类可覆盖
   */
  parseOutput(data: Buffer): AgentMessage {
    return { type: 'text', content: data.toString() };
  }
}

export default Agent;
