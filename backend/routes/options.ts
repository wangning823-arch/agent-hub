import { Router, Request, Response } from 'express';
import { getDb } from '../db';
const { PERMISSION_MODES, MODELS, EFFORT_LEVELS, getModesForAgent, getModelsForAgent, getEffortsForAgent, getCommandsForAgent } = require('../commands');

export default () => {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const agentType = (req.query.agentType as string) || 'claude-code';
    const workdir = (req.query.workdir as string) || '';
    console.log('[options] agentType:', agentType, 'workdir:', workdir || '(global)');
    let models = getModelsForAgent(agentType, workdir);

    // 按用户权限过滤模型（admin 看所有）
    if (req.user && req.user.role !== 'admin') {
      const db = getDb();
      const uid = req.user.userId.replace(/'/g, "''");

      // 获取被分配的系统 Provider IDs
      const assignedResult = db.exec(`SELECT provider_id FROM user_providers WHERE user_id = '${uid}'`);
      const assignedPids = new Set<string>();
      if (assignedResult.length > 0) {
        assignedResult[0].values.forEach((row: any[]) => assignedPids.add(row[0] as string));
      }

      // 获取个人 Provider IDs
      const personalResult = db.exec(`SELECT id FROM providers WHERE owner_id = '${uid}'`);
      const personalPids = new Set<string>();
      if (personalResult.length > 0) {
        personalResult[0].values.forEach((row: any[]) => personalPids.add(row[0] as string));
      }

      // 合并所有可用 Provider IDs
      const allPids = new Set([...assignedPids, ...personalPids]);

      if (allPids.size === 0) {
        models = [];
      } else {
        // 获取这些 Provider 下所有 Model IDs
        const pidList = [...allPids].map(id => `'${id.replace(/'/g, "''")}'`).join(',');
        const modelsResult = db.exec(`SELECT id FROM models WHERE provider_id IN (${pidList})`);
        const allowedModelIds = new Set<string>();
        if (modelsResult.length > 0) {
          modelsResult[0].values.forEach((row: any[]) => allowedModelIds.add(row[0] as string));
        }

        models = models.filter((m: any) => {
          // 对于 opencode，model ID 格式是 "provider/model"
          if (agentType === 'opencode') {
            const parts = m.id.split('/');
            return allPids.has(parts[0]) || allowedModelIds.has(m.id);
          }
          return allowedModelIds.has(m.id);
        });
      }
    }

    console.log('[options] models count:', models.length);
    res.json({
      modes: getModesForAgent(agentType),
      models,
      efforts: getEffortsForAgent(agentType)
    });
  });

  // 获取当前用户的模型概览（只读）
  router.get('/my-models', (req: Request, res: Response) => {
    const db = getDb();
    const uid = req.user!.userId.replace(/'/g, "''");

    let providers: any[] = [];

    if (req.user!.role === 'admin') {
      // Admin 看所有系统 Provider
      const result = db.exec('SELECT id, name FROM providers WHERE owner_id IS NULL ORDER BY name');
      if (result.length > 0) {
        providers = result[0].values.map((row: any[]) => ({ id: row[0], name: row[1], isPersonal: false }));
      }
    } else {
      // 被分配的系统 Provider
      const assignedResult = db.exec(
        `SELECT p.id, p.name FROM providers p JOIN user_providers up ON p.id = up.provider_id WHERE up.user_id = '${uid}' ORDER BY p.name`
      );
      if (assignedResult.length > 0) {
        providers = assignedResult[0].values.map((row: any[]) => ({ id: row[0], name: row[1], isPersonal: false }));
      }

      // 个人 Provider
      const personalResult = db.exec(`SELECT id, name FROM providers WHERE owner_id = '${uid}' ORDER BY name`);
      if (personalResult.length > 0) {
        providers = providers.concat(
          personalResult[0].values.map((row: any[]) => ({ id: row[0], name: row[1], isPersonal: true }))
        );
      }
    }

    // 附加每个 Provider 的 model 数量
    for (const p of providers) {
      const countResult = db.exec(`SELECT COUNT(*) FROM models WHERE provider_id = '${p.id.replace(/'/g, "''")}'`);
      p.modelCount = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;
    }

    res.json({ providers });
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
