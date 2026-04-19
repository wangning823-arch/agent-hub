// Phase0: Health route skeleton
module.exports = function registerHealthRoute(app) {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'phase0-draft', ok: true, timestamp: new Date().toISOString() });
  });
};
