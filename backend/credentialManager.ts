/**
 * 证书管理器 - 管理Git凭证（如GitHub令牌、SSH密钥等），独立于项目
 * 凭证按host存储，供项目使用时自动应用
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { Credential, CredentialType } from './types';

const CREDENTIALS_FILE: string = path.join(__dirname, '..', '..', 'data', 'credentials.json');

interface CredentialStore {
  host: string;
  type: CredentialType;
  username?: string;
  secret?: string;
  keyData?: string;
  updatedAt?: string;
}

interface ApplyResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * 默认的凭证存储结构
 */
class CredentialManager {
  private credentials: Map<string, CredentialStore>;

  constructor() {
    this.credentials = new Map();
    this.loadCredentials();
  }

  /**
   * 加载凭证存储
   */
  loadCredentials(): void {
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
          const c = cred as any;
          // 迁移旧格式：key是host且cred里没有host字段
          if (!c.host) { c.host = key; needsMigration = true; }
          this.credentials.set(key, c);
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
  saveCredentials(): void {
    try {
      const dataDir = path.dirname(CREDENTIALS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      // 转换为普通对象以便JSON序列化
      const obj: Record<string, CredentialStore> = {};
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
  private _makeKey(host: string, cred: Partial<CredentialStore>): string {
    const parts: string[] = [];
    if (cred.username) parts.push(cred.username);
    parts.push(host);
    if (cred.type) parts.push(cred.type);
    return parts.join(':');
  }

  /**
   * 添加或更新凭证
   * @param host - 如 github.com
   * @param cred - {type: 'token'|'ssh', username?: string, secret?: string, keyData?: string}
   */
  setCredential(host: string, cred: Partial<CredentialStore>): void {
    if (!host) throw new Error('Host is required');
    const now = new Date().toISOString();
    const key = this._makeKey(host, cred);
    const toStore: CredentialStore = {
      ...cred,
      host,
      updatedAt: now
    } as CredentialStore;
    this.credentials.set(key, toStore);
    this.saveCredentials();
  }

  /**
   * 删除凭证
   * @param key - 如 "git@github.com" 或 "github.com"
   */
  removeCredential(key: string): void {
    this.credentials.delete(key);
    this.saveCredentials();
  }

  /**
   * 获取单个凭证（精确key匹配）
   * @param key - 如 "git@github.com"
   */
  getCredential(key: string): CredentialStore | null {
    return this.credentials.get(key) || null;
  }

  /**
   * 列出所有凭证（不泄露secret）
   */
  listCredentials(): Array<Record<string, unknown>> {
    const list: Array<Record<string, unknown>> = [];
    for (const [key, cred] of this.credentials.entries()) {
      const { secret, keyData, ...safe } = cred;
      list.push({ key, ...safe });
    }
    return list;
  }

  /**
   * 获取某个host的所有凭证
   * @param host
   */
  getCredentialsForHost(host: string): CredentialStore[] {
    if (!host) return [];
    const results: CredentialStore[] = [];
    for (const [key, cred] of this.credentials.entries()) {
      if (cred.host === host || key === host || key.includes(`:${host}:`) || key.endsWith(`:${host}`)) {
        results.push(cred);
      }
    }
    return results;
  }

  /**
   * 根据host获取最佳匹配凭证
   * @param host
   */
  getCredentialForHost(host: string): CredentialStore | null {
    if (!host) return null;
    const creds = this.getCredentialsForHost(host);
    if (creds.length === 0) return null;
    // 多个时返回第一个（调用方可根据协议类型再筛选）
    return creds[0];
  }

  /**
   * 检查host是否有可用凭证（包括系统级凭证如SSH config）
   * @param host - 如 github.com
   * @param workdir - 可选的工作目录，用于检测项目级凭证
   */
  hasCredentialForHost(host: string, workdir?: string): boolean {
    if (!host) return false;

    // 判断项目用的是 SSH 还是 HTTPS
    let remoteProtocol: 'ssh' | 'https' | null = null;
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
   * @param workdir
   * @param cred - 从 getCredentialForHost 获取的凭证对象
   */
  applyCredentialToWorkdir(workdir: string, cred: CredentialStore): ApplyResult {
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
        const username = cred.username || 'git';
        const secret = cred.secret;
        if (!secret) {
          return { success: false, message: 'Token缺失' };
        }

        const host = cred.host;
        if (!host) {
          return { success: false, message: '凭证缺少host信息' };
        }
        const credentialsLine = `https://${username}:${secret}@${host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8));
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        execSync('git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"', {
          cwd: workdir
        });
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
    } catch (error: any) {
      return { success: false, message: `配置失败: ${error.message}` };
    }
  }

  /**
   * 根据host将凭证应用到所有匹配的项目
   */
  applyToAllKnownProjects(projectManager: any): void {
    try {
      const projects = projectManager.listProjects();
      for (const proj of projects) {
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
   * @param workdir
   * @returns 如 github.com
   */
  private _detectHostFromProject(workdir: string): string | null {
    try {
      let url: string;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      } catch (e) {
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

      let host: string | null = null;
      if (url.startsWith('https://')) {
        const afterProtocol = url.substring(8);
        const slashIdx = afterProtocol.indexOf('/');
        if (slashIdx !== -1) {
          host = afterProtocol.substring(0, slashIdx);
        }
      } else if (url.startsWith('git@')) {
        const afterAt = url.substring(4);
        const colonIdx = afterAt.indexOf(':');
        if (colonIdx !== -1) {
          host = afterAt.substring(0, colonIdx);
        }
      } else if (url.startsWith('ssh://')) {
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
      return null;
    }
  }
}

const instance = new CredentialManager();
export default instance;
