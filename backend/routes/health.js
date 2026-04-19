const express = require('express');
const router = express.Router();

const ClaudeCodeAgent = require('../agents/claude-code');
const ClaudeApiAgent = require('../agents/claude-api');
const OpenCodeAgent = require('../agents/opencode');
const CodexAgent = require('../agents/codex');

module.exports = () => {
  router.get('/', async (req, res) => {
    const results = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      agents: {
        'claude-code': { ok: true },
        'claude-api': { ok: true },
        'opencode': { ok: true },
        'codex': { ok: true }
      }
    };

    try {
      const checks = await Promise.all([
        (async () => (ClaudeCodeAgent.healthCheck ? ClaudeCodeAgent.healthCheck() : { ok: true }))(),
        (async () => (ClaudeApiAgent.healthCheck ? ClaudeApiAgent.healthCheck() : { ok: true }))(),
        (async () => (OpenCodeAgent.healthCheck ? OpenCodeAgent.healthCheck() : { ok: true }))(),
        (async () => (CodexAgent.healthCheck ? CodexAgent.healthCheck() : { ok: true }))()
      ]);
      results.agents['claude-code'].ok = checks[0]?.ok !== undefined ? checks[0].ok : true;
      results.agents['claude-api'].ok = checks[1]?.ok !== undefined ? checks[1].ok : true;
      results.agents['opencode'].ok = checks[2]?.ok !== undefined ? checks[2].ok : true;
      results.agents['codex'].ok = checks[3]?.ok !== undefined ? checks[3].ok : true;
    } catch (e) {
      results.status = 'degraded';
      results.error = e?.message || 'unknown';
    }

    res.json(results);
  });

  return router;
};