import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getDb, getJwtSecret, saveToFile } from '../db';
import { hashPassword, verifyPassword } from '../crypto-utils';

const router = Router();

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '7d';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  home_dir: string;
  display_name: string | null;
  is_active: number;
}

function generateTokenPair(user: { id: string; username: string; role: string }) {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    getJwtSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh' },
    getJwtSecret(),
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
  return { accessToken, refreshToken };
}

function getUserByUsername(username: string): UserRow | null {
  const db = getDb();
  const result = db.exec(
    `SELECT id, username, password_hash, role, home_dir, display_name, is_active FROM users WHERE username = '${username.toLowerCase().replace(/'/g, "''")}'`
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0] as string,
    username: row[1] as string,
    password_hash: row[2] as string,
    role: row[3] as string,
    home_dir: row[4] as string,
    display_name: row[5] as string | null,
    is_active: row[6] as number,
  };
}

function getUserCount(): number {
  const db = getDb();
  const result = db.exec('SELECT COUNT(*) FROM users');
  if (result.length === 0) return 0;
  return result[0].values[0][0] as number;
}

function getInitAdminUsername(): string | null {
  const configPath = path.join(__dirname, '..', '..', '..', 'data', 'init-admin.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.username?.toLowerCase() || null;
    }
  } catch (_e) {}
  return null;
}

router.post('/register', (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: '用户名是必需的' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: '密码是必需的' });
    }

    const normalizedUsername = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,32}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: '用户名只能包含字母、数字和下划线，长度 3-32 字符' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 个字符' });
    }

    const existing = getUserByUsername(normalizedUsername);
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const initAdmin = getInitAdminUsername();
    const role = (initAdmin && normalizedUsername === initAdmin) ? 'admin' : 'user';

    const homeDir = path.join(process.env.HOME || '/root', 'users', normalizedUsername);

    const db = getDb();
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    db.run(
      `INSERT INTO users (id, username, password_hash, role, home_dir, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [userId, normalizedUsername, passwordHash, role, homeDir, normalizedUsername, now, now]
    );

    try {
      if (!fs.existsSync(homeDir)) {
        fs.mkdirSync(homeDir, { recursive: true });
      }
    } catch (mkdirError) {
      db.run(`DELETE FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
      return res.status(500).json({ error: '创建用户目录失败' });
    }

    saveToFile();

    const tokens = generateTokenPair({ id: userId, username: normalizedUsername, role });

    console.log(`[用户注册] ${normalizedUsername} (role: ${role})`);

    res.status(201).json({
      success: true,
      user: { id: userId, username: normalizedUsername, role, homeDir },
      ...tokens,
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码是必需的' });
    }

    const normalizedUsername = username.toLowerCase().trim();
    const user = getUserByUsername(normalizedUsername);

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: '账户已停用' });
    }

    const tokens = generateTokenPair({ id: user.id, username: user.username, role: user.role });

    console.log(`[用户登录] ${normalizedUsername}`);

    res.json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role, homeDir: user.home_dir },
      ...tokens,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/refresh', (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken 是必需的' });
    }

    const decoded = jwt.verify(refreshToken, getJwtSecret()) as { userId: string; type: string };
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: '无效的 refresh token' });
    }

    const db = getDb();
    const result = db.exec(
      `SELECT id, username, role, is_active FROM users WHERE id = '${decoded.userId.replace(/'/g, "''")}'`
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    const row = result[0].values[0];
    if (row[3] !== 1) {
      return res.status(403).json({ error: '账户已停用' });
    }

    const tokens = generateTokenPair({
      id: row[0] as string,
      username: row[1] as string,
      role: row[2] as string,
    });

    res.json(tokens);
  } catch (error) {
    return res.status(401).json({ error: 'Token 已过期或无效' });
  }
});

router.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: '未认证' });
  }
  res.json({
    userId: req.user.userId,
    username: req.user.username,
    role: req.user.role,
    homeDir: req.user.homeDir,
  });
});

router.put('/password', (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '旧密码和新密码是必需的' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 个字符' });
    }

    const user = getUserByUsername(req.user.username);
    if (!user || !verifyPassword(oldPassword, user.password_hash)) {
      return res.status(401).json({ error: '旧密码错误' });
    }

    const db = getDb();
    const newHash = hashPassword(newPassword);
    const now = new Date().toISOString();
    db.run(
      `UPDATE users SET password_hash = '${newHash.replace(/'/g, "''")}', updated_at = '${now}' WHERE id = '${req.user.userId.replace(/'/g, "''")}'`
    );
    saveToFile();

    res.json({ success: true, message: '密码已更新' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

router.get('/status', (_req: Request, res: Response) => {
  const userCount = getUserCount();
  res.json({ hasUsers: userCount > 0 });
});

export default router;
