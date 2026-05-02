/**
 * 凭证管理器 - 使用 SQLite 管理Git凭证
 * 双层模式：系统凭证 (owner_id=NULL, 管理员管理) + 个人凭证 (owner_id=userId, 用户自建)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getDb, saveToFile } from './db';

interface CredentialRow {
  id: string;
  host: string;
  type: string;
  username?: string;
  secret?: string;
  key_data?: string;
  owner_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface ApplyResult {
  success: boolean;
  message?: string;
  error?: string;
}

class CredentialManager {
  /**
   * 生成存储 key（兼容旧接口）
   */
  private _makeKey(host: string, cred: Partial<CredentialRow>): string {
    const parts: string[] = [];
    if (cred.username) parts.push(cred.username);
    parts.push(host);
    if (cred.type) parts.push(cred.type);
    return parts.join(':');
  }

  /**
   * 设置凭证（系统级，兼容旧接口）
   */
  setCredential(host: string, cred: Partial<CredentialRow>): void {
    if (!host) throw new Error('Host is required');
    const db = getDb();
    const now = new Date().toISOString();
    const id = `cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    db.run(
      `INSERT INTO credentials (id, host, type, username, secret, key_data, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [id, host, cred.type || 'token', cred.username || null, cred.secret || null, cred.key_data || null, now, now]
    );
    saveToFile();
  }

  /**
   * 设置凭证（带 owner_id）
   */
  setCredentialWithOwner(host: string, cred: Partial<CredentialRow>, ownerId: string | null): string {
    if (!host) throw new Error('Host is required');
    const db = getDb();
    const now = new Date().toISOString();
    const id = `cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    db.run(
      `INSERT INTO credentials (id, host, type, username, secret, key_data, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, host, cred.type || 'token', cred.username || null, cred.secret || null, cred.key_data || null, ownerId, now, now]
    );
    saveToFile();
    return id;
  }

  /**
   * 删除凭证
   */
  removeCredential(idOrKey: string): void {
    const db = getDb();
    // 尝试按 ID 删除
    const result = db.exec(`SELECT id FROM credentials WHERE id = '${idOrKey.replace(/'/g, "''")}'`);
    if (result.length > 0 && result[0].values.length > 0) {
      db.run(`DELETE FROM credentials WHERE id = '${idOrKey.replace(/'/g, "''")}'`);
    } else {
      // 兼容旧的 key 格式（host 或 username:host:type），按 host 匹配
      const parts = idOrKey.split(':');
      const host = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      db.run(`DELETE FROM credentials WHERE host = '${host.replace(/'/g, "''")}' AND owner_id IS NULL`);
    }
    saveToFile();
  }

  /**
   * 按 ID 删除凭证
   */
  removeCredentialById(id: string): void {
    const db = getDb();
    db.run(`DELETE FROM credentials WHERE id = '${id.replace(/'/g, "''")}'`);
    saveToFile();
  }

  /**
   * 获取单个凭证（兼容旧接口）
   */
  getCredential(key: string): CredentialRow | null {
    const db = getDb();
    const result = db.exec(`SELECT * FROM credentials WHERE id = '${key.replace(/'/g, "''")}'`);
    if (result.length > 0 && result[0].values.length > 0) {
      return this._rowToCredential(result[0].values[0], result[0].columns);
    }
    return null;
  }

  /**
   * 获取凭证按 ID
   */
  getCredentialById(id: string): CredentialRow | null {
    const db = getDb();
    const result = db.exec(`SELECT * FROM credentials WHERE id = '${id.replace(/'/g, "''")}'`);
    if (result.length > 0 && result[0].values.length > 0) {
      return this._rowToCredential(result[0].values[0], result[0].columns);
    }
    return null;
  }

  /**
   * 列出所有凭证（不含密钥）- 兼容旧接口
   */
  listCredentials(): Array<Record<string, unknown>> {
    const db = getDb();
    const result = db.exec('SELECT id, host, type, username, owner_id, created_at, updated_at FROM credentials ORDER BY updated_at DESC');
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => {
      const obj: Record<string, unknown> = {};
      result[0].columns.forEach((col, i) => { obj[col] = row[i]; });
      obj['key'] = obj['id'];
      return obj;
    });
  }

  /**
   * 列出系统凭证（不含密钥）
   */
  listSystemCredentials(): CredentialRow[] {
    const db = getDb();
    const result = db.exec('SELECT id, host, type, username, owner_id, created_at, updated_at FROM credentials WHERE owner_id IS NULL ORDER BY updated_at DESC');
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => this._rowToCredential(row, result[0].columns));
  }

  /**
   * 列出用户凭证（不含密钥）
   */
  listUserCredentials(userId: string): CredentialRow[] {
    const db = getDb();
    const uid = userId.replace(/'/g, "''");
    const result = db.exec(`SELECT id, host, type, username, owner_id, created_at, updated_at FROM credentials WHERE owner_id = '${uid}' ORDER BY updated_at DESC`);
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => this._rowToCredential(row, result[0].columns));
  }

  /**
   * 获取某个 host 的所有凭证（兼容旧接口）
   */
  getCredentialsForHost(host: string): CredentialRow[] {
    if (!host) return [];
    const db = getDb();
    const safeHost = host.replace(/'/g, "''");
    const result = db.exec(`SELECT * FROM credentials WHERE host = '${safeHost}'`);
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => this._rowToCredential(row, result[0].columns));
  }

  /**
   * 根据 host 获取最佳匹配凭证（兼容旧接口）
   */
  getCredentialForHost(host: string): CredentialRow | null {
    if (!host) return null;
    const creds = this.getCredentialsForHost(host);
    return creds.length > 0 ? creds[0] : null;
  }

  /**
   * 根据 host 获取凭证（系统级，用于 git 操作）
   */
  getSystemCredentialForHost(host: string): CredentialRow | null {
    if (!host) return null;
    const db = getDb();
    const safeHost = host.replace(/'/g, "''");
    const result = db.exec(`SELECT * FROM credentials WHERE host = '${safeHost}' AND owner_id IS NULL LIMIT 1`);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this._rowToCredential(result[0].values[0], result[0].columns);
  }

  /**
   * 根据 host 获取凭证（个人级）
   */
  getPersonalCredentialForHost(host: string, userId: string): CredentialRow | null {
    if (!host || !userId) return null;
    const db = getDb();
    const safeHost = host.replace(/'/g, "''");
    const uid = userId.replace(/'/g, "''");
    const result = db.exec(`SELECT * FROM credentials WHERE host = '${safeHost}' AND owner_id = '${uid}' LIMIT 1`);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this._rowToCredential(result[0].values[0], result[0].columns);
  }

  /**
   * 获取用户可用的凭证（系统已分配 + 个人）
   */
  getAvailableCredentialForHost(host: string, userId: string): CredentialRow | null {
    if (!host) return null;

    // 1. 先查个人凭证
    const personal = this.getPersonalCredentialForHost(host, userId);
    if (personal) return personal;

    // 2. 再查已分配的系统凭证
    const db = getDb();
    const safeHost = host.replace(/'/g, "''");
    const uid = userId.replace(/'/g, "''");
    const result = db.exec(
      `SELECT c.* FROM credentials c JOIN user_credentials uc ON c.id = uc.credential_id WHERE c.host = '${safeHost}' AND c.owner_id IS NULL AND uc.user_id = '${uid}' LIMIT 1`
    );
    if (result.length > 0 && result[0].values.length > 0) {
      return this._rowToCredential(result[0].values[0], result[0].columns);
    }

    // 3. 回退到任何系统凭证
    return this.getSystemCredentialForHost(host);
  }

  /**
   * 检查 host 是否有可用凭证
   */
  hasCredentialForHost(host: string, workdir?: string): boolean {
    if (!host) return false;

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

    // 1. 数据库中匹配的凭证
    const storedCred = this.getCredentialForHost(host);
    if (storedCred) {
      if (remoteProtocol === 'ssh' && storedCred.type === 'ssh') return true;
      if (remoteProtocol === 'https' && storedCred.type === 'token') return true;
      if (!remoteProtocol) return true;
    }

    // 2. SSH config
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

    // 3. HTTPS 项目级凭证
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
   * 将凭证应用到工作目录
   */
  applyCredentialToWorkdir(workdir: string, cred: CredentialRow): ApplyResult {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: false, message: '非Git仓库' };
      }

      if (cred.type === 'token') {
        execSync('git config --local credential.helper "store --file=.git/credentials"', { cwd: workdir });
        const username = cred.username || 'git';
        const secret = cred.secret;
        if (!secret) return { success: false, message: 'Token缺失' };
        const host = cred.host;
        if (!host) return { success: false, message: '凭证缺少host信息' };
        const credentialsLine = `https://${username}:${secret}@${host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8));
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        execSync('git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"', { cwd: workdir });
        if (cred.key_data) {
          const keyPath = path.join(workdir, '.git', 'id_rsa');
          fs.writeFileSync(keyPath, cred.key_data, { encoding: 'utf8' });
          fs.chmodSync(keyPath, parseInt('600', 8));
          execSync(`git config --local core.sshCommand "ssh -i ${keyPath} -o StrictHostKeyChecking=no"`, { cwd: workdir });
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
   * 根据 host 将凭证应用到所有匹配的项目
   */
  applyToAllKnownProjects(projectManager: any): void {
    try {
      const projects = projectManager.listProjects();
      for (const proj of projects) {
        const host = this._detectHostFromProject(proj.workdir);
        if (host) {
          const cred = this.getSystemCredentialForHost(host);
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
   * 获取凭证的 key（兼容旧接口）
   */
  getCredentialKey(cred: CredentialRow): string {
    return this._makeKey(cred.host, cred);
  }

  // ── Private ──

  private _rowToCredential(row: any[], columns: string[]): CredentialRow {
    const obj: any = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj as CredentialRow;
  }

  private _detectHostFromProject(workdir: string): string | null {
    try {
      let url: string;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir, encoding: 'utf8'
        }).trim();
      } catch (e) {
        const remotes = execSync('git remote', { cwd: workdir, encoding: 'utf8' })
          .trim().split(/\s+/).filter(Boolean);
        if (remotes.length === 0) return null;
        url = execSync(`git config --local --get remote.${remotes[0]}.url`, {
          cwd: workdir, encoding: 'utf8'
        }).trim();
      }
      if (!url) return null;

      let host: string | null = null;
      if (url.startsWith('https://')) {
        const after = url.substring(8);
        const slashIdx = after.indexOf('/');
        if (slashIdx !== -1) host = after.substring(0, slashIdx);
      } else if (url.startsWith('git@')) {
        const afterAt = url.substring(4);
        const colonIdx = afterAt.indexOf(':');
        if (colonIdx !== -1) host = afterAt.substring(0, colonIdx);
      } else if (url.startsWith('ssh://')) {
        const afterProto = url.substring(6);
        const atIdx = afterProto.indexOf('@');
        if (atIdx !== -1) {
          const afterAt = afterProto.substring(atIdx + 1);
          const slashIdx = afterAt.indexOf('/');
          if (slashIdx !== -1) host = afterAt.substring(0, slashIdx);
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
