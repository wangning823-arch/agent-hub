import { Router, Request, Response } from 'express';

export default (sessionManager: any) => { // TODO: type this
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const userId = req.user?.role === 'admin' ? undefined : req.user?.userId;
      const tags = sessionManager.getAllTags(userId);
      res.json({ tags });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id/tags', (req: Request, res: Response) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        return res.status(400).json({ error: 'tags必须是数组' });
      }
      const session = sessionManager.setSessionTags(req.params.id, tags);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/tags', (req: Request, res: Response) => {
    try {
      const { tag } = req.body;
      if (!tag) {
        return res.status(400).json({ error: 'tag是必需的' });
      }
      const session = sessionManager.addSessionTag(req.params.id, tag);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id/tags/:tag', (req: Request, res: Response) => {
    try {
      const session = sessionManager.removeSessionTag(req.params.id, req.params.tag);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/filter/:tag', (req: Request, res: Response) => {
    try {
      const userId = req.user?.role === 'admin' ? undefined : req.user?.userId;
      const sessions = sessionManager.getSessionsByTag(req.params.tag, userId);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
