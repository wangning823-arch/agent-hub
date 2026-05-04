import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, saveToFile } from '../db';
import { hashPassword } from '../crypto-utils';
import { requireAdmin } from '../middleware/userAuth';

const router = Router();

router.use(requireAdmin);

router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.exec('SELECT id, username, role, home_dir, display_name, is_active, created_at, updated_at FROM users ORDER BY created_at DESC');
    if (result.length === 0) {
      return res.json([]);
    }
    const users = result[0].values.map((row: any[]) => ({
      id: row[0],
      username: row[1],
      role: row[2],
      homeDir: row[3],
      displayName: row[4],
      isActive: row[5] === 1,
      createdAt: row[6],
      updatedAt: row[7],
    }));
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.exec(
      `SELECT id, username, role, home_dir, display_name, is_active, created_at, updated_at FROM users WHERE id = '${req.params.id.replace(/'/g, "''")}'`
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const row = result[0].values[0];
    res.json({
      id: row[0],
      username: row[1],
      role: row[2],
      homeDir: row[3],
      displayName: row[4],
      isActive: row[5] === 1,
      createdAt: row[6],
      updatedAt: row[7],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码是必需的' });
    }

    const normalizedUsername = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,32}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: '用户名格式不正确' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    const userRole = (role === 'admin') ? 'admin' : 'user';
    const homeDir = path.join(process.env.HOME || '/root', 'users', normalizedUsername);

    const db = getDb();
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    db.run(
      `INSERT INTO users (id, username, password_hash, role, home_dir, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [userId, normalizedUsername, passwordHash, userRole, homeDir, normalizedUsername, now, now]
    );

    if (!fs.existsSync(homeDir)) {
      fs.mkdirSync(homeDir, { recursive: true });
    }

    saveToFile();

    console.log(`[管理员创建用户] ${normalizedUsername} (role: ${userRole}) by ${req.user!.username}`);

    res.status(201).json({
      success: true,
      user: { id: userId, username: normalizedUsername, role: userRole, homeDir },
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { display_name, role, is_active } = req.body;

    const existing = db.exec(
      `SELECT id, username, role FROM users WHERE id = '${req.params.id.replace(/'/g, "''")}'`
    );
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const currentRole = existing[0].values[0][2] as string;

    if (req.params.id === req.user!.userId && is_active === false) {
      return res.status(400).json({ error: '不能停用自己' });
    }

    if (req.params.id === req.user!.userId && role === 'user' && currentRole === 'admin') {
      const adminCount = db.exec("SELECT COUNT(*) FROM users WHERE role = 'admin'");
      const count = adminCount[0]?.values[0][0] as number;
      if (count <= 1) {
        return res.status(400).json({ error: '系统至少需要一个管理员' });
      }
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(display_name);
    }
    if (role !== undefined && (role === 'admin' || role === 'user')) {
      if (role === 'user' && currentRole === 'admin') {
        const adminCount = db.exec("SELECT COUNT(*) FROM users WHERE role = 'admin'");
        const count = adminCount[0]?.values[0][0] as number;
        if (count <= 1) {
          return res.status(400).json({ error: '系统至少需要一个管理员' });
        }
      }
      updates.push('role = ?');
      params.push(role);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '没有要更新的字段' });
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    saveToFile();

    res.json({ success: true, message: '用户已更新' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/password', (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    const db = getDb();
    const existing = db.exec(
      `SELECT id FROM users WHERE id = '${req.params.id.replace(/'/g, "''")}'`
    );
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const newHash = hashPassword(password);
    const now = new Date().toISOString();
    db.run(
      `UPDATE users SET password_hash = '${newHash.replace(/'/g, "''")}', updated_at = '${now}' WHERE id = '${req.params.id.replace(/'/g, "''")}'`
    );
    saveToFile();

    res.json({ success: true, message: '密码已重置' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.exec(
      `SELECT id, role FROM users WHERE id = '${req.params.id.replace(/'/g, "''")}'`
    );
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (req.params.id === req.user!.userId) {
      return res.status(400).json({ error: '不能停用自己' });
    }

    const targetRole = existing[0].values[0][1] as string;
    if (targetRole === 'admin') {
      const adminCount = db.exec("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1");
      const count = adminCount[0]?.values[0][0] as number;
      if (count <= 1) {
        return res.status(400).json({ error: '不能停用唯一的管理员' });
      }
    }

    const now = new Date().toISOString();
    db.run(
      `UPDATE users SET is_active = 0, updated_at = '${now}' WHERE id = '${req.params.id.replace(/'/g, "''")}'`
    );
    saveToFile();

    console.log(`[管理员停用用户] ${req.params.id} by ${req.user!.username}`);
    res.json({ success: true, message: '用户已停用' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Provider 分配 API ──

router.get('/:id/providers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.params.id.replace(/'/g, "''");

    const existing = db.exec(`SELECT id FROM users WHERE id = '${userId}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const result = db.exec(
      `SELECT p.id, p.name FROM providers p JOIN user_providers up ON p.id = up.provider_id WHERE up.user_id = '${userId}' ORDER BY p.name`
    );
    const providers = result.length > 0 ? result[0].values.map((row: any[]) => ({
      id: row[0], name: row[1]
    })) : [];

    res.json({ providers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/providers', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.params.id.replace(/'/g, "''");
    const { providerIds } = req.body;

    if (!Array.isArray(providerIds)) {
      return res.status(400).json({ error: 'providerIds 必须是数组' });
    }

    const existing = db.exec(`SELECT id FROM users WHERE id = '${userId}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const now = new Date().toISOString();
    db.run(`DELETE FROM user_providers WHERE user_id = '${userId}'`);
    for (const pid of providerIds) {
      const safePid = String(pid).replace(/'/g, "''");
      db.run(
        `INSERT OR IGNORE INTO user_providers (user_id, provider_id, created_at) VALUES ('${userId}', '${safePid}', '${now}')`
      );
    }
    saveToFile();

    console.log(`[管理员分配 Provider] 用户 ${userId} -> ${providerIds.length} 个 Provider by ${req.user!.username}`);
    res.json({ success: true, message: `已分配 ${providerIds.length} 个 Provider` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Credential 分配 API ──

router.get('/:id/credentials', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.params.id.replace(/'/g, "''");

    const existing = db.exec(`SELECT id FROM users WHERE id = '${userId}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const result = db.exec(
      `SELECT c.id, c.host, c.type, c.username FROM credentials c JOIN user_credentials uc ON c.id = uc.credential_id WHERE uc.user_id = '${userId}' ORDER BY c.host`
    );
    const credentials = result.length > 0 ? result[0].values.map((row: any[]) => ({
      id: row[0], host: row[1], type: row[2], username: row[3]
    })) : [];

    res.json({ credentials });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/credentials', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.params.id.replace(/'/g, "''");
    const { credentialIds } = req.body;

    if (!Array.isArray(credentialIds)) {
      return res.status(400).json({ error: 'credentialIds 必须是数组' });
    }

    const existing = db.exec(`SELECT id FROM users WHERE id = '${userId}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const now = new Date().toISOString();
    db.run(`DELETE FROM user_credentials WHERE user_id = '${userId}'`);
    for (const cid of credentialIds) {
      const safeCid = String(cid).replace(/'/g, "''");
      db.run(
        `INSERT OR IGNORE INTO user_credentials (user_id, credential_id, created_at) VALUES ('${userId}', '${safeCid}', '${now}')`
      );
    }
    saveToFile();

    console.log(`[管理员分配 Credential] 用户 ${userId} -> ${credentialIds.length} 个凭证 by ${req.user!.username}`);
    res.json({ success: true, message: `已分配 ${credentialIds.length} 个凭证` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════
// Agent 类型权限管理
// ═══════════════════════════════════════

router.get('/:id/agent-types', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.params.id.replace(/'/g, "''");

    const existing = db.exec(`SELECT id FROM users WHERE id = '${userId}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const result = db.exec(
      `SELECT agent_type FROM user_agent_types WHERE user_id = '${userId}' ORDER BY agent_type`
    );
    const agentTypes = result.length > 0 ? result[0].values.map((row: any[]) => row[0] as string) : [];

    res.json({ agentTypes });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/agent-types', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.params.id.replace(/'/g, "''");
    const { agentTypes } = req.body;

    if (!Array.isArray(agentTypes)) {
      return res.status(400).json({ error: 'agentTypes 必须是数组' });
    }

    const existing = db.exec(`SELECT id FROM users WHERE id = '${userId}'`);
    if (existing.length === 0 || existing[0].values.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const validTypes = ['claude-code', 'opencode', 'codex'];
    const now = new Date().toISOString();
    db.run(`DELETE FROM user_agent_types WHERE user_id = '${userId}'`);
    for (const at of agentTypes) {
      if (!validTypes.includes(at)) continue;
      db.run(
        `INSERT OR IGNORE INTO user_agent_types (user_id, agent_type, created_at) VALUES ('${userId}', '${at}', '${now}')`
      );
    }
    saveToFile();

    console.log(`[管理员分配 Agent 类型] 用户 ${userId} -> ${agentTypes.join(', ')} by ${req.user!.username}`);
    res.json({ success: true, message: `已分配 ${agentTypes.length} 个 Agent 类型` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
