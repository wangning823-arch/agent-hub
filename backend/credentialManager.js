/**
 * 证书管理器 - 管理Git凭证（如GitHub令牌、SSH密钥等），独立于项目
 * 凭证按host存储，供项目使用时自动应用
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CREDENTIALS_FILE = path.join(__dirname, '..', 'data', 'credentials.json');

/**
 * 默认的凭证存储结构
 * {
 *   "github.com": {
 *     "type": "token",
 *     "username": "git",
 *     "secret": "ghp_xxxxxx", // 实际应加密存储，这里先明文存储，注意文件权限
 *     "updatedAt": "2026-04-21T..."
 *   },
 *   "gitlab.com": { ... }
 * }
 */
class CredentialManager {
  constructor() {
    this.credentials = new Map(); // host -> credObj
    this.loadCredentials();
  }

  /**
   * 加载凭证存储
   */
  loadCredentials() {
    try {
      const dataDir = path.dirname(CREDENTIALS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
        const obj = JSON.parse(raw);
        let needsMigration = false;
        for (const [key, cred] of Object.entries(obj)) {
          // 迁移旧格式：key是host且cred里没有host字段
          if (!cred.host) { cred.host = key; needsMigration = true; }
          this.credentials.set(key, cred);
        }
        if (needsMigration) this.saveCredentials();
      }
    } catch (error) {
      console.error('加载凭证失败:', error);
      this.credentials = new Map();
    }
  }

  /**
   * 保存凭证到文件
   */
  saveCredentials() {
    try {
      const dataDir = path.dirname(CREDENTIALS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      // 转换为普通对象以便JSON序列化
      const obj = {};
      for (const [host, cred] of this.credentials.entries()) {
        obj[host] = cred;
      }
      fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(obj, null, 2));
      // 确保文件只有所有者可读写
      fs.chmodSync(CREDENTIALS_FILE, parseInt('600', 8));
    } catch (error) {
      console.error('保存凭证失败:', error);
    }
  }

  /**
   * 生成存储key
   */
  _makeKey(host, cred) {
    const parts = [];
    if (cred.username) parts.push(cred.username);
    parts.push(host);
    if (cred.type) parts.push(cred.type);
    return parts.join(':');
  }

  /**
   * 添加或更新凭证
   * @param {string} host - 如 github.com
   * @param {Object} cred - {type: 'token'|'ssh', username?: string, secret?: string, keyData?: string}
   */
  setCredential(host, cred) {
    if (!host) throw new Error('Host is required');
    const now = new Date().toISOString();
    const key = this._makeKey(host, cred);
    const toStore = {
      ...cred,
      host,
      updatedAt: now
    };
    this.credentials.set(key, toStore);
    this.saveCredentials();
  }

  /**
   * 删除凭证
   * @param {string} key - 如 "git@github.com" 或 "github.com"
   */
  removeCredential(key) {
    this.credentials.delete(key);
    this.saveCredentials();
  }

  /**
   * 获取单个凭证（精确key匹配）
   * @param {string} key - 如 "git@github.com"
   * @returns {Object|null}
   */
  getCredential(key) {
    return this.credentials.get(key) || null;
  }

  /**
   * 列出所有凭证（不泄露secret）
   */
  listCredentials() {
    const list = [];
    for (const [key, cred] of this.credentials.entries()) {
      const { secret, keyData, ...safe } = cred;
      list.push({ key, ...safe });
    }
    return list;
  }

  /**
   * 获取某个host的所有凭证
   * @param {string} host
   * @returns {Array}
   */
  getCredentialsForHost(host) {
    if (!host) return [];
    const results = [];
    for (const [key, cred] of this.credentials.entries()) {
      if (cred.host === host || key === host || key.includes(`:${host}:`) || key.endsWith(`:${host}`)) {
        results.push(cred);
      }
    }
    return results;
  }

