import { Router, Request, Response } from 'express';

const ClaudeCodeAgent = require('../agents/claude-code').default;
const OpenCodeAgent = require('../agents/opencode').default;
const CodexAgent = require('../agents/codex').default;

export default () => {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    const results: any = { // TODO: type this
      status: 'ok',
      timestamp: new Date().toISOString(),
      agents: {
        'claude-code': { ok: true },
        'opencode': { ok: true },
        'codex': { ok: true }
      }
    };

    try {
      const checks = await Promise.all([
        (async () => (ClaudeCodeAgent.healthCheck ? ClaudeCodeAgent.healthCheck() : { ok: true }))(),
        (async () => (OpenCodeAgent.healthCheck ? OpenCodeAgent.healthCheck() : { ok: true }))(),
        (async () => (CodexAgent.healthCheck ? CodexAgent.healthCheck() : { ok: true }))()
      ]);
      results.agents['claude-code'].ok = checks[0]?.ok !== undefined ? checks[0].ok : true;
      results.agents['opencode'].ok = checks[1]?.ok !== undefined ? checks[1].ok : true;
      results.agents['codex'].ok = checks[2]?.ok !== undefined ? checks[2].ok : true;
    } catch (e: any) {
      results.status = 'degraded';
      results.error = e?.message || 'unknown';
    }

    res.json(results);
  });

  return router;
};
