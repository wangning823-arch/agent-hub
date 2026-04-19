const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const SessionManager = require('./sessions');
const PermissionManager = require('./permissions');
const ProjectManager = require('./projects');
const TokenTracker = require('./token-tracker');

const sessionsRouter = require('./routes/sessions');
const tagsRouter = require('./routes/tags');
const projectsRouter = require('./routes/projects');
const filesRouter = require('./routes/files');
const gitRouter = require('./routes/git');
const searchRouter = require('./routes/search');
const permissionsRouter = require('./routes/permissions');
const tokensRouter = require('./routes/tokens');
const exportRouter = require('./routes/export');
const healthRouter = require('./routes/health');
const uploadRouter = require('./routes/upload');
const optionsRouter = require('./routes/options');

const authMiddleware = require('./middleware/auth');
const corsMiddleware = require('./middleware/cors');
const errorHandlerMiddleware = require('./middleware/errorHandler');
const wsHandler = require('./websocket/handler');

const app = express();

process.on('uncaughtException', (err) => {
  console.error('[Global] 未捕获异常', err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[Global] 未处理的 Promise 拒绝', p, '原因:', reason);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;
const tokenTracker = new TokenTracker();
const sessionManager = new SessionManager(tokenTracker);
const permissionManager = new PermissionManager();
const projectManager = new ProjectManager();

const ALLOWED_ROOT = process.env.ALLOWED_ROOT || process.env.HOME || '/root';
const TOKEN_FILE = path.join(__dirname, '..', '.token');
const DIST_PATH = path.join(__dirname, '..', 'frontend', 'dist');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(DIST_PATH));

const { UPLOAD_DIR } = require('./upload');
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(authMiddleware(TOKEN_FILE));
app.use(corsMiddleware());

app.use((err, req, res, next) => {
  errorHandlerMiddleware()(err, req, res, next);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/agents', (req, res) => {
  res.json({
    agents: [
      { id: 'claude-code', name: 'Claude Code', available: true },
      { id: 'claude-api', name: 'Claude API', available: true },
      { id: 'opencode', name: 'OpenCode', available: true },
      { id: 'codex', name: 'Codex', available: true }
    ]
  });
});

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

app.get('/api/auth/check', (req, res) => {
  let ACCESS_TOKEN = '';
  try {
    ACCESS_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch (e) {}
  const token = req.headers['x-access-token'] || req.query.token;
  res.json({ valid: !ACCESS_TOKEN || token === ACCESS_TOKEN });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws") || req.path.startsWith("/uploads")) return next();
  res.sendFile(path.join(DIST_PATH, "index.html"));
});

const wsConnectionHandler = wsHandler(sessionManager, TOKEN_FILE);
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
  const sessions = sessionManager.listSessions();
  for (const session of sessions) {
    await sessionManager.removeSession(session.id);
  }
  process.exit(0);
});