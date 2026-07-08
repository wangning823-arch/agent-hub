/**
 * Mimo Server Manager
 * 管理 mimo serve 常驻进程的生命周期
 * 所有 mimo agent 共享同一个 server 实例
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';

const DEFAULT_PORT = 14096;
const HEALTH_CHECK_INTERVAL = 30_000;
const STARTUP_TIMEOUT = 10_000;

function findMimoPath(): string {
  const envPath = process.env.MIMOCODE_BIN_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates: string[] = [
    '/root/.nvm/versions/node/v22.22.3/lib/node_modules/@mimo-ai/cli/bin/.mimocode',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const mimoWrapper = execSync('which mimo 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (mimoWrapper) {
      const realWrapper = fs.realpathSync(mimoWrapper);
      const binDir = require('path').dirname(realWrapper);
      const cached = require('path').join(binDir, '.mimocode');
      if (fs.existsSync(cached)) return cached;
    }
  } catch (e) { /* ignore */ }

  return 'mimo';
}

class MimoServerManager {
  private serverProcess: ChildProcess | null = null;
  private port: number;
  private mimoPath: string;
  private starting: boolean = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private refCount: number = 0;
  private ready: boolean = false;
  private _wasRestarted: boolean = false;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
    this.mimoPath = findMimoPath();
  }

  getServerUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }

  /**
   * 确保 server 正在运行，供 agent 调用
   */
  async ensureRunning(): Promise<void> {
    if (this.ready && this.serverProcess && !this.serverProcess.killed) {
      this.refCount++;
      return;
    }

    // 检查端口是否已被占用（可能是之前的 server 进程）
    if (await this.isPortInUse()) {
      console.log(`[MimoServer] 端口 ${this.port} 已被占用，假设 server 已运行`);
      this.ready = true;
      this.refCount++;
      this.startHealthCheck();
      return;
    }

    if (this.starting) {
      // 等待启动完成
      await this.waitForReady();
      this.refCount++;
      return;
    }

    await this.start();
    this.refCount++;
  }

  /**
   * 释放引用，当引用归零时可选择关闭 server
   */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    // 不立即关闭，保持 server 运行以备后续使用
  }

  /**
   * 检查 server 是否重启过（重启后旧 session 失效）
   */
  wasRestarted(): boolean {
    if (this._wasRestarted) {
      this._wasRestarted = false;
      return true;
    }
    return false;
  }

  /**
   * 启动 mimo serve 进程
   */
  private async start(): Promise<void> {
    this.starting = true;
    console.log(`[MimoServer] 启动 server (port=${this.port})...`);

    try {
      this.serverProcess = spawn(this.mimoPath, [
        'serve',
        '--port', String(this.port),
        '--pure',
      ], {
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.log(`[MimoServer stdout] ${text.substring(0, 200)}`);
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.log(`[MimoServer stderr] ${text.substring(0, 200)}`);
      });

      this.serverProcess.on('exit', (code) => {
        console.log(`[MimoServer] 进程退出, code=${code}`);
        this.serverProcess = null;
        this.ready = false;
        this.stopHealthCheck();
        // 如果还有引用且非正常退出，自动重启
        if (this.refCount > 0 && code !== 0) {
          this._wasRestarted = true;
          console.log('[MimoServer] 异常退出，5秒后自动重启...');
          setTimeout(() => {
            if (this.refCount > 0) {
              this.starting = false;
              this.start().catch(() => {});
            }
          }, 5000);
        }
      });

      this.serverProcess.on('error', (err) => {
        console.error(`[MimoServer] 启动错误: ${err.message}`);
        this.serverProcess = null;
        this.ready = false;
        this.starting = false;
      });

      // 等待 server 就绪
      await this.waitForPortReady();
      this.ready = true;
      this.starting = false;
      this.startHealthCheck();
      console.log(`[MimoServer] server 已就绪 (${this.getServerUrl()})`);
    } catch (err) {
      this.starting = false;
      this.ready = false;
      throw new Error(`MimoServer 启动失败: ${(err as Error).message}`);
    }
  }

  /**
   * 等待端口可用
   */
  private waitForPortReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(`等待 server 端口 ${this.port} 超时`));
      }, STARTUP_TIMEOUT);

      const interval = setInterval(async () => {
        if (await this.isPortInUse()) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 200);
    });
  }

  /**
   * 等待 server 就绪（用于并发启动场景）
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.ready) { resolve(); return; }
        setTimeout(check, 200);
      };
      check();
    });
  }

  /**
   * 检查端口是否被占用
   */
  private isPortInUse(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => {
        server.close(() => resolve(false));
      });
      server.listen(this.port);
    });
  }

  /**
   * 定期健康检查
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(async () => {
      if (!this.serverProcess || this.serverProcess.killed) {
        console.log('[MimoServer] 健康检查: 进程不存在');
        this.ready = false;
        if (this.refCount > 0) {
          console.log('[MimoServer] 尝试重启...');
          this.starting = false;
          this.start().catch(() => {});
        }
        return;
      }

      // 检查端口是否仍在监听
      if (!(await this.isPortInUse())) {
        console.log('[MimoServer] 健康检查: 端口未监听，进程可能已死');
        this.ready = false;
        this._wasRestarted = true;
        try { this.serverProcess.kill('SIGKILL'); } catch {}
        this.serverProcess = null;
        if (this.refCount > 0) {
          this.starting = false;
          this.start().catch(() => {});
        }
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /**
   * 关闭 server（agent-hub 退出时调用）
   */
  async shutdown(): Promise<void> {
    this.stopHealthCheck();
    this.refCount = 0;
    if (this.serverProcess && !this.serverProcess.killed) {
      console.log('[MimoServer] 关闭 server...');
      this.serverProcess.kill('SIGTERM');
      // 给 3 秒优雅退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { this.serverProcess?.kill('SIGKILL'); } catch {}
          resolve();
        }, 3000);
        this.serverProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.serverProcess = null;
    }
    this.ready = false;
  }
}

// 单例导出
let instance: MimoServerManager | null = null;

export function getMimoServerManager(port?: number): MimoServerManager {
  if (!instance) {
    instance = new MimoServerManager(port || DEFAULT_PORT);
  }
  return instance;
}

export default MimoServerManager;
