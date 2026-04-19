const express = require('express');
const router = express.Router();

module.exports = (tokenTracker) => {
  router.get('/', (req, res) => {
    const allStats = tokenTracker.getAllStats();
    const totalStats = tokenTracker.getTotalStats();
    res.json({
      sessions: allStats,
      total: totalStats
    });
  });

  router.get('/:sessionId', (req, res) => {
    const stats = tokenTracker.getSessionStats(req.params.sessionId);
    res.json(stats);
  });

  router.post('/:sessionId', (req, res) => {
    try {
      const { usage } = req.body;
      const stats = tokenTracker.recordUsage(req.params.sessionId, usage);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:sessionId', (req, res) => {
    tokenTracker.clearSessionStats(req.params.sessionId);
    res.json({ success: true });
  });

  return router;
};