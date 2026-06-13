/// <reference types="node" />

import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import WebSocket from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import SessionManager from './sessions';
import PermissionManager from './permissions';
import ProjectManager from './projects';
import TokenTracker from './token-tracker';
import sessionsRouter from './routes/sessions';
import tagsRouter from './routes/tags';
import projectsRouter from './routes/projects';
import filesRouter from './routes/files';
import gitRouter from './routes/git';
import searchRouter from './routes/search';
import permissionsRouter from './routes/permissions';
import tokensRouter from './routes/tokens';
import exportRouter from './routes/export';
import healthRouter from './routes/health';
import uploadRouter from './routes/upload';
import optionsRouter from './routes/options';
import { discoverClaudeCommands } from './commands';
import credentialsRouter from './routes/credentials';
import skillsRouter from './routes/skills';
import modelsRouter from './routes/models';
import workflowsRouter from './routes/workflows';
import WorkflowEngine from './workflow-engine';
import WorkflowScheduler from './workflow-scheduler';
import wsHandler from './websocket/handler';
import { initDb, getDb, saveToFile, saveTokenStatsToFile } from './db';
import promptTemplatesRouter from './routes/prompt-templates';
import designSpecsRouter from './routes/design-specs';
import beautifyRouter from './routes/beautify';
import componentLibsRouter from './routes/component-libs';
import designSystemsRouter from './routes/design-systems';
import { UPLOAD_DIR } from './upload';
import userAuth from './middleware/userAuth';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import corsMiddleware from './middleware/cors';
import errorHandlerMiddleware from './middleware/errorHandler';

// ==================== Global Error Handlers ====================

process.on('uncaughtException', (err: Error) => {
  console.error('[Global] 未捕获异常', err);
});
process.on('unhandledRejection', (reason: unknown, p: Promise<unknown>) => {
  console.error('[Global] 未处理的 Promise 拒绝', p, '原因:', reason);
});

// ==================== App Setup ====================

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT: number = parseInt(process.env.PORT || '3002', 10);
const TOKEN_FILE: string = path.join(__dirname, '..', '..', '.token');
const ALLOWED_ROOT: string = process.env.ALLOWED_ROOT || process.env.HOME || '/root';
const DIST_PATH: string = path.join(__dirname, '..', '..', 'frontend', 'dist');

// ==================== Init ====================

let sessionManager!: SessionManager;

async function initApp(): Promise<void> {
  await initDb();

  // 每 60 秒自动保存数据库到磁盘，防止 OOM 崩溃导致数据丢失
  setInterval(() => {
    try { saveToFile(); } catch (e) { console.error('[DB] 主数据库保存失败:', e); }
    try { saveTokenStatsToFile(); } catch (e) { console.error('[DB] Token统计保存失败:', e); }
  }, 60000);

  // 每 24 小时自动刷新 OpenCode 免费模型缓存（空闲时预加载，避免用户请求时阻塞）
  setInterval(() => {
    try {
      const commands = require('./commands');
      if (typeof commands.clearModelCache === 'function') {
        commands.clearModelCache();
        // 预加载：清除缓存后立即调用，下次用户请求无需等待
        if (typeof commands.getModelsForAgent === 'function') {
          commands.getModelsForAgent('opencode');
        }
        console.log('[OpenCode] 模型缓存已自动刷新');
      }
    } catch (e) { console.error('[OpenCode] 模型缓存刷新失败:', e); }
  }, 24 * 60 * 60 * 1000);

  const tokenTracker = new TokenTracker();
  sessionManager = new SessionManager(tokenTracker);
  await sessionManager.init();
}

// ==================== Static Middleware ====================

app.use(express.json({ limit: '5mb' }));

// ==================== Security Headers ====================
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.static(DIST_PATH, { maxAge: '1h', etag: true }));

