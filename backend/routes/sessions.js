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
};
