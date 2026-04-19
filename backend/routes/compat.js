// Compatibility wrappers to map old API endpoints to Phase1-like behavior
// This module exposes a set of wrappers for core/session endpoints under /api/sessions.*
// It delegates to the same SessionManager used by Phase1 routes.

module.exports = function registerCompat(app, deps = {}) {
  const { sessionManager } = deps
  if (!sessionManager) throw new Error('compat requires sessionManager')

  // Core old endpoints (redirect to SessionManager)
  // Create
  app.post('/api/sessions', async (req, res) => {
    try {
      const { workdir, agentType = 'claude-code', options = {} } = req.body || {}
      if (!workdir) return res.status(400).json({ error: 'workdir是必需的' })
      const session = await sessionManager.createSession(workdir, agentType, options)
      res.json(session?.toJSON ? session.toJSON() : session)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // List
  app.get('/api/sessions', (req, res) => {
    try {
      res.json(sessionManager.listSessions())
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Get
  app.get('/api/sessions/:id', (req, res) => {
    const s = sessionManager.getSession(req.params.id)
    if (!s) return res.status(404).json({ error: '会话不存在' })
    res.json(s?.toJSON ? s.toJSON() : s)
  })

  // Update (bulk)
  app.put('/api/sessions/:id', (req, res) => {
    try {
      const id = req.params.id
      const updates = req.body || {}
      const s = sessionManager.getSession(id)
      if (!s) return res.status(404).json({ error: '会话不存在' })
      Object.assign(s, updates, { updatedAt: new Date().toISOString() })
      if (typeof sessionManager.saveData === 'function') sessionManager.saveData()
      res.json({ success: true, session: s })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Rename
  app.put('/api/sessions/:id/rename', (req, res) => {
    try {
      const { title } = req.body
      if (!title) return res.status(400).json({ error: '标题是必需的' })
      const session = sessionManager.renameSession(req.params.id, title)
      res.json({ success: true, session })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Delete
  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      await sessionManager.removeSession(req.params.id)
      res.json({ success: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Phase1: Update conversation (legacy endpoint compatibility)
  app.put('/api/sessions/:id/conversation', (req, res) => {
    try {
      const id = req.params.id
      const { conversationId } = req.body
      const s = sessionManager.getSession(id)
      if (!s) return res.status(404).json({ error: '会话不存在' })
      s.conversationId = conversationId
      if (s.agent && s.agent.conversationId !== undefined) {
        s.agent.conversationId = conversationId
      }
      if (typeof sessionManager.saveData === 'function') sessionManager.saveData()
      res.json({ success: true, session: s })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // Phase1: Read messages for a legacy session
  app.get('/api/sessions/:id/messages', (req, res) => {
    try {
      const id = req.params.id
      const limit = parseInt(req.query.limit) || 100
      const offset = parseInt(req.query.offset) || 0
      const msgs = sessionManager.getMessages(id, limit, offset)
      res.json({ messages: msgs })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Phase1: Tags compatibility
  app.get('/api/sessions/:id/tags', (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id)
      res.json({ tags: session?.tags || [] })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.put('/api/sessions/:id/tags', (req, res) => {
    try {
      const { tags } = req.body
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags必须是数组' })
      const session = sessionManager.setSessionTags(req.params.id, tags)
      res.json({ success: true, session })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.post('/api/sessions/:id/tags', (req, res) => {
    try {
      const { tag } = req.body
      if (!tag) return res.status(400).json({ error: 'tag是必需的' })
      const session = sessionManager.addSessionTag(req.params.id, tag)
      res.json({ success: true, session })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.delete('/api/sessions/:id/tags/:tag', (req, res) => {
    try {
      const session = sessionManager.removeSessionTag(req.params.id, req.params.tag)
      res.json({ success: true, session })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.get('/api/sessions/tag/:tag', (req, res) => {
    try {
      const sessions = sessionManager.getSessionsByTag(req.params.tag)
      res.json(sessions)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Phase1: remove last N messages for a legacy session
  app.post('/api/sessions/:id/delete-last', (req, res) => {
    try {
      const count = req.body?.count || 2
      const result = sessionManager.deleteLastMessages(req.params.id, count)
      res.json(result)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Phase1: stop/resume legacy (forward to Phase1 behavior if available)
  app.post('/api/sessions/:id/stop', async (req, res) => {
    try {
      const id = req.params.id
      const session = sessionManager.getSession(id)
      if (session?.agent?.stop) {
        await session.agent.stop()
      }
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.post('/api/sessions/:id/resume', async (req, res) => {
    try {
      await sessionManager.resumeSession(req.params.id)
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.post('/api/sessions/:id/unpin', (req, res) => {
    try {
      const id = req.params.id
      const session = sessionManager.getSession(id)
      if (session) {
        session.isPinned = false
        session.updatedAt = new Date().toISOString()
        if (typeof sessionManager.saveData === 'function') sessionManager.saveData()
      }
      res.json({ success: true, session })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })
}
