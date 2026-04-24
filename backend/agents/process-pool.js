const genericPool = require('generic-pool');
const { spawn } = require('child_process');

class CLIProcessPool {
  constructor() {
    this.pools = new Map(); // 按工作目录+Agent类型创建独立池，保证隔离
  }

  getPoolKey(agentType, workdir) {
    return `${agentType}:${workdir}`;
  }

  createPool(agentType, workdir, cliPath, defaultArgs = [], options = {}) {
    const poolKey = this.getPoolKey(agentType, workdir);
    
    if (this.pools.has(poolKey)) {
      return this.pools.get(poolKey);
    }

    const poolOptions = {
      min: 0, // 初始不创建进程，按需创建
      max: 2, // 每个会话最多2个进程，避免资源占用过多
      idleTimeoutMillis: 30000, // 30秒空闲自动销毁
      evictionRunIntervalMillis: 10000, // 每10秒检查一次空闲进程
      acquireTimeoutMillis: 5000, // 获取进程超时时间
      destroyTimeoutMillis: 5000, // 销毁进程超时时间
      testOnBorrow: true, // 借出前验证进程状态
      ...options
    };

    const factory = {
      create: () => {
        return new Promise((resolve, reject) => {
          // 创建一个准备就绪的CLI进程，等待后续输入
          const proc = spawn(cliPath, [...defaultArgs, '--interactive'], {
            cwd: workdir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
            detached: true
          });

          proc.killed = false;
          proc.buffer = '';
          proc.messageQueue = [];

          // 监听stdout输出，解析JSON消息
          proc.stdout.on('data', (data) => {
            proc.buffer += data.toString();
            const lines = proc.buffer.split('\n');
            proc.buffer = lines.pop();
            
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                // 触发对应消息的回调
                if (proc.currentCallback) {
                  proc.currentCallback(msg);
                } else {
                  proc.messageQueue.push(msg);
                }
              } catch (e) {
                // 非JSON输出，忽略或转发到stderr
                proc.stderr && proc.stderr.emit('data', line + '\n');
              }
            }
          });

          // 监听错误和退出
          proc.on('error', (err) => {
            if (!proc.killed) {
              console.error(`[ProcessPool] 进程错误 (pid ${proc.pid}):`, err);
            }
          });

          proc.on('exit', (code, signal) => {
            proc.killed = true;
            if (proc.currentCallback) {
              proc.currentCallback({ type: 'exit', code, signal });
              proc.currentCallback = null;
            }
          });

          // 等待进程准备就绪
          const readyTimeout = setTimeout(() => {
            reject(new Error(`进程启动超时 (pid ${proc.pid})`));
            proc.kill('SIGKILL');
          }, 2000);

          // 检查启动成功的标识
          const checkReady = (msg) => {
            if (msg.type === 'ready' || msg.status === 'ready') {
              clearTimeout(readyTimeout);
              proc.removeListener('message', checkReady);
              resolve(proc);
            }
          };
          proc.currentCallback = checkReady;
        });
      },

      destroy: (proc) => {
        return new Promise((resolve) => {
          if (proc.killed) return resolve();
          
          proc.killed = true;
          proc.removeAllListeners();
          
          try {
            // 发送退出命令
            proc.stdin.write(JSON.stringify({ type: 'exit' }) + '\n');
            // 2秒后强制杀死
            const killTimeout = setTimeout(() => {
              try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
              resolve();
            }, 2000);
            
            proc.once('exit', () => {
              clearTimeout(killTimeout);
              resolve();
            });
          } catch (err) {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
            resolve();
          }
        });
      },

      validate: (proc) => {
        return Promise.resolve(
          !proc.killed &&
          proc.exitCode === null &&
          proc.stdin &&
          !proc.stdin.destroyed
        );
      }
    };

    const pool = genericPool.createPool(factory, poolOptions);
    
    pool.on('factoryCreateError', (err) => {
      console.error(`[ProcessPool] 创建进程失败 (${poolKey}):`, err);
    });
    
    pool.on('factoryDestroyError', (err) => {
      console.error(`[ProcessPool] 销毁进程失败 (${poolKey}):`, err);
    });

    this.pools.set(poolKey, pool);
    return pool;
  }

  async acquire(agentType, workdir, cliPath, defaultArgs = [], options = {}) {
    const pool = this.createPool(agentType, workdir, cliPath, defaultArgs, options);
    return await pool.acquire();
  }

  async release(agentType, workdir, proc) {
    const poolKey = this.getPoolKey(agentType, workdir);
    const pool = this.pools.get(poolKey);
    if (pool && !proc.killed) {
      // 重置进程状态，清理回调
      proc.currentCallback = null;
      proc.messageQueue = [];
      proc.buffer = '';
      await pool.release(proc);
    }
  }

  async destroy(agentType, workdir, proc) {
    const poolKey = this.getPoolKey(agentType, workdir);
    const pool = this.pools.get(poolKey);
    if (pool) {
      await pool.destroy(proc);
    }
  }

  async clearPool(agentType, workdir) {
    const poolKey = this.getPoolKey(agentType, workdir);
    const pool = this.pools.get(poolKey);
    if (pool) {
      await pool.drain();
      await pool.clear();
      this.pools.delete(poolKey);
    }
  }

  async clearAll() {
    for (const pool of this.pools.values()) {
      await pool.drain();
      await pool.clear();
    }
    this.pools.clear();
  }
}

module.exports = new CLIProcessPool();
