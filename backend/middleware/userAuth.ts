import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getDb, getJwtSecret } from '../db';
import { UserContext } from '../types';

const WHITELIST_PATHS = [
  '/',
  '/api/health',
  '/api/agents',
  '/api/permissions',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/check',
];

const WHITELIST_PREFIXES = [
  '/assets',
  '/api/options',
];

const TOKEN_FILE = path.join(__dirname, '..', '..', '.token');

let LEGACY_TOKEN = '';
try {
  LEGACY_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
} catch (_e) {}

function isWhitelisted(path: string): boolean {
  if (WHITELIST_PATHS.includes(path)) return true;
  for (const prefix of WHITELIST_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function getUserFromDb(userId: string): UserContext | null {
  const db = getDb();
  const result = db.exec(
    `SELECT id, username, role, home_dir FROM users WHERE id = '${userId.replace(/'/g, "''")}' AND is_active = 1`
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    userId: row[0] as string,
    username: row[1] as string,
    role: row[2] as 'admin' | 'user',
    homeDir: row[3] as string,
  };
}

export default function userAuth(req: Request, res: Response, next: NextFunction): any {
  if (isWhitelisted(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; username: string; role: string };
      const user = getUserFromDb(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: '用户不存在或已停用' });
      }
      req.user = user;
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'Token 已过期或无效' });
    }
  }

  const legacyToken = req.headers['x-access-token'] || req.query.token;
  if (LEGACY_TOKEN && legacyToken === LEGACY_TOKEN) {
    const ALLOWED_ROOT = process.env.ALLOWED_ROOT || process.env.HOME || '/root';
    // Legacy token 用户降级为普通用户，限制在 ALLOWED_ROOT 目录内
    req.user = {
      userId: '__legacy__',
      username: '__legacy__',
      role: 'user',
      homeDir: ALLOWED_ROOT,
    };
    return next();
  }

  if (!LEGACY_TOKEN) {
    return next();
  }

  return res.status(401).json({ error: '未授权' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): any {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}
