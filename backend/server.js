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

// 重命名会话
app.put('/api/sessions/:id/rename', (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: '标题是必需的' });
    }
    const session = sessionManager.renameSession(req.params.id, title);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 置顶/取消置顶会话
app.post('/api/sessions/:id/pin', (req, res) => {
  try {
    const session = sessionManager.togglePinSession(req.params.id);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 归档/取消归档会话
app.post('/api/sessions/:id/archive', (req, res) => {
  try {
    const session = sessionManager.toggleArchiveSession(req.params.id);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有标签
app.get('/api/tags', (req, res) => {
  try {
    const tags = sessionManager.getAllTags();
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置会话标签
app.put('/api/sessions/:id/tags', (req, res) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags必须是数组' });
    }
    const session = sessionManager.setSessionTags(req.params.id, tags);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加会话标签
app.post('/api/sessions/:id/tags', (req, res) => {
  try {
    const { tag } = req.body;
    if (!tag) {
      return res.status(400).json({ error: 'tag是必需的' });
    }
    const session = sessionManager.addSessionTag(req.params.id, tag);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除会话标签
app.delete('/api/sessions/:id/tags/:tag', (req, res) => {
  try {
    const session = sessionManager.removeSessionTag(req.params.id, req.params.tag);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 按标签筛选会话
app.get('/api/sessions/tag/:tag', (req, res) => {
  try {
    const sessions = sessionManager.getSessionsByTag(req.params.tag);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取会话消息列表
app.get('/api/sessions/:id/messages', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const messages = sessionManager.getMessages(req.params.id, limit, offset);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除单条消息
app.delete('/api/sessions/:id/messages/:index', (req, res) => {
  try {
    const messageIndex = parseInt(req.params.index);
    const result = sessionManager.deleteMessage(req.params.id, messageIndex);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除最后N条消息（用于重新生成）
app.post('/api/sessions/:id/delete-last', (req, res) => {
  try {
    const count = req.body.count || 2;
    const result = sessionManager.deleteLastMessages(req.params.id, count);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 搜索 API ============

// 搜索消息
app.get('/api/search/messages', (req, res) => {
  const { query, sessionId, limit = 50 } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'query参数是必需的' });
  }
  
  try {
    const results = [];
    const searchLower = query.toLowerCase();
    
    // 获取所有会话
    const sessions = sessionManager.listSessions();
    
    for (const session of sessions) {
      // 如果指定了sessionId，只搜索该会话
      if (sessionId && session.id !== sessionId) continue;
      
      const sessionData = sessionManager.getSession(session.id);
      if (!sessionData || !sessionData.messages) continue;
      
      sessionData.messages.forEach((msg, index) => {
        const content = typeof msg.content === 'string' 
          ? msg.content 
          : JSON.stringify(msg.content);
        
        if (content.toLowerCase().includes(searchLower)) {
          // 提取匹配的上下文
          const contentLower = content.toLowerCase();
          const matchIndex = contentLower.indexOf(searchLower);
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(content.length, matchIndex + query.length + 50);
          const snippet = (start > 0 ? '...' : '') + 
            content.slice(start, end) + 
            (end < content.length ? '...' : '');
          
          results.push({
            sessionId: session.id,
            sessionTitle: session.title || session.workdir.split('/').pop(),
            messageIndex: index,
            role: msg.role,
            snippet,
            timestamp: msg.time,
            matchCount: (contentLower.match(new RegExp(searchLower, 'g')) || []).length
          });
        }
      });
      
      if (results.length >= parseInt(limit)) break;
    }
    
    // 按时间倒序排列
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      query,
      total: results.length,
      results: results.slice(0, parseInt(limit))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 搜索会话
app.get('/api/search/sessions', (req, res) => {
  const { query, limit = 20 } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'query参数是必需的' });
  }
  
  try {
    const searchLower = query.toLowerCase();
    const sessions = sessionManager.listSessions();
    
    const results = sessions
      .filter(session => {
        const title = (session.title || '').toLowerCase();
        const workdir = session.workdir.toLowerCase();
        return title.includes(searchLower) || workdir.includes(searchLower);
      })
      .slice(0, parseInt(limit))
      .map(session => ({
        id: session.id,
        title: session.title || session.workdir.split('/').pop(),
        workdir: session.workdir,
        messageCount: session.messageCount,
        lastMessageAt: session.lastMessageAt,
        isPinned: session.isPinned
      }));
    
    res.json({
      query,
      total: results.length,
      results
    });
  } catch (error) {
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

// 保存文件内容
app.put('/api/files/content', (req, res) => {
  const { path: filePath, content } = req.body;
  
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'path和content参数是必需的' });
  }

  try {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    // 写入文件
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, message: '文件已保存' });
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

// 从 Git URL 导入项目
app.post('/api/projects/import-git', async (req, res) => {
  try {
    const { gitUrl, agentType, mode, model, effort } = req.body;

    if (!gitUrl) {
      return res.status(400).json({ error: 'gitUrl 是必需的' });
    }

    // 解析 GitHub URL 获取 owner/repo
    let repoName = '';
    let cloneUrl = gitUrl.trim();

    // 处理各种格式的 GitHub URL
    const patterns = [
      /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/,
      /gitlab\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/,
      /bitbucket\.org[:/]([^/]+)\/([^/.]+)(?:\.git)?$/,
      /([^/:]+)\/([^/.]+)(?:\.git)?$/ // 通用格式 user/repo
    ];

    let owner = '';
    for (const pattern of patterns) {
      const match = cloneUrl.match(pattern);
      if (match) {
        owner = match[1];
        repoName = match[2];
        break;
      }
    }

    if (!repoName) {
      return res.status(400).json({ error: '无法解析 Git URL，请检查格式' });
    }

    // 检查项目是否已存在（在 projects.json 中）
    const existingProject = projectManager.getAllProjects().find(p => {
      const dirName = p.workdir.split('/').pop();
      return dirName === repoName || p.workdir.includes(`/${repoName}`);
    });

    if (existingProject) {
      // 项目已存在，直接返回
      console.log(`项目 ${repoName} 已存在于 ${existingProject.workdir}`);
      return res.json({
        project: existingProject,
        status: 'existing',
        message: `项目 ${repoName} 已存在`
      });
    }

    // 在 ~/projects 目录下 clone
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    const baseDir = path.join(os.homedir(), 'projects');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const workdir = path.join(baseDir, repoName);

    if (fs.existsSync(workdir)) {
      // 目录存在但不在 projects.json 中，直接导入
      console.log(`目录 ${workdir} 已存在，导入项目`);
      const project = projectManager.addProject(repoName, workdir, agentType || 'claude-code', {
        mode, model, effort
      });
      return res.json({
        project,
        status: 'imported',
        message: `目录已存在，已导入项目 ${repoName}`
      });
    }

    // Clone 仓库
    console.log(`正在 clone ${cloneUrl} 到 ${workdir}...`);

    // 确保 cloneUrl 格式正确（如果没有协议，加 https://）
    if (!cloneUrl.startsWith('http') && !cloneUrl.startsWith('git@')) {
      cloneUrl = `https://github.com/${cloneUrl}`;
    }
    // 如果是 https://github.com/user/repo 格式，确保有 .git 后缀用于 clone
    if (cloneUrl.startsWith('https://github.com/') && !cloneUrl.endsWith('.git')) {
      cloneUrl = cloneUrl + '.git';
    }

    try {
      execSync(`git clone "${cloneUrl}" "${workdir}"`, {
        timeout: 120000, // 2分钟超时
        stdio: 'pipe'
      });
    } catch (cloneError) {
      // 清理失败的 clone 目录
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
      return res.status(500).json({
        error: `Git clone 失败: ${cloneError.stderr?.toString() || cloneError.message}`
      });
    }

    // 创建项目
    const project = projectManager.addProject(repoName, workdir, agentType || 'claude-code', {
      mode, model, effort
    });

    res.json({
      project,
      status: 'cloned',
      message: `成功 clone 并创建项目 ${repoName}`
    });

  } catch (error) {
    console.error('导入 Git 项目失败:', error);
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
  const allowedCommands = ['pull', 'push', 'status', 'log', 'diff', 'stash', 'fetch', 'branch'];
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

// ============ 导出 API ============

// 导出会话为Markdown
app.get('/api/export/session/:id', (req, res) => {
  try {
    const session = sessionManager.getSession(req.params.id)
    if (!session) {
      return res.status(404).json({ error: '会话不存在' })
    }
    
    const title = session.title || session.workdir.split('/').pop()
    const createdAt = new Date(session.createdAt).toLocaleString('zh-CN')
    
    let markdown = `# ${title}\n\n`
    markdown += `- **项目路径**: ${session.workdir}\n`
    markdown += `- **创建时间**: ${createdAt}\n`
    markdown += `- **消息数量**: ${session.messages.length}\n\n`
    markdown += `---\n\n`
    
    for (const msg of session.messages) {
      const role = msg.role === 'user' ? '👤 用户' : '🤖 助手'
      const time = new Date(msg.time).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      })
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content, null, 2)
      
      markdown += `### ${role} (${time})\n\n${content}\n\n---\n\n`
    }
    
    // 设置下载头
    const filename = `${title}_${new Date().toISOString().slice(0, 10)}.md`
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    res.send(markdown)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 导出所有会话列表
app.get('/api/export/sessions', (req, res) => {
  try {
    const sessions = sessionManager.listSessions()
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title,
        workdir: s.workdir,
        agentName: s.agentName,
        messageCount: s.messageCount,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        isPinned: s.isPinned,
        isArchived: s.isArchived,
        conversationId: s.conversationId
      }))
    }
    
    const filename = `agent-hub-backup_${new Date().toISOString().slice(0, 10)}.json`
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    res.json(exportData)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 导入备份
app.post('/api/import/sessions', (req, res) => {
  const { sessions: importedSessions, overwrite = false } = req.body
  
  if (!importedSessions || !Array.isArray(importedSessions)) {
    return res.status(400).json({ error: '无效的备份数据' })
  }
  
  try {
    const results = {
      imported: 0,
      skipped: 0,
      errors: []
    }
    
    const existingSessions = sessionManager.listSessions()
    
    for (const sessionData of importedSessions) {
      try {
        // 检查是否已存在
        const exists = existingSessions.find(s => 
          s.id === sessionData.id || 
          (s.workdir === sessionData.workdir && s.title === sessionData.title)
        )
        
        if (exists && !overwrite) {
          results.skipped++
          continue
        }
        
        // 创建新会话
        const newSession = {
          id: sessionData.id || require('uuid').v4(),
          workdir: sessionData.workdir,
          agentType: sessionData.agentName === 'Claude Code' ? 'claude-code' : 
                    sessionData.agentName === 'Codex' ? 'codex' : 'opencode',
          title: sessionData.title,
          isPinned: sessionData.isPinned || false,
          isArchived: sessionData.isArchived || false,
          conversationId: sessionData.conversationId,
          messages: [],
          createdAt: new Date(sessionData.createdAt || Date.now()),
          updatedAt: new Date(sessionData.updatedAt || Date.now())
        }
        
        // 添加到会话管理器
        sessionManager.sessions.set(newSession.id, newSession)
        results.imported++
      } catch (err) {
        results.errors.push({
          session: sessionData.title || sessionData.id,
          error: err.message
        })
      }
    }
    
    // 保存数据
    sessionManager.saveData()
    
    res.json({
      success: true,
      ...results
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

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