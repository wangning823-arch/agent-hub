/**
 * 凭证路由 - 双层模式
 * systemRouter: 管理员管理系统凭证 (owner_id=NULL)
 * myCredentialsRouter: 用户管理个人凭证 + 查看已分配的系统凭证
 */
import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb, saveToFile } from '../db';
import { requireAdmin } from '../middleware/userAuth';
import credentialManager from '../credentialManager';

export default () => {
  const systemRouter = Router();
  const myCredentialsRouter = Router();

  systemRouter.use(requireAdmin);

  // ═══════════════════════════════════════
  // System Router (管理员)
  // ═══════════════════════════════════════

  // 列出所有系统凭证
  systemRouter.get('/', (_req: Request, res: Response) => {
    try {
      const creds = credentialManager.listSystemCredentials();
      const safe = creds.map(c => {
        const { secret, key_data, ...rest } = c as any;
        return { ...rest, key: c.id };
      });
      res.json({ credentials: safe });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 添加系统凭证
  systemRouter.post('/', (req: Request, res: Response) => {
    try {
      const { host, type, username, secret, keyData } = req.body;
      if (!host || !type) {
        return res.status(400).json({ error: 'host和type是必需的' });
      }
      if (!['token', 'ssh'].includes(type)) {
        return res.status(400).json({ error: 'type必须是token或ssh' });
      }
      if (type === 'token' && !secret) {
        return res.status(400).json({ error: 'Token类型需要secret' });
      }
      if (type === 'ssh' && !keyData) {
        return res.status(400).json({ error: 'SSH类型需要keyData' });
      }

      const id = credentialManager.setCredentialWithOwner(host, {
        type, username, secret, key_data: keyData
      }, null);

      res.json({ success: true, id, message: `已为 ${username ? username + '@' : ''}${host} 设置系统凭证` });
    } catch (error: any) {
      console.error('设置系统凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 更新系统凭证
  systemRouter.put('/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const credId = req.params.id.replace(/'/g, "''");
      const existing = db.exec(`SELECT id FROM credentials WHERE id = '${credId}' AND owner_id IS NULL`);
      if (existing.length === 0 || existing[0].values.length === 0) {
        return res.status(404).json({ error: '系统凭证不存在' });
      }

      const { host, type, username, secret, keyData } = req.body;
      const updates: string[] = [];
      const params: any[] = [];

      if (host) { updates.push('host = ?'); params.push(host); }
      if (type) { updates.push('type = ?'); params.push(type); }
      if (username !== undefined) { updates.push('username = ?'); params.push(username || null); }
      if (secret !== undefined) { updates.push('secret = ?'); params.push(secret || null); }
      if (keyData !== undefined) { updates.push('key_data = ?'); params.push(keyData || null); }

      if (updates.length === 0) {
        return res.status(400).json({ error: '没有要更新的字段' });
      }

      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(credId);

      db.run(`UPDATE credentials SET ${updates.join(', ')} WHERE id = ?`, params);
      saveToFile();

      res.json({ success: true, message: '凭证已更新' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 删除系统凭证
  systemRouter.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const credId = req.params.id.replace(/'/g, "''");
      const existing = db.exec(`SELECT id FROM credentials WHERE id = '${credId}' AND owner_id IS NULL`);
      if (existing.length === 0 || existing[0].values.length === 0) {
        return res.status(404).json({ error: '系统凭证不存在' });
      }
      credentialManager.removeCredentialById(credId);
      res.json({ success: true, message: '凭证已删除' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 从项目扫描凭证
  systemRouter.post('/scan', (req: Request, res: Response) => {
    try {
      const { workdir } = req.body;
      if (!workdir) {
        return res.status(400).json({ error: 'workdir是必需的' });
      }
      const results = scanGitCredentials(workdir, process.env.HOME || '/root');
      res.json(results);
    } catch (error: any) {
      console.error('扫描凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ═══════════════════════════════════════
  // My Credentials Router (用户)
  // ═══════════════════════════════════════

  // 获取当前用户可用的凭证（系统已分配 + 个人）
  myCredentialsRouter.get('/', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const uid = req.user!.userId.replace(/'/g, "''");

      let systemCreds: any[] = [];
      let personalCreds: any[] = [];

      if (req.user!.role === 'admin') {
        // Admin 看所有系统凭证
        const result = db.exec('SELECT id, host, type, username, owner_id, created_at, updated_at FROM credentials WHERE owner_id IS NULL ORDER BY updated_at DESC');
        if (result.length > 0) {
          systemCreds = result[0].values.map((row: any[]) => {
            const obj: any = {};
            result[0].columns.forEach((col, i) => { obj[col] = row[i]; });
            obj.isPersonal = false;
            return obj;
          });
        }
      } else {
        // 被分配的系统凭证
        const assignedResult = db.exec(
          `SELECT c.id, c.host, c.type, c.username, c.owner_id, c.created_at, c.updated_at
           FROM credentials c JOIN user_credentials uc ON c.id = uc.credential_id
           WHERE uc.user_id = '${uid}' AND c.owner_id IS NULL ORDER BY c.updated_at DESC`
        );
        if (assignedResult.length > 0) {
          systemCreds = assignedResult[0].values.map((row: any[]) => {
            const obj: any = {};
            assignedResult[0].columns.forEach((col, i) => { obj[col] = row[i]; });
            obj.isPersonal = false;
            return obj;
          });
        }
      }

      // 个人凭证
      const personalResult = db.exec(
        `SELECT id, host, type, username, owner_id, created_at, updated_at FROM credentials WHERE owner_id = '${uid}' ORDER BY updated_at DESC`
      );
      if (personalResult.length > 0) {
        personalCreds = personalResult[0].values.map((row: any[]) => {
          const obj: any = {};
          personalResult[0].columns.forEach((col, i) => { obj[col] = row[i]; });
          obj.isPersonal = true;
          return obj;
        });
      }

      res.json({ credentials: [...systemCreds, ...personalCreds] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 添加个人凭证
  myCredentialsRouter.post('/', (req: Request, res: Response) => {
    try {
      const { host, type, username, secret, keyData } = req.body;
      if (!host || !type) {
        return res.status(400).json({ error: 'host和type是必需的' });
      }
      if (!['token', 'ssh'].includes(type)) {
        return res.status(400).json({ error: 'type必须是token或ssh' });
      }
      if (type === 'token' && !secret) {
        return res.status(400).json({ error: 'Token类型需要secret' });
      }
      if (type === 'ssh' && !keyData) {
        return res.status(400).json({ error: 'SSH类型需要keyData' });
      }

      const uid = req.user!.userId;
      const id = credentialManager.setCredentialWithOwner(host, {
        type, username, secret, key_data: keyData
      }, uid);

      res.json({ success: true, id, message: `已为 ${username ? username + '@' : ''}${host} 设置凭证` });
    } catch (error: any) {
      console.error('设置个人凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 删除个人凭证
  myCredentialsRouter.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const credId = req.params.id.replace(/'/g, "''");
      const uid = req.user!.userId.replace(/'/g, "''");

      const existing = db.exec(`SELECT id, owner_id FROM credentials WHERE id = '${credId}'`);
      if (existing.length === 0 || existing[0].values.length === 0) {
        return res.status(404).json({ error: '凭证不存在' });
      }

      const ownerId = existing[0].values[0][1];
      if (ownerId !== null && ownerId !== uid) {
        return res.status(403).json({ error: '无权删除此凭证' });
      }

      credentialManager.removeCredentialById(credId);
      res.json({ success: true, message: '凭证已删除' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 扫描项目凭证（个人）
  myCredentialsRouter.post('/scan', (req: Request, res: Response) => {
    try {
      const { workdir } = req.body;
      if (!workdir) {
        return res.status(400).json({ error: 'workdir是必需的' });
      }

      const userRoot = (req.user && req.user.role !== 'admin')
        ? req.user.homeDir
        : (process.env.HOME || '/root');
      const resolved = path.resolve(workdir);
      if (!resolved.startsWith(userRoot)) {
        return res.status(403).json({ error: '路径不在允许的范围内' });
      }

      const results = scanGitCredentials(workdir, userRoot);
      res.json(results);
    } catch (error: any) {
      console.error('扫描凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return { systemRouter, myCredentialsRouter };
};

// ── 共用扫描函数 ──

function scanGitCredentials(workdir: string, userRoot: string): any {
  const results: any[] = [];

  let remoteUrl = '';
  try {
    remoteUrl = execSync('git config --local --get remote.origin.url', {
      cwd: workdir, encoding: 'utf8'
    }).trim();
  } catch (e) {
    return { results: [], message: '该项目没有配置Git远程仓库' };
  }

  let host: string | null = null;
  let isSsh = false;

  if (remoteUrl.startsWith('https://')) {
    const after = remoteUrl.substring(8);
    const slashIdx = after.indexOf('/');
    if (slashIdx !== -1) host = after.substring(0, slashIdx);
  } else if (remoteUrl.startsWith('git@')) {
    isSsh = true;
    const afterAt = remoteUrl.substring(4);
    const colonIdx = afterAt.indexOf(':');
    if (colonIdx !== -1) host = afterAt.substring(0, colonIdx);
  } else if (remoteUrl.startsWith('ssh://')) {
    isSsh = true;
    const afterProto = remoteUrl.substring(6);
    const atIdx = afterProto.indexOf('@');
    if (atIdx !== -1) {
      const afterAt = afterProto.substring(atIdx + 1);
      const slashIdx = afterAt.indexOf('/');
      if (slashIdx !== -1) host = afterAt.substring(0, slashIdx);
    }
  }

  if (!host) {
    return { results: [], message: '无法解析远程仓库地址' };
  }

  // HTTPS 嵌入 token
  if (!isSsh && remoteUrl.includes('@')) {
    const match = remoteUrl.match(/https:\/\/([^@]+)@/);
    if (match) {
      const parts = match[1].split(':');
      results.push({
        host, type: 'token',
        username: parts.length > 1 ? parts[0] : 'oauth2',
        secret: parts.length > 1 ? parts[1] : parts[0],
        source: 'remote URL 嵌入凭证'
      });
    }
  }

  // .git/credentials 文件
  const credFile = path.join(workdir, '.git', 'credentials');
  if (fs.existsSync(credFile)) {
    const content = fs.readFileSync(credFile, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/https?:\/\/([^:]+):([^@]+)@/);
      if (match) {
        results.push({
          host, type: 'token',
          username: match[1], secret: match[2],
          source: '.git/credentials 文件'
        });
      }
    }
  }

  // credential.helper store
  let helperStore = '';
  try {
    helperStore = execSync('git config --global credential.helper', {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (e) {}
  if (helperStore.startsWith('store')) {
    const storeMatch = helperStore.match(/store\s+--file=(.+)/);
    const storePath = storeMatch
      ? storeMatch[1].replace('~', userRoot)
      : path.join(userRoot, '.git-credentials');
    if (fs.existsSync(storePath)) {
      const content = fs.readFileSync(storePath, 'utf8');
      for (const line of content.split('\n')) {
        const match = line.match(/https?:\/\/([^:]*):?([^@]*)@/);
        if (match && line.includes(host)) {
          results.push({
            host, type: 'token',
            username: match[1] || 'oauth2', secret: match[2],
            source: '~/.git-credentials'
          });
        }
      }
    }
  }

  // SSH 模式
  if (isSsh) {
    const sshConfigPath = path.join(userRoot, '.ssh', 'config');
    let identityFile: string | null = null;
    let sshUser = 'git';

    if (fs.existsSync(sshConfigPath)) {
      const sshConfig = fs.readFileSync(sshConfigPath, 'utf8');
      const blocks = sshConfig.split(/\nHost\s+/i);
      for (const block of blocks) {
        const lines = block.split('\n');
        const blockHost = lines[0]?.trim().toLowerCase();
        if (blockHost === host || blockHost === '*') {
          for (const line of lines) {
            const m = line.match(/^\s*IdentityFile\s+(.+)/i);
            if (m) {
              const p = m[1].trim().replace('~', userRoot);
              if (fs.existsSync(p)) identityFile = p;
            }
            const um = line.match(/^\s*User\s+(.+)/i);
            if (um) sshUser = um[1].trim();
          }
          if (identityFile) break;
        }
      }
    }

    if (!identityFile) {
      for (const key of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
        const kp = path.join(userRoot, '.ssh', key);
        if (fs.existsSync(kp)) { identityFile = kp; break; }
      }
    }

    if (identityFile) {
      const keyData = fs.readFileSync(identityFile, 'utf8');
      let credUsername = sshUser;
      const ownerMatch = remoteUrl.match(/git@[^:]+:([^/]+)\//);
      if (ownerMatch) credUsername = ownerMatch[1];
      results.push({
        host, type: 'ssh',
        username: credUsername,
        keyData,
        source: `SSH密钥: ${path.basename(identityFile)}`
      });
    }
  }

  return { host, remoteUrl, isSsh, results };
}
