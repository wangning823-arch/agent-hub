const express = require('express');
const router = express.Router();
const { PERMISSION_MODES, MODELS, EFFORT_LEVELS, getModesForAgent, getModelsForAgent, getEffortsForAgent, getCommandsForAgent } = require('../commands');

module.exports = () => {
  router.get('/', (req, res) => {
    const agentType = req.query.agentType || 'claude-code';
    const workdir = req.query.workdir || '';
    console.log('[options] agentType:', agentType, 'workdir:', workdir || '(global)');
    const models = getModelsForAgent(agentType, workdir);
    console.log('[options] models count:', models.length);
    res.json({
      modes: getModesForAgent(agentType),
      models,
      efforts: getEffortsForAgent(agentType)
    });
  });

  router.get('/modes', (req, res) => {
    res.json({ modes: PERMISSION_MODES });
  });

  router.get('/models', (req, res) => {
    res.json({ models: MODELS });
  });

  router.get('/efforts', (req, res) => {
    res.json({ efforts: EFFORT_LEVELS });
  });

  router.get('/commands', (req, res) => {
    const agentType = req.query.agentType || 'claude-code';
    res.json({ commands: getCommandsForAgent(agentType) });
  });

  return router;
};