import { Router, Request, Response } from 'express';

export default (tokenTracker: any, sessionManager?: any) => {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const allStats = tokenTracker.getAllStats();
      let filteredStats = allStats;

      if (req.user && req.user.role !== 'admin' && sessionManager) {
        const userSessionIds = new Set(
          sessionManager.listSessions(req.user.userId).map((s: any) => s.id)
        );
        filteredStats = {};
        for (const [sid, stats] of Object.entries(allStats)) {
          if (userSessionIds.has(sid)) {
            filteredStats[sid] = stats;
          }
        }
      }

      const totalStats = tokenTracker.getTotalStats();
      res.json({
        sessions: filteredStats,
        total: totalStats
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:sessionId', (req: Request, res: Response) => {
    const stats = tokenTracker.getSessionStats(req.params.sessionId);
    res.json(stats);
  });

  router.post('/:sessionId', (req: Request, res: Response) => {
    try {
      const { usage } = req.body;
      const stats = tokenTracker.recordUsage(req.params.sessionId, usage);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:sessionId', (req: Request, res: Response) => {
    tokenTracker.clearSessionStats(req.params.sessionId);
    res.json({ success: true });
  });

  return router;
};
