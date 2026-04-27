/// <reference types="node" />

import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import WebSocket from 'ws';
import * as path from 'path';
import * as fs from 'fs';

// Lazy-loaded modules (initialized in initApp)
let tokenTracker: any;
let sessionManager: any;
let wsConnectionHandler: ((wss: WebSocket.Server) => void) | null = null;

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

async function initApp(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initDb } = require('./db') as { initDb: () => Promise<void> };
  await initDb();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TokenTracker = require('./token-tracker').default as new () => any;
  tokenTracker = new TokenTracker();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SessionManager = require('./sessions').default as new (tokenTracker: any) => any;
  sessionManager = new SessionManager(tokenTracker);
  await sessionManager.init();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wsHandler = require('./websocket/handler').default as (
    sessionManager: any,
    TOKEN_FILE: string,
  ) => (wss: WebSocket.Server) => void;
  wsConnectionHandler = wsHandler(sessionManager, TOKEN_FILE);
}

// ==================== Static Middleware ====================

app.use(express.json({ limit: '5mb' }));
app.use(express.static(DIST_PATH));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UPLOAD_DIR } = require('./upload') as { UPLOAD_DIR: string };
app.use('/uploads', express.static(UPLOAD_DIR));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const authMiddleware = require('./middleware/auth').default as (TOKEN_FILE: string) => (req: Request, res: Response, next: NextFunction) => void;
app.use(authMiddleware(TOKEN_FILE));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const corsMiddleware = require('./middleware/cors').default as () => (req: Request, res: Response, next: NextFunction) => void;
app.use(corsMiddleware());

// Error handler — Express requires exactly 4 parameters to recognize it as an error handler
// eslint-disable-next-line @typescript-eslint/no-require-imports
const errorHandlerMiddleware = require('./middleware/errorHandler').default as () => (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => void;
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
  } catch (e) { /* token file not found */ }
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

  // Dynamic imports for route factories (must be after initApp so sessionManager is ready)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sessionsRouter = require('./routes/sessions').default as (sm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tagsRouter = require('./routes/tags').default as (sm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const projectsRouter = require('./routes/projects').default as (pm: any, sm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const filesRouter = require('./routes/files').default as (root: string) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gitRouter = require('./routes/git').default as (root: string, pm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const searchRouter = require('./routes/search').default as (sm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const permissionsRouter = require('./routes/permissions').default as (pm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tokensRouter = require('./routes/tokens').default as (tt: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exportRouter = require('./routes/export').default as (sm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const healthRouter = require('./routes/health').default as () => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const uploadRouter = require('./routes/upload').default as () => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const optionsRouter = require('./routes/options').default as () => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const credentialsRouter = require('./routes/credentials').default as (cm: any) => express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const skillsRouter = require('./routes/skills').default as express.Router;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modelsRouter = require('./routes/models').default as () => express.Router;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PermissionManager = require('./permissions').default as new () => any;
  const permissionManager = new PermissionManager();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ProjectManager = require('./projects').default as new () => any;
  const projectManager = new ProjectManager();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const credentialManager = require('./credentialManager') as any;

  // Register route factories (must be after initApp)
  app.use('/api/sessions', sessionsRouter(sessionManager));
  app.use('/api/tags', tagsRouter(sessionManager));
  app.use('/api/projects', projectsRouter(projectManager, sessionManager));
  app.use('/api/files', filesRouter(ALLOWED_ROOT));
  app.use('/api/git', gitRouter(ALLOWED_ROOT, permissionManager));
  app.use('/api/search', searchRouter(sessionManager));
  app.use('/api/permissions', permissionsRouter(permissionManager));
  app.use('/api/tokens', tokensRouter(tokenTracker));
  app.use('/api/export', exportRouter(sessionManager));
  app.use('/api/health', healthRouter());
  app.use('/api/upload', uploadRouter());
  app.use('/api/options', optionsRouter());
  app.use('/api/credentials', credentialsRouter(credentialManager));
  app.use('/api/skills', skillsRouter);
  app.use('/api/models', modelsRouter());

  wsConnectionHandler!(wss);

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
