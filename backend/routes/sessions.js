// Phase1: Phase-1 Sessions Routes (namespace: /api/phase1)
// This module provides a non-breaking, isolated set of endpoints to begin decoupling
// session handling from the monolithic server file. It delegates to the existing
// SessionManager where applicable.
module.exports = function registerPhase1(app, sessionManager) {
  // Create a new phase1 session
  app.post('/api/phase1/sessions', async (req, res) => {
    try {
      const { workdir, agentType = 'claude-code', options = {} } = req.body || {};
      if (!workdir) return res.status(400).json({ error: 'workdir是必需的' });
      const session = await sessionManager.createSession(workdir, agentType, options);
      res.json(session?.toJSON ? session.toJSON() : session);
    } catch (err) {
      console.error('Phase1 创建会话失败:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List all phase1 sessions
  app.get('/api/phase1/sessions', (req, res) => {
    try {
      res.json(sessionManager.listSessions());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get specific phase1 session
  app.get('/api/phase1/sessions/:id', (req, res) => {
    const sess = sessionManager.getSession(req.params.id);
    if (!sess) return res.status(404).json({ error: '会话不存在' });
    res.json(sess.toJSON ? sess.toJSON() : sess);
  });

  // Resume phase1 session (重新启动 agent)
  app.post('/api/phase1/sessions/:id/resume', async (req, res) => {
    try {
      await sessionManager.resumeSession(req.params.id);
      const s = sessionManager.getSession(req.params.id);
      res.json({ session: s?.toJSON ? s.toJSON() : s });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rename phase1 session
  app.put('/api/phase1/sessions/:id/rename', (req, res) => {
    try {
      const { title } = req.body;
      if (!title) return res.status(400).json({ error: 'title是必需的' });
      const session = sessionManager.renameSession(req.params.id, title);
      res.json({ session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Pin/Archive phase1 session
  app.post('/api/phase1/sessions/:id/pin', (req, res) => {
    try {
      const session = sessionManager.togglePinSession(req.params.id);
      res.json({ session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/phase1/sessions/:id/archive', (req, res) => {
    try {
      const session = sessionManager.toggleArchiveSession(req.params.id);
      res.json({ session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Messages for a phase1 session
  app.get('/api/phase1/sessions/:id/messages', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      const messages = sessionManager.getMessages(req.params.id, limit, offset);
      res.json({ messages });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 delete session
  app.delete('/api/phase1/sessions/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (typeof sessionManager.removeSession === 'function') {
        await sessionManager.removeSession(id);
        res.json({ success: true, id });
      } else {
        res.status(501).json({ error: 'removeSession 未实现' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 update a phase1 session (extended: bulk fields)
  // (已在前面的 patch 中实现，这里补充一个单独的命中点用于清晰测试)
  // Phase1 stop agent
  app.post('/api/phase1/sessions/:id/stop', async (req, res) => {
    try {
      const id = req.params.id;
      const session = sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      const agent = session.agent;
      if (agent && typeof agent.stop === 'function') {
        await agent.stop();
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 generate summary for a session
  app.get('/api/phase1/sessions/:id/summary', (req, res) => {
    try {
      const id = req.params.id;
      const session = sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      const msgs = Array.isArray(session.messages) ? session.messages.filter(m => typeof m.content === 'string') : [];
      const lastThree = msgs.slice(-3).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
      const summary = `Session ${id} – ${session.title || ''}\n${lastThree}`;
      res.json({ summary, title: session.title || '', id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 export to Markdown (simple)
  app.get('/api/phase1/sessions/:id/export/markdown', (req, res) => {
    try {
      const id = req.params.id;
      const session = sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      const title = session.title || session.workdir?.split('/').pop() || id;
      const createdAt = session.createdAt || new Date().toISOString();
      let md = `# ${title}\n\n- Created: ${createdAt}\n- Session ID: ${id}\n\n---\n\n`;
      const msgs = Array.isArray(session.messages) ? session.messages : [];
      for (const m of msgs) {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const time = m.time ? new Date(m.time).toLocaleTimeString('en-US') : '';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        md += `## ${role} (${time})\n\n${content}\n\n---\n\n`;
      }

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.send(md)
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 update options (extended operation)
  app.put('/api/phase1/sessions/:id/options', (req, res) => {
    try {
      const id = req.params.id;
      const updates = req.body || {};
      const session = sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      session.options = { ...(session.options || {}), ...updates };
      if (typeof sessionManager.saveData === 'function') sessionManager.saveData();
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 update session (bulk update fields)
  app.put('/api/phase1/sessions/:id', (req, res) => {
    try {
      const id = req.params.id;
      const updates = req.body || {};
      const session = sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      Object.assign(session, updates, { updatedAt: new Date().toISOString() });
      if (typeof sessionManager.saveData === 'function') {
        sessionManager.saveData();
      }
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 unpin (explicit)
  app.post('/api/phase1/sessions/:id/unpin', (req, res) => {
    try {
      const id = req.params.id;
      const session = sessionManager.getSession(id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      session.isPinned = false;
      session.updatedAt = new Date().toISOString();
      if (typeof sessionManager.saveData === 'function') sessionManager.saveData();
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 update conversation
  app.put('/api/phase1/sessions/:id/conversation', (req, res) => {
    try {
      const { conversationId } = req.body;
      const session = sessionManager.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      session.conversationId = conversationId;
      if (session.agent) {
        session.agent.conversationId = conversationId;
      }
      // 保存到文件/持久化（阶段1采用现有持久化通道）
      if (typeof sessionManager.saveData === 'function') {
        sessionManager.saveData();
      }
      res.json({ success: true, conversationId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 get tags for a session
  app.get('/api/phase1/sessions/:id/tags', (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: '会话不存在' });
      res.json({ tags: session.tags || [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 set tags for a session
  app.put('/api/phase1/sessions/:id/tags', (req, res) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags必须是数组' });
      const session = sessionManager.setSessionTags(req.params.id, tags);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 add a tag to a session
  app.post('/api/phase1/sessions/:id/tags', (req, res) => {
    try {
      const { tag } = req.body;
      if (!tag) return res.status(400).json({ error: 'tag是必需的' });
      const session = sessionManager.addSessionTag(req.params.id, tag);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 delete a tag from a session
  app.delete('/api/phase1/sessions/:id/tags/:tag', (req, res) => {
    try {
      const session = sessionManager.removeSessionTag(req.params.id, req.params.tag);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 filter sessions by tag
  app.get('/api/phase1/sessions/tag/:tag', (req, res) => {
    try {
      const sessions = sessionManager.getSessionsByTag(req.params.tag);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 delete last N messages for a session
  app.post('/api/phase1/sessions/:id/delete-last', (req, res) => {
    try {
      const count = req.body.count || 2;
      const result = sessionManager.deleteLastMessages(req.params.id, count);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Phase1 status endpoint for quick readiness check
  app.get('/api/phase1/status', (req, res) => {
    try {
      const count = sessionManager.listSessions().length;
      res.json({ ready: true, count });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
