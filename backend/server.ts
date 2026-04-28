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
import credentialManager from './credentialManager';
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
import { initDb } from './db';
import { UPLOAD_DIR } from './upload';
import authMiddleware from './middleware/auth';
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
const wss = new WebSocket.Server({ server });

const PORT: number = parseInt(process.env.PORT || '3001', 10);
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
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(authMiddleware(TOKEN_FILE));
app.use(corsMiddleware());

// Error handler — Express requires exactly 4 parameters to recognize it as an error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorHandlerMiddleware()(err, req, res, next);
});

// ==================== Inline Routes ====================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/agents', (_req: Request, res: Response) => {
  res.json({
    agents: [
      { id: 'claude-code', name: 'Claude Code', available: true },
      { id: 'opencode', name: 'OpenCode', available: true },
      { id: 'codex', name: 'Codex', available: true },
    ],
  });
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
  app.use('/api/sessions', sessionsRouter(sessionManager));
  app.use('/api/tags', tagsRouter(sessionManager));
  app.use('/api/projects', projectsRouter(projectManager, sessionManager));
  app.use('/api/files', filesRouter(ALLOWED_ROOT, projectManager));
  app.use('/api/git', gitRouter(ALLOWED_ROOT, permissionManager, projectManager));
  app.use('/api/search', searchRouter(sessionManager));
  app.use('/api/permissions', permissionsRouter(permissionManager));
  app.use('/api/tokens', tokensRouter(new TokenTracker()));
  app.use('/api/export', exportRouter(sessionManager));
  app.use('/api/health', healthRouter());
  app.use('/api/upload', uploadRouter());
  app.use('/api/options', optionsRouter());
  app.use('/api/credentials', credentialsRouter(credentialManager));
  app.use('/api/skills', skillsRouter);
  app.use('/api/models', modelsRouter());
  app.use('/api', workflowsRouter(sessionManager, workflowEngine));

  wsConnectionHandler(wss);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
┌─────────────────────────────────────────┐
│         Agent Hub Server                │
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
