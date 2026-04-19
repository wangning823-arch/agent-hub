const express = require('express');
const router = express.Router();

module.exports = (permissionManager) => {
  router.get('/', (req, res) => {
    res.json(permissionManager.getAllPermissions());
  });

  router.put('/', (req, res) => {
    const { action, policy } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'action是必需的' });
    }
    permissionManager.updatePermission(action, policy);
    res.json({ success: true });
  });

  router.post('/check', (req, res) => {
    const { action, details } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'action是必需的' });
    }
    const decision = permissionManager.checkPermission(action, details);
    res.json({ decision });
  });

  return router;
};