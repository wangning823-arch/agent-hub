/**
 * Mimo Server Manager
 * 管理 mimo serve 常驻进程的生命周期
 * 所有 mimo agent 共享同一个 server 实例
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import * as net from 'net';
import * as http from 'http';
import { findMimoPath } from './utils/mimo-path';

const DEFAULT_PORT = 14096;
const HEALTH_CHECK_INTERVAL = 30_000;
const STARTUP_TIMEOUT = 10_000;
// 4小时后自动重启 server，防止 SQLite WAL 堆积导致卡死
const SERVER_MAX_UPTIME_MS = 4 * 60 * 60 * 1000;

class MimoServerManager {
  private serverProcess: ChildProcess | null = null;
  private port: number;
  private mimoPath: string;
  private starting: boolean = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private refCount: number = 0;
  private ready: boolean = false;
  private _wasRestarted: boolean = false;
  private _startedAt: number = 0;

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
      // 端口被占用不代表 server 正常工作（可能是僵尸进程），
      // 需要实际尝试连接验证
      if (await this.isServerAlive()) {
        console.log(`[MimoServer] 端口 ${this.port} 已被占用且 server 响应正常`);
        this.ready = true;
        this.refCount++;
        this.startHealthCheck();
        return;
      }
      // 端口被占用但 server 无响应，尝试清理僵尸进程
      console.log(`[MimoServer] 端口 ${this.port} 被占用但 server 无响应，尝试清理僵尸进程`);
      await this.killZombieProcess();
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
   * 幂等：多次调用返回相同结果，由调用方显式 clearRestarted() 重置
   */
  wasRestarted(): boolean {
    return this._wasRestarted;
  }

  /**
   * 显式清除重启标志。调用方在处理完重启后调用。
   */
  clearRestarted(): void {
    this._wasRestarted = false;
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
      this._startedAt = Date.now();
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
   * 通过 HTTP 请求验证 server 是否真正可用（不仅仅是端口被占用）
   */
  private isServerAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.port}/`, { timeout: 3000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /**
   * 清理占用端口的僵尸进程
   */
  private async killZombieProcess(): Promise<void> {
    try {
      // 找到占用端口的进程并杀掉
      const result = execSync(`lsof -ti :${this.port} 2>/dev/null || ss -tlnp sport = :${this.port} 2>/dev/null | grep -oP 'pid=\\K[0-9]+'`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (result) {
        const pids = result.split('\n').filter(Boolean);
        for (const pid of pids) {
          console.log(`[MimoServer] 杀掉僵尸进程 PID=${pid}`);
          try { process.kill(Number(pid), 'SIGKILL'); } catch {}
        }
        // 等待端口释放
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch {}
  }

  /**
   * 定期健康检查 + 定期重启防止 WAL 堆积
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

      // 定期重启：运行超过4小时后主动重启，防止 SQLite WAL 堆积导致卡死
      const uptime = Date.now() - this._startedAt;
      if (this._startedAt > 0 && uptime > SERVER_MAX_UPTIME_MS) {
        const hours = Math.round(uptime / 3600000);
        console.log(`[MimoServer] server 已运行 ${hours} 小时，定期重启以防止 WAL 堆积`);
        this.ready = false;
        this._wasRestarted = true;
        try { this.serverProcess.kill('SIGTERM'); } catch {}
        this.serverProcess = null;
        // 给旧进程3秒优雅退出
        await new Promise(r => setTimeout(r, 3000));
        await this.killZombieProcess();
        if (this.refCount > 0) {
          this.starting = false;
          this.start().catch(() => {});
        }
        return;
      }

      // 检查端口是否仍在监听，且 server 是否真正可用
      if (!(await this.isPortInUse()) || !(await this.isServerAlive())) {
        console.log('[MimoServer] 健康检查: server 不可用（端口未监听或无响应），尝试重启');
        this.ready = false;
        this._wasRestarted = true;
        try { this.serverProcess.kill('SIGKILL'); } catch {}
        this.serverProcess = null;
        await this.killZombieProcess();
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