// ==================== Project Preview Route ====================
// 公开访问：通过 /:username/:project 提供项目静态文件
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderDirectoryListing(dirPath: string, urlPath: string, baseUrl: string): string {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = entries
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const rows = items.map(entry => {
    const name = escapeHtml(entry.isDirectory() ? `${entry.name}/` : entry.name);
    const href = escapeHtml(`${baseUrl}/${entry.name}`);
    const icon = entry.isDirectory()
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>';
    let size = '';
    if (!entry.isDirectory()) {
      try {
        const stat = fs.statSync(path.join(dirPath, entry.name));
        size = ` (${(stat.size / 1024).toFixed(1)} KB)`;
      } catch {
        return null;
      }
    }
    return `<tr><td>${icon}</td><td><a href="${href}">${name}</a></td><td>${size}</td></tr>`;
  }).filter(Boolean).join('\n');

  const parentLink = urlPath
    ? `<tr><td></td><td><a href="${path.dirname(baseUrl)}">../</a></td><td></td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of ${urlPath || '/'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #333; background: #fafafa; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #111; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    td, th { padding: 10px 14px; text-align: left; border-bottom: 1px solid #f0f0f0; }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: #f5f7fa; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    td:first-child { width: 28px; color: #888; }
    td:nth-child(3) { color: #888; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Index of /${urlPath || ''}</h1>
  <table>
    ${parentLink}
    ${rows}
  </table>
</body>
</html>`;
}

function projectPreviewHandler(req: Request, res: Response, next: NextFunction): void {
  const username = (req.params.username || '').trim();
  const projectName = (req.params.project || '').trim();
  const filePath = req.params[0] || '';

  if (!username || !projectName) {
    next();
    return;
  }

  try {
    const db = getDb();
    const safeUsername = username.replace(/'/g, "''");
    const userResult = db.exec(
      `SELECT id FROM users WHERE username = '${safeUsername}' AND is_active = 1`
    );
    if (userResult.length === 0 || userResult[0].values.length === 0) {
      next();
      return;
    }
    const userId = userResult[0].values[0][0] as string;

    // 从 projects.json 查找项目（而非 SQLite 数据库）
    const projectsFile = path.join(__dirname, '..', '..', 'data', 'projects.json');
    let workdir = '';
    try {
      const raw = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
      const projects: any[] = Array.isArray(raw.projects) ? raw.projects : Object.entries(raw.projects);
      for (const [, p] of projects) {
        if (p.name !== projectName) continue;
        // 有 userId 的项目必须匹配，没有 userId 的旧项目允许访问
        if (p.userId && p.userId !== userId) continue;
        workdir = p.workdir;
        break;
      }
    } catch (_e) {}

    if (!workdir) {
      next();
      return;
    }

    if (!filePath) {
      // 项目根目录无尾部斜杠时重定向，确保浏览器正确解析相对路径
      if (!req.url.endsWith('/')) {
        res.redirect(301, req.url + '/');
        return;
      }
      const indexPath = path.join(workdir, 'index.html');
      const resolvedIndex = path.resolve(indexPath);
      if (resolvedIndex.startsWith(path.resolve(workdir)) && fs.existsSync(resolvedIndex)) {
        res.sendFile(resolvedIndex);
        return;
      }
      const baseUrl = `/${username}/${projectName}`;
      res.send(renderDirectoryListing(workdir, '', baseUrl));
      return;
    }

    const targetFile = path.join(workdir, filePath);
    try {
      const resolved = fs.realpathSync(path.resolve(targetFile));
      if (!resolved.startsWith(fs.realpathSync(path.resolve(workdir)))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        if (!req.url.endsWith('/')) {
          res.redirect(301, req.url + '/');
          return;
        }
        const indexPath = path.join(resolved, 'index.html');
        const resolvedIndex = path.resolve(indexPath);
        if (resolvedIndex.startsWith(path.resolve(workdir)) && fs.existsSync(resolvedIndex)) {
          res.sendFile(resolvedIndex);
          return;
        }
        const baseUrl = `/${username}/${projectName}/${filePath}`.replace(/\/+$/, '');
        res.send(renderDirectoryListing(resolved, filePath, baseUrl));
        return;
      }

      res.sendFile(resolved, (err) => {
        if (err) {
          res.status(404).json({ error: 'File not found' });
        }
      });
    } catch {
      res.status(403).json({ error: 'Access denied' });
    }
  } catch (error) {
    next(error);
  }
}

// 匹配 /:username/:project（无子路径）
app.get('/:username/:project', projectPreviewHandler);
// 匹配 /:username/:project/*（有子路径）
app.get('/:username/:project/*', projectPreviewHandler);

app.use(userAuth);
app.use(corsMiddleware());

// Error handler — Express requires exactly 4 parameters to recognize it as an error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorHandlerMiddleware()(err, req, res, next);
});

