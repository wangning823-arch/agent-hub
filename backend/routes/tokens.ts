import { Router, Request, Response } from 'express';

export default (tokenTracker: any) => { // TODO: type this
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const allStats = tokenTracker.getAllStats();
    const totalStats = tokenTracker.getTotalStats();
    res.json({
      sessions: allStats,
      total: totalStats
    });
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
