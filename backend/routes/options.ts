import { Router, Request, Response } from 'express';
const { PERMISSION_MODES, MODELS, EFFORT_LEVELS, getModesForAgent, getModelsForAgent, getEffortsForAgent, getCommandsForAgent } = require('../commands');

export default () => {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const agentType = (req.query.agentType as string) || 'claude-code';
    const workdir = (req.query.workdir as string) || '';
    console.log('[options] agentType:', agentType, 'workdir:', workdir || '(global)');
    const models = getModelsForAgent(agentType, workdir);
    console.log('[options] models count:', models.length);
    res.json({
      modes: getModesForAgent(agentType),
      models,
      efforts: getEffortsForAgent(agentType)
    });
  });

  router.get('/modes', (_req: Request, res: Response) => {
    res.json({ modes: PERMISSION_MODES });
  });

  router.get('/models', (_req: Request, res: Response) => {
    res.json({ models: MODELS });
  });

  router.get('/efforts', (_req: Request, res: Response) => {
    res.json({ efforts: EFFORT_LEVELS });
  });

  router.get('/commands', (req: Request, res: Response) => {
    const agentType = (req.query.agentType as string) || 'claude-code';
    res.json({ commands: getCommandsForAgent(agentType) });
  });

  return router;
};