// ==================== Inline Routes ====================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/agents', (req: Request, res: Response) => {
  const allAgents = [
    { id: 'claude-code', name: 'Claude Code', available: true },
    { id: 'opencode', name: 'OpenCode', available: true },
    { id: 'codex', name: 'Codex', available: true },
    { id: 'mimo', name: 'Mimo', available: true },
  ];

  // 管理员返回全部
  if (!req.user || req.user.role === 'admin') {
    return res.json({ agents: allAgents });
  }

  // 普通用户：查询 user_agent_types 过滤
  try {
    const db = getDb();
    const uid = req.user.userId.replace(/'/g, "''");
    const result = db.exec(`SELECT agent_type FROM user_agent_types WHERE user_id = '${uid}'`);
    if (result.length > 0 && result[0].values.length > 0) {
      const allowed = new Set(result[0].values.map((row: any[]) => row[0] as string));
      const filtered = allAgents.filter(a => allowed.has(a.id));
      return res.json({ agents: filtered });
    }
    // 没有分配记录，返回空列表（管理员未分配任何 agent 类型）
    res.json({ agents: [] });
  } catch (error: any) {
    res.json({ agents: [] });
  }
});

app.get('/api/auth/check', (req: Request, res: Response) => {
  let ACCESS_TOKEN = '';
  try {
    ACCESS_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch (_e) { /* token file not found */ }
  const token = req.headers['x-access-token'] || req.query.token;
  res.json({ valid: !ACCESS_TOKEN || token === ACCESS_TOKEN });
});


// 通过 /api 代理的预览路由（开发模式使用）
app.get('/api/preview/:username/:project', projectPreviewHandler);
app.get('/api/preview/:username/:project/*', projectPreviewHandler);

// SPA fallback — serve index.html for non-API, non-WS, non-upload routes
app.get('*', (req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/ws') ||
    req.path.startsWith('/uploads')
  ) {
    return next();
  }
  res.sendFile(path.join(DIST_PATH, 'index.html'));
});

// ==================== Start ====================

(async () => {
  await initApp();

  const permissionManager = new PermissionManager();
  const projectManager = new ProjectManager();
  const workflowEngine = new WorkflowEngine(sessionManager);
  const workflowScheduler = new WorkflowScheduler(sessionManager, workflowEngine);
  workflowScheduler.loadPending();
  const wsConnectionHandler = wsHandler(sessionManager, TOKEN_FILE);

  // 初始化 GoalMonitor
  const GoalMonitor = (await import('./goal-monitor')).default;
  const goalMonitor = new GoalMonitor(sessionManager);
  sessionManager.setGoalMonitor(goalMonitor);

  // 设置摘要服务（延迟注入，避免循环依赖）
  const { summarizeSession } = require('./summary-service');
  goalMonitor.setSummaryService({ summarizeSession });

  // 设置 LLM 判断函数（使用 Anthropic SDK）
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const fs = await import('fs');
    const path = await import('path');

    function getLlmApiKey(): { apiKey: string; baseURL?: string } | null {
      // 1. 从数据库 providers 表获取
      try {
        const db = getDb();
        const result = db.exec(
          "SELECT base_url_anthropic, api_key FROM providers WHERE owner_id IS NULL ORDER BY updated_at DESC LIMIT 1"
        );
        if (result.length > 0 && result[0].values.length > 0) {
          const [baseURL, apiKey] = result[0].values[0] as [string, string];
          if (apiKey) return { apiKey, baseURL: baseURL || undefined };
        }
      } catch (e) { /* ignore */ }

      // 2. 从 ~/.claude/settings.json 获取
      try {
        const homeDir = process.env.HOME || '/root';
        const settingsPath = path.join(homeDir, '.claude', 'settings.json');
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const env = settings.env || {};
          const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
          if (apiKey) return { apiKey, baseURL: env.ANTHROPIC_BASE_URL };
        }
      } catch (e) { /* ignore */ }

      return null;
    }

    const llmConfig = getLlmApiKey();
    if (llmConfig) {
      const anthropic = new (Anthropic as any)({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
      });
      goalMonitor.setLlmJudgeFn(async (prompt: string) => {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        });
        return message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');
      });
      console.log('[GoalMonitor] LLM 判断函数已设置');
    } else {
      console.log('[GoalMonitor] 未找到 API Key，LLM 判断不可用，将使用启发式判断');
    }
  } catch (e) {
    console.log('[GoalMonitor] Anthropic SDK 不可用，LLM 判断不可用');
  }

  // Register route factories
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/sessions', sessionsRouter(sessionManager, projectManager));
  app.use('/api/tags', tagsRouter(sessionManager));
  app.use('/api/projects', projectsRouter(projectManager, sessionManager));
  app.use('/api/files', filesRouter(ALLOWED_ROOT, projectManager));
  app.use('/api/git', gitRouter(ALLOWED_ROOT, permissionManager, projectManager));
  app.use('/api/search', searchRouter(sessionManager));
  app.use('/api/permissions', permissionsRouter(permissionManager));
  app.use('/api/tokens', tokensRouter(sessionManager.tokenTracker, sessionManager));
  app.use('/api/export', exportRouter(sessionManager));
  app.use('/api/health', healthRouter());
  app.use('/api/upload', uploadRouter());
  app.use('/api/options', optionsRouter());
  const { systemRouter: credentialsSystemRouter, myCredentialsRouter } = credentialsRouter();
  app.use('/api/credentials', credentialsSystemRouter);
  app.use('/api/my-credentials', myCredentialsRouter);
  app.use('/api/skills', skillsRouter);
  const { systemRouter: modelsSystemRouter, myModelsRouter } = modelsRouter();
  app.use('/api/models', modelsSystemRouter);
  app.use('/api/my-models', myModelsRouter);
  app.use('/api', workflowsRouter(sessionManager, workflowEngine, workflowScheduler));
  app.use('/api/prompt-templates', promptTemplatesRouter());
  app.use('/api/design-specs', designSpecsRouter());
  app.use('/api/ai', beautifyRouter());
  app.use('/api/component-libs', componentLibsRouter());
  app.use('/api/design-systems', designSystemsRouter());
  // Goal Monitor 路由
  const goalsRouter = (await import('./routes/goals')).default;
  app.use('/api/goals', goalsRouter(goalMonitor));

  // Authenticated uploads route
  app.get('/uploads/:userId/:date/:filename', (req: Request, res: Response) => {
    const { userId, date, filename } = req.params;
    const filePath = path.join(UPLOAD_DIR, userId, date, filename);

    res.sendFile(filePath, (err) => {
      if (err) res.status(404).json({ error: '文件不存在' });
    });
  });

  wsConnectionHandler(wss);

  // 启动时探测可用的 Claude Code 命令
  discoverClaudeCommands();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
┌─────────────────────────────────────────┐
│         AgentPilot Server               │
│─────────────────────────────────────────│
│  HTTP:      http://localhost:${PORT}       │
│  WebSocket: ws://localhost:${PORT}         │
│─────────────────────────────────────────│
│  API:                                   │
│    GET  /api/health                     │
│    GET  /api/agents                     │
│    GET  /api/sessions                   │
│    POST /api/sessions                   │
│    DELETE /api/sessions/:id             │
│    GET  /api/permissions                │
│    PUT  /api/permissions                │
│    POST /api/permissions/check          │
│    GET  /api/files                      │
│    GET  /api/files/content              │
│    GET  /api/files/raw                  │
│    GET  /api/files/properties           │
└─────────────────────────────────────────┘
    `);
  });

  process.on('SIGINT', async () => {
    console.log('\n正在关闭...');
    try { saveToFile(); } catch (e) { console.error('[DB] 关闭时保存失败:', e); }
    try { saveTokenStatsToFile(); } catch (e) { console.error('[DB] 关闭时保存Token统计失败:', e); }
    if (sessionManager) {
      sessionManager.saveData();
    }
    // 关闭 mimo server
    try {
      const { getMimoServerManager } = require('./mimo-server');
      await getMimoServerManager().shutdown();
    } catch (e) { /* ignore */ }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n收到 SIGTERM，正在关闭...');
    try { saveToFile(); } catch (e) { console.error('[DB] SIGTERM保存失败:', e); }
    try { saveTokenStatsToFile(); } catch (e) { console.error('[DB] SIGTERM保存Token统计失败:', e); }
    if (sessionManager) {
      sessionManager.saveData();
    }
    // 关闭 mimo server
    try {
      const { getMimoServerManager } = require('./mimo-server');
      await getMimoServerManager().shutdown();
    } catch (e) { /* ignore */ }
    process.exit(0);
  });
})();