  /**
   * 根据host获取最佳匹配凭证
   * @param {string} host
   * @returns {Object|null}
   */
  getCredentialForHost(host) {
    if (!host) return null;
    const creds = this.getCredentialsForHost(host);
    if (creds.length === 0) return null;
    // 多个时返回第一个（调用方可根据协议类型再筛选）
    return creds[0];
  }

  /**
   * 检查host是否有可用凭证（包括系统级凭证如SSH config）
   * @param {string} host - 如 github.com
   * @param {string} [workdir] - 可选的工作目录，用于检测项目级凭证
   * @returns {boolean}
   */
  hasCredentialForHost(host, workdir) {
    if (!host) return false;

    // 判断项目用的是 SSH 还是 HTTPS
    let remoteProtocol = null; // 'ssh' | 'https' | null
    let remoteUrl = '';
    if (workdir) {
      try {
        remoteUrl = execSync('git config --local --get remote.origin.url', {
          cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        if (remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://')) remoteProtocol = 'ssh';
        else if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) remoteProtocol = 'https';
      } catch (e) {}
    }

    // 1. credentialManager 中匹配协议类型的凭证
    const storedCred = this.getCredentialForHost(host);
    if (storedCred) {
      // 如果知道项目协议，必须类型匹配
      if (remoteProtocol === 'ssh' && storedCred.type === 'ssh') return true;
      if (remoteProtocol === 'https' && storedCred.type === 'token') return true;
      // 如果不知道协议，任何凭证都算有
      if (!remoteProtocol) return true;
    }

    // 2. SSH 配置中有匹配的 IdentityFile
    if (remoteProtocol === 'ssh' || !remoteProtocol) {
      try {
        const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
        if (fs.existsSync(sshConfigPath)) {
          const sshConfig = fs.readFileSync(sshConfigPath, 'utf8');
          const blocks = sshConfig.split(/\nHost\s+/i);
          for (const block of blocks) {
            const lines = block.split('\n');
            const blockHost = lines[0]?.trim().toLowerCase();
            if (blockHost === host || blockHost === '*') {
              for (const line of lines) {
                if (/^\s*IdentityFile\s+/i.test(line)) {
                  const p = line.replace(/^\s*IdentityFile\s+/i, '').trim().replace('~', os.homedir());
                  if (fs.existsSync(p)) return true;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // 3. HTTPS: 项目级 .git/credentials 或 remote URL 嵌入凭证
    if ((remoteProtocol === 'https' || !remoteProtocol) && workdir) {
      try {
        const credFile = path.join(workdir, '.git', 'credentials');
        if (fs.existsSync(credFile)) return true;
        if (remoteUrl && remoteUrl.includes('@')) return true;
      } catch (e) {}
    }

    return false;
  }

  /**
   * 将给定的凭证应用到指定工作目录的git配置中
   * @param {string} workdir
   * @param {Object} cred - 从 getCredentialForHost 获取的凭证对象
   * @returns {Object} {success: boolean, message?: string, error?: string}
   */
  applyCredentialToWorkdir(workdir, cred) {
    try {
      // 确认是git仓库
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: false, message: '非Git仓库' };
      }

      // 根据凭证类型应用不同配置
      if (cred.type === 'token') {
        // 使用凭证助手存储
        execSync(`git config --local credential.helper "store --file=.git/credentials"`, {
          cwd: workdir
        });
        // 写入凭证文件
        // 格式: https://username:token@host
        // 如果没有username则默认git
        const username = cred.username || 'git';
        const secret = cred.secret;
        if (!secret) {
          return { success: false, message: 'Token缺失' };
        }
        // 使用cred中存储的host信息

        const host = cred.host; // 我们需要在setCredential时确保cred包含host
        if (!host) {
          return { success: false, message: '凭证缺少host信息' };
        }
        const credentialsLine = `https://${username}:${secret}@${host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8)); // 仅所有者可读写
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        // 配置使用SSH，并指定私钥路径或使用ssh-agent
        // 这里我们支持两种方式：
        // 1. 如果提供了keyData（私钥内容），我们写入临时文件并指定IdentityFile
        // 2. 否则假设密钥已经在~/.ssh中且ssh-agent可用，只需确保不使用凭证助手阻断
        // 为了简单，我们只处理已有密钥的情况：确保git使用ssh并关闭严格hostkey检查
        execSync('git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"', {
          cwd: workdir
        });
        // 如果提供了私钥数据，则写入到工作目录下的临时文件并配置
        if (cred.keyData) {
          const keyPath = path.join(workdir, '.git', 'id_rsa');
          fs.writeFileSync(keyPath, cred.keyData, { encoding: 'utf8' });
          fs.chmodSync(keyPath, parseInt('600', 8));
          execSync(`git config --local core.sshCommand "ssh -i ${keyPath} -o StrictHostKeyChecking=no"`, {
            cwd: workdir
          });
        }
        return { success: true, message: 'SSH凭证已配置' };
      } else {
        return { success: false, message: `未知凭证类型: ${cred.type}` };
      }
    } catch (error) {
      return { success: false, message: `配置失败: ${error.message}` };
    }
  }

  /**
   * 根据host将凭证应用到所有匹配的项目（即工作目录中存在.git且remote URL包含该host的项目）
   * 这里我们简单遍历所有已知项目（需要从projectManager获取列表），但为了解耦，
   * 我们可以在项目管理器中调用此方法，或者提供一个供外部调用的函数。
   * 由于这里依赖项目列表，我们暂时不实现自动应用，而是让项目管理器在add/update时主动调用。
   * 但我们可以提供一个方法给外部调用：applyToAllKnownProjects(projectManager)
   */
  applyToAllKnownProjects(projectManager) {
    try {
      const projects = projectManager.listProjects(); // 假设有此方法
      for (const proj of projects) {
        // 从项目的remote URL获取host
        const host = this._detectHostFromProject(proj.workdir);
        if (host) {
          const cred = this.getCredentialForHost(host);
          if (cred) {
            this.applyCredentialToWorkdir(proj.workdir, cred);
          }
        }
      }
    } catch (e) {
      console.error('批量应用凭证时出错:', e);
    }
  }

  /**
   * 私有方法：从项目工作目录检测git remote的host
   * @param {string} workdir
   * @returns {string|null} 如 github.com
   */
  _detectHostFromProject(workdir) {
    try {
      // 获取第一个remote的url（通常是origin）
      let url;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      } catch (e) {
        // 可能没有origin，试着获取任何remote
        const remotes = execSync('git remote', { cwd: workdir, encoding: 'utf8' })
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (remotes.length === 0) return null;
        url = execSync(`git config --local --get remote.${remotes[0]}.url`, {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      }
      if (!url) return null;
      // 解析host
      // 支持两种格式:
      // 1. https://github.com/user/repo.git
      // 2. git@github.com:user/repo.git
      let host = null;
      if (url.startsWith('https://')) {
        const afterProtocol = url.substring(8);
        const slashIdx = afterProtocol.indexOf('/');
        if (slashIdx !== -1) {
          host = afterProtocol.substring(0, slashIdx);
        }
      } else if (url.startsWith('git@')) {
        // git@host:user/repo
        const afterAt = url.substring(4);
        const colonIdx = afterAt.indexOf(':');
        if (colonIdx !== -1) {
          host = afterAt.substring(0, colonIdx);
        }
      } else if (url.startsWith('ssh://')) {
        // ssh://git@host/user/repo
        const afterProto = url.substring(6);
        const atIdx = afterProto.indexOf('@');
        if (atIdx !== -1) {
          const afterAt = afterProto.substring(atIdx + 1);
          const slashIdx = afterAt.indexOf('/');
          if (slashIdx !== -1) {
            host = afterAt.substring(0, slashIdx);
          }
        }
      }
      return host;
    } catch (e) {
      // 忽略错误，返回null表示无法检测
      return null;
    }
  }
}

const instance = new CredentialManager();
module.exports = instance;