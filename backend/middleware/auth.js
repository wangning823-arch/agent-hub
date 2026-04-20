const fs = require('fs');
const path = require('path');

module.exports = (TOKEN_FILE) => {
  let ACCESS_TOKEN = '';
  try {
    ACCESS_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch (e) {}

  return (req, res, next) => {
    if (
      req.path === '/' ||
      req.path.startsWith('/assets') ||
      req.path === '/api/health' ||
      req.path === '/api/auth/check' ||
      req.path === '/api/agents' ||
      req.path.startsWith('/api/options') ||
      req.path === '/api/permissions'
    ) {
      return next();
    }

    const token = req.headers['x-access-token'] || req.query.token;
    if (!ACCESS_TOKEN || token === ACCESS_TOKEN) {
      return next();
    }

    res.status(401).json({ error: 'unauthorized' });
  };
};