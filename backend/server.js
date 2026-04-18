/**
 * Agent Hub - 后端服务器
 */
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const SessionManager = require('./sessions');
const PermissionManager = require('./permissions');
const ProjectManager = require('./projects');
const { CLAUDE_COMMANDS, PERMISSION_MODES, MODELS, EFFORT_LEVELS } = require('./commands');
const { upload, handleUpload, handlePasteImage, UPLOAD_DIR } = require('./upload');
const TokenTracker = require('./token-tracker');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;
const sessionManager = new SessionManager();
const permissionManager = new PermissionManager();
const projectManager = new ProjectManager();
const tokenTracker = new TokenTracker();

// 中间件
app.use(express.json({ limit: '50mb' })); // 增加limit以支持base64图片

// 静态文件服务（上传的文件）
app.use('/uploads', express.static(UPLOAD_DIR));

// CORS (开发环境)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE');
  next();
});

// ============ REST API ============

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取支持的Agent类型
app.get('/api/agents', (req, res) => {
  res.json({
    agents: [
      { id: 'claude-code', name: 'Claude Code', available: true },
      { id: 'opencode', name: 'OpenCode', available: true },
      { id: 'codex', name: 'Codex', available: true }
    ]
  });
});

// 创建会话
app.post('/api/sessions', async (req, res) => {
  try {
    const { workdir, agentType = 'claude-code' } = req.body;
    
    if (!workdir) {
      return res.status(400).json({ error: 'workdir是必需的' });
    }

    const session = await sessionManager.createSession(workdir, agentType);
    res.json(session.toJSON());
  } catch (error) {
    console.error('创建会话失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取所有会话
app.get('/api/sessions', (req, res) => {
  res.json(sessionManager.listSessions());
});

// 获取单个会话
app.get('/api/sessions/:id', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  res.json(session.toJSON());
});

// 删除会话
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await sessionManager.removeSession(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新会话对话ID
app.put('/api/sessions/:id/conversation', async (req, res) => {
  try {
    const { conversationId } = req.body;
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    
    session.conversationId = conversationId;
    if (session.agent) {
      session.agent.conversationId = conversationId;
    }
    
    // 保存到文件
    sessionManager.saveData();
    
    res.json({ success: true, conversationId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 继续会话（重新启动agent）
app.post('/api/sessions/:id/resume', async (req, res) => {
  try {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    if (session.isActive) {
      return res.json({ message: '会话已经是活跃状态', session: session.toJSON() });
    }

    // 准备选项，包含对话ID用于恢复
    const resumeOptions = {
      ...session.options,
      conversationId: session.conversationId
    };

    // 重新启动agent
    const newSession = await sessionManager.createSession(
      session.workdir,
      session.agentType || 'claude-code',
      resumeOptions
    );

    // 恢复历史消息
    newSession.messages = session.messages;
    newSession.conversationId = session.conversationId;

    res.json({
      message: '会话已恢复',
      session: newSession.toJSON()
    });
  } catch (error) {
    console.error('恢复会话失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ 权限 API ============

// 获取所有权限配置
app.get('/api/permissions', (req, res) => {
  res.json(permissionManager.getAllPermissions());
});

// 更新权限配置
app.put('/api/permissions', (req, res) => {
  const { action, policy } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'action是必需的' });
  }
  permissionManager.updatePermission(action, policy);
  res.json({ success: true });
});

// 检查权限
app.post('/api/permissions/check', (req, res) => {
  const { action, details } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'action是必需的' });
  }
  const decision = permissionManager.checkPermission(action, details);
  res.json({ decision });
});

// ============ 文件 API ============

const fs = require('fs');

// 获取文件列表
app.get('/api/files', (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) {
    return res.status(400).json({ error: 'path参数是必需的' });
  }

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = items.map(item => ({
      name: item.name,
      path: `${dirPath}/${item.name}`.replace(/\/+/g, '/'),
      isDirectory: item.isDirectory()
    }));
    
    // 排序：目录在前，文件在后
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取文件内容
app.get('/api/files/content', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'path参数是必需的' });
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 项目 API ============

// 获取所有项目
app.get('/api/projects', (req, res) => {
  res.json(projectManager.listProjects());
});

// 获取最近项目
app.get('/api/projects/recent', (req, res) => {
  res.json(projectManager.getRecentProjects());
});

// 获取收藏项目
app.get('/api/projects/favorites', (req, res) => {
  res.json(projectManager.getFavoriteProjects());
});

// 创建项目
app.post('/api/projects', (req, res) => {
  try {
    const { name, workdir, agentType, mode, model, effort } = req.body;
    
    if (!name || !workdir) {
      return res.status(400).json({ error: 'name和workdir是必需的' });
    }

    const project = projectManager.addProject(name, workdir, agentType, {
      mode, model, effort
    });
    res.json(project);
  } catch (error) {
    console.error('创建项目失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 更新项目
app.put('/api/projects/:id', (req, res) => {
  try {
    const updates = req.body;
    const project = projectManager.updateProject(req.params.id, updates);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除项目
app.delete('/api/projects/:id', (req, res) => {
  try {
    projectManager.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 收藏/取消收藏项目
app.post('/api/projects/:id/favorite', (req, res) => {
  try {
    const project = projectManager.toggleFavorite(req.params.id);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 搜索项目
app.get('/api/projects/search', (req, res) => {
  const query = req.query.q || '';
  res.json(projectManager.searchProjects(query));
});

// 启动项目会话
app.post('/api/projects/:id/start', async (req, res) => {
  try {
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: '项目不存在' });
    }

    // 创建会话时传入项目配置
    const session = await sessionManager.createSession(
      project.workdir,
      project.agentType,
      {
        mode: project.mode,
        model: project.model,
        effort: project.effort
      }
    );

    // 更新项目的最近使用时间
    projectManager.updateProject(project.id, {
      lastSessionId: session.id,
      lastUsedAt: new Date().toISOString()
    });

    res.json({
      session: session.toJSON(),
      project: project
    });
  } catch (error) {
    console.error('启动项目会话失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ Token统计 API ============

// 获取会话Token统计
app.get('/api/tokens/:sessionId', (req, res) => {
  const stats = tokenTracker.getSessionStats(req.params.sessionId);
  res.json(stats);
});

// 获取所有会话统计
app.get('/api/tokens', (req, res) => {
  const allStats = tokenTracker.getAllStats();
  const totalStats = tokenTracker.getTotalStats();
  res.json({
    sessions: allStats,
    total: totalStats
  });
});

// 记录Token使用（由前端或agent调用）
app.post('/api/tokens/:sessionId', (req, res) => {
  try {
    const { usage } = req.body;
    const stats = tokenTracker.recordUsage(req.params.sessionId, usage);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 清除会话统计
app.delete('/api/tokens/:sessionId', (req, res) => {
  tokenTracker.clearSessionStats(req.params.sessionId);
  res.json({ success: true });
});

// ============ 上下文管理 API ============

// 压缩上下文
app.post('/api/sessions/:id/compact', async (req, res) => {
  try {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    // 发送压缩命令给agent
    if (session.agent && session.agent.send) {
      await session.agent.send('/compact');
      res.json({ success: true, message: '已发送压缩命令' });
    } else {
      res.status(400).json({ error: 'Agent不支持此操作' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取上下文信息
app.get('/api/sessions/:id/context', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }

  // 计算上下文大小
  const messageCount = session.messages.length;
  const estimatedTokens = session.messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + Math.ceil(content.length / 4); // 粗略估算：4字符≈1token
  }, 0);

  res.json({
    messageCount,
    estimatedTokens,
    conversationId: session.conversationId,
    isActive: session.isActive,
    createdAt: session.createdAt
  });
});

// ============ 文件上传 API ============

// 上传文件（支持多文件）
app.post('/api/upload', upload.array('files', 5), handleUpload);

// 处理剪切板粘贴的图片
app.post('/api/upload/paste', handlePasteImage);

// 获取上传的文件列表
app.get('/api/uploads', (req, res) => {
  try {
    const files = [];
    if (fs.existsSync(UPLOAD_DIR)) {
      const dates = fs.readdirSync(UPLOAD_DIR);
      for (const date of dates) {
        const dateDir = path.join(UPLOAD_DIR, date);
        if (fs.statSync(dateDir).isDirectory()) {
          const items = fs.readdirSync(dateDir);
          for (const item of items) {
            const filePath = path.join(dateDir, item);
            const stat = fs.statSync(filePath);
            files.push({
              name: item,
              path: filePath,
              url: `/uploads/${date}/${item}`,
              size: stat.size,
              date,
              modifiedAt: stat.mtime
            });
          }
        }
      }
    }
    // 按修改时间倒序
    files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    res.json({ files: files.slice(0, 50) }); // 最近50个
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Git API ============

// 获取Git状态
app.get('/api/git/status', async (req, res) => {
  const workdir = req.query.path;
  if (!workdir) {
    return res.status(400).json({ error: 'path参数是必需的' });
  }

  try {
    const { execSync } = require('child_process');
    
    // 获取当前分支
    let branch = 'main';
    try {
      branch = execSync('git branch --show-current', { cwd: workdir, encoding: 'utf8' }).trim();
    } catch (e) {}

    // 获取修改的文件
    let modified = [];
    let staged = [];
    let untracked = [];
    
    try {
      const status = execSync('git status --porcelain', { cwd: workdir, encoding: 'utf8' });
      status.split('\n').filter(Boolean).forEach(line => {
        const statusChar = line.slice(0, 2);
        const file = line.slice(3);
        
        if (statusChar[0] === 'M' || statusChar[0] === 'A') {
          staged.push(file);
        } else if (statusChar[1] === 'M') {
          modified.push(file);
        } else if (statusChar === '??') {
          untracked.push(file);
        }
      });
    } catch (e) {}

    res.json({ branch, modified, staged, untracked });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 执行Git命令
app.post('/api/git/command', async (req, res) => {
  const { workdir, command } = req.body;
  if (!workdir || !command) {
    return res.status(400).json({ error: 'workdir和command是必需的' });
  }

  // 安全检查：只允许特定git命令
  const allowedCommands = ['pull', 'push', 'status', 'log', 'diff', 'stash', 'fetch'];
  const cmd = command.replace('git ', '').split(' ')[0];
  
  if (!allowedCommands.includes(cmd)) {
    return res.status(403).json({ error: '不允许的命令' });
  }

  try {
    const { execSync } = require('child_process');
    const output = execSync(command, { cwd: workdir, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    res.json({ output: output.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message, output: error.stderr || error.message });
  }
});

// Git提交
app.post('/api/git/commit', async (req, res) => {
  const { workdir, message, files } = req.body;
  if (!workdir || !message) {
    return res.status(400).json({ error: 'workdir和message是必需的' });
  }

  try {
    const { execSync } = require('child_process');
    
    // 暂存文件
    if (files && files.length > 0) {
      execSync(`git add ${files.map(f => `"${f}"`).join(' ')}`, { cwd: workdir });
    } else {
      execSync('git add -A', { cwd: workdir });
    }
    
    // 提交
    const output = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: workdir,
      encoding: 'utf8'
    });
    
    res.json({ success: true, output: output.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 命令和选项 API ============

// 获取所有命令
app.get('/api/commands', (req, res) => {
  res.json({ commands: CLAUDE_COMMANDS });
});

// 获取权限模式
app.get('/api/options/modes', (req, res) => {
  res.json({ modes: PERMISSION_MODES });
});

// 获取模型列表
app.get('/api/options/models', (req, res) => {
  res.json({ models: MODELS });
});

// 获取努力程度
app.get('/api/options/efforts', (req, res) => {
  res.json({ efforts: EFFORT_LEVELS });
});

// 获取所有选项
app.get('/api/options', (req, res) => {
  res.json({
    modes: PERMISSION_MODES,
    models: MODELS,
    efforts: EFFORT_LEVELS
  });
});

// ============ WebSocket ============

/**
 * 处理WebSocket命令
 */
async function handleCommand(sessionId, command, params = {}) {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`会话不存在: ${sessionId}`);
  }

  const agent = session.agent;
  
  switch (command) {
    case 'set_mode':
      if (agent.updateOptions) {
        agent.updateOptions({ mode: params.mode });
      }
      break;
      
    case 'set_model':
      if (agent.updateOptions) {
        agent.updateOptions({ model: params.model });
      }
      break;
      
    case 'set_effort':
      if (agent.updateOptions) {
        agent.updateOptions({ effort: params.effort });
      }
      break;
      
    case 'update_options':
      if (agent.updateOptions) {
        agent.updateOptions(params);
      }
      break;
      
    default:
      throw new Error(`未知命令: ${command}`);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    ws.close(4000, '需要sessionId参数');
    return;
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    ws.close(4001, '会话不存在');
    return;
  }

  console.log(`WebSocket连接: session=${sessionId}`);
  sessionManager.addClient(sessionId, ws);

  // 接收客户端消息
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'user_input') {
        await sessionManager.sendMessage(sessionId, msg.content);
      } else if (msg.type === 'command') {
        // 处理命令（如切换模式、模型等）
        await handleCommand(sessionId, msg.command, msg.params);
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', content: error.message }));
    }
  });

  // 连接关闭
  ws.on('close', () => {
    console.log(`WebSocket断开: session=${sessionId}`);
    sessionManager.removeClient(sessionId, ws);
  });
});

// ============ 启动服务器 ============

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

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n正在关闭...');
  const sessions = sessionManager.listSessions();
  for (const session of sessions) {
    await sessionManager.removeSession(session.id);
  }
  process.exit(0);
});