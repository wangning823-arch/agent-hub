/// <reference types="node" />

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
import credentialsRouter from './routes/credentials';
import skillsRouter from './routes/skills';
import modelsRouter from './routes/models';
import workflowsRouter from './routes/workflows';
import WorkflowEngine from './workflow-engine';
import wsHandler from './websocket/handler';
import { initDb, getDb } from './db';
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

  const tokenTracker = new TokenTracker();
  sessionManager = new SessionManager(tokenTracker);
  await sessionManager.init();
}

// ==================== Static Middleware ====================

app.use(express.json({ limit: '5mb' }));
app.use(express.static(DIST_PATH));
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
  const wsConnectionHandler = wsHandler(sessionManager, TOKEN_FILE);

  // Register route factories
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/sessions', sessionsRouter(sessionManager));
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
  app.use('/api', workflowsRouter(sessionManager, workflowEngine));

  // Authenticated uploads route
  app.get('/uploads/:userId/:date/:filename', (req: Request, res: Response) => {
    const { userId, date, filename } = req.params;
    const filePath = path.join(UPLOAD_DIR, userId, date, filename);

    if (req.user && req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: '无权访问此文件' });
    }

    res.sendFile(filePath, (err) => {
      if (err) res.status(404).json({ error: '文件不存在' });
    });
  });

  wsConnectionHandler(wss);

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
│    GET  /api/files/properties           │
└─────────────────────────────────────────┘
    `);
  });

  process.on('SIGINT', async () => {
    console.log('\n正在关闭...');
    if (sessionManager) {
      sessionManager.saveData();
    }
    process.exit(0);
  });
})();
