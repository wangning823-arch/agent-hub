import { Router, Request, Response } from 'express';

export default (permissionManager: any) => { // TODO: type this
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(permissionManager.getAllPermissions());
  });

  router.put('/', (req: Request, res: Response) => {
    const { action, policy } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'action是必需的' });
    }
    permissionManager.updatePermission(action, policy);
    res.json({ success: true });
  });

  router.post('/check', (req: Request, res: Response) => {
    const { action, details } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'action是必需的' });
    }
    const decision = permissionManager.checkPermission(action, details);
    res.json({ decision });
  });

  return router;
};
