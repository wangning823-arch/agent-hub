const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {
  router.get('/', (req, res) => {
    try {
      const tags = sessionManager.getAllTags();
      res.json({ tags });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id/tags', (req, res) => {
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

  router.post('/:id/tags', (req, res) => {
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

  router.delete('/:id/tags/:tag', (req, res) => {
    try {
      const session = sessionManager.removeSessionTag(req.params.id, req.params.tag);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/filter/:tag', (req, res) => {
    try {
      const sessions = sessionManager.getSessionsByTag(req.params.tag);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};