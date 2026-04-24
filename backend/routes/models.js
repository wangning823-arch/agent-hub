const express = require('express');
const router = express.Router();
const { getDb, saveToFile } = require('../db');
const path = require('path');
const fs = require('fs');

module.exports = () => {
  // ── Provider CRUD ──

  router.get('/providers', (req, res) => {
    const db = getDb();
    const result = db.exec('SELECT * FROM providers ORDER BY created_at');
    const providers = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], name: row[1], npmPackage: row[2], baseUrl: row[3],
      baseUrlAnthropic: row[4], apiKey: maskKey(row[5]), createdAt: row[6], updatedAt: row[7]
    })) : [];

    const countResult = db.exec('SELECT provider_id, COUNT(*) as cnt FROM models GROUP BY provider_id');
    const modelCounts = {};
    if (countResult.length > 0) {
      countResult[0].values.forEach(row => { modelCounts[row[0]] = row[1]; });
    }
    providers.forEach(p => { p.modelCount = modelCounts[p.id] || 0; });

    res.json({ providers });
  });

  router.post('/providers', (req, res) => {
    const { id, name, npmPackage, baseUrl, baseUrlAnthropic, apiKey } = req.body;
    if (!id || !name || !baseUrl) {
      return res.status(400).json({ error: 'id, name, baseUrl 必填' });
    }
    const db = getDb();
    const now = new Date().toISOString();
    try {
      const stmt = db.prepare('INSERT INTO providers (id, name, npm_package, base_url, base_url_anthropic, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      stmt.run([id, name, npmPackage || '', baseUrl, baseUrlAnthropic || '', apiKey || '', now, now]);
      saveToFile();
      res.json({ success: true, provider: { id, name, npmPackage, baseUrl, baseUrlAnthropic, apiKey: maskKey(apiKey), createdAt: now, updatedAt: now } });
    } catch (e) {
      res.status(400).json({ error: 'Provider 已存在: ' + e.message });
    }
  });

  router.put('/providers/:id', (req, res) => {
    const { name, npmPackage, baseUrl, baseUrlAnthropic, apiKey } = req.body;
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.exec(`SELECT api_key FROM providers WHERE id = '${req.params.id.replace(/'/g, "''")}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });

    const oldApiKey = existing[0].values[0][0];
    const newApiKey = apiKey && !apiKey.includes('***') ? apiKey : oldApiKey;

    try {
      const stmt = db.prepare('UPDATE providers SET name=?, npm_package=?, base_url=?, base_url_anthropic=?, api_key=?, updated_at=? WHERE id=?');
      stmt.run([name || '', npmPackage || '', baseUrl || '', baseUrlAnthropic || '', newApiKey, now, req.params.id]);
      saveToFile();
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/providers/:id', (req, res) => {
    const db = getDb();
    try {
      db.run(`DELETE FROM models WHERE provider_id = '${req.params.id.replace(/'/g, "''")}'`);
      db.run(`DELETE FROM providers WHERE id = '${req.params.id.replace(/'/g, "''")}'`);
      db.run(`DELETE FROM tool_sync WHERE provider_id = '${req.params.id.replace(/'/g, "''")}'`);
      saveToFile();
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Model CRUD ──

  router.get('/providers/:providerId/models', (req, res) => {
    const db = getDb();
    const pid = req.params.providerId.replace(/'/g, "''");
    const result = db.exec(`SELECT id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities FROM models WHERE provider_id = '${pid}' ORDER BY name`);
    const models = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], providerId: row[1], name: row[2], contextLimit: row[3],
      outputLimit: row[4], inputModalities: JSON.parse(row[5]), outputModalities: JSON.parse(row[6])
    })) : [];
    res.json({ models });
  });

  router.post('/providers/:providerId/models', (req, res) => {
    const { id, name, contextLimit, outputLimit, inputModalities, outputModalities } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id, name 必填' });
    const db = getDb();
    try {
      const stmt = db.prepare(
        'INSERT INTO models (id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      stmt.run([
        id, req.params.providerId, name,
        contextLimit || 0, outputLimit || 0,
        JSON.stringify(inputModalities || ['text']),
        JSON.stringify(outputModalities || ['text'])
      ]);
      saveToFile();
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: '模型已存在: ' + e.message });
    }
  });

  router.put('/providers/:providerId/models/:modelId', (req, res) => {
    const { name, contextLimit, outputLimit, inputModalities, outputModalities } = req.body;
    const db = getDb();
    try {
      const stmt = db.prepare(
        'UPDATE models SET name=?, context_limit=?, output_limit=?, input_modalities=?, output_modalities=? WHERE id=? AND provider_id=?'
      );
      stmt.run([
        name || '', contextLimit || 0, outputLimit || 0,
        JSON.stringify(inputModalities || ['text']),
        JSON.stringify(outputModalities || ['text']),
        req.params.modelId, req.params.providerId
      ]);
      saveToFile();
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/providers/:providerId/models/:modelId', (req, res) => {
    const db = getDb();
    try {
      db.run(`DELETE FROM models WHERE id = '${req.params.modelId.replace(/'/g, "''")}' AND provider_id = '${req.params.providerId.replace(/'/g, "''")}'`);
      saveToFile();
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Sync Status ──

  router.get('/sync/status', (req, res) => {
    const db = getDb();
    const result = db.exec('SELECT tool, provider_id, model_id, synced_at, config FROM tool_sync');
    const status = {};
    if (result.length > 0) {
      result[0].values.forEach(row => {
        status[row[0]] = {
          providerId: row[1],
          modelId: row[2],
          syncedAt: row[3],
          config: JSON.parse(row[4] || '{}')
        };
      });
    }
    res.json({ status });
  });

  router.put('/sync/status', (req, res) => {
    const { tool, providerId, modelId, config } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool 必填' });
    const db = getDb();
    const now = new Date().toISOString();
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)');
      stmt.run([tool, providerId || '', modelId || '', now, JSON.stringify(config || {})]);
      saveToFile();
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Sync to CLI config files ──

  router.post('/sync/claude-code', (req, res) => {
    const { providerId, modelConfig } = req.body;
    if (!providerId) return res.status(400).json({ error: 'providerId 必填' });

    const db = getDb();
    const result = db.exec(`SELECT base_url, base_url_anthropic, api_key FROM providers WHERE id = '${providerId.replace(/'/g, "''")}'`);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Provider 不存在' });
    }

    const [baseUrl, baseUrlAnthropic, apiKey] = result[0].values[0];
    const anthropicUrl = baseUrlAnthropic || baseUrl;
    const homeDir = process.env.HOME || '/root';
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');

    let settings = {};
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch (e) {
      return res.status(500).json({ error: '读取 Claude 配置失败: ' + e.message });
    }

    settings.env = settings.env || {};
    settings.env.ANTHROPIC_BASE_URL = anthropicUrl;
    if (apiKey) settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    if (modelConfig?.model) settings.env.ANTHROPIC_MODEL = modelConfig.model;
    if (modelConfig?.sonnetModel) settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = modelConfig.sonnetModel;
    if (modelConfig?.opusModel) settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = modelConfig.opusModel;
    if (modelConfig?.haikuModel) settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelConfig.haikuModel;

    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      const now = new Date().toISOString();
      const syncStmt = db.prepare('INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)');
      syncStmt.run(['claude-code', providerId, modelConfig?.model || '', now, JSON.stringify(modelConfig || {})]);
      saveToFile();
      res.json({ success: true, message: 'Claude Code 配置已同步' });
    } catch (e) {
      res.status(500).json({ error: '写入 Claude 配置失败: ' + e.message });
    }
  });

  router.post('/sync/opencode', (req, res) => {
    const { providerIds, defaultModel, smallModel } = req.body;
    const db = getDb();

    const homeDir = process.env.HOME || '/root';
    const configPath = path.join(homeDir, '.config', 'opencode', 'opencode.json');

    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (e) {
      return res.status(500).json({ error: '读取 OpenCode 配置失败: ' + e.message });
    }

    const allProviderIds = providerIds || [];
    const providerSection = {};
    const pidList = allProviderIds.map(id => id.replace(/'/g, "''"));

    for (const pid of allProviderIds) {
      const pResult = db.exec(`SELECT name, npm_package, base_url, api_key FROM providers WHERE id = '${pid.replace(/'/g, "''")}'`);
      if (pResult.length === 0 || pResult[0].values.length === 0) continue;

      const [pName, npmPkg, baseUrl, apiKey] = pResult[0].values[0];
      const mResult = db.exec(`SELECT id, name, context_limit, output_limit, input_modalities, output_modalities FROM models WHERE provider_id = '${pid.replace(/'/g, "''")}'`);

      const models = {};
      if (mResult.length > 0) {
        mResult[0].values.forEach(row => {
          models[row[0]] = {
            name: row[1],
            limit: { context: row[2], output: row[3] },
            modalities: { input: JSON.parse(row[4]), output: JSON.parse(row[5]) }
          };
        });
      }

      providerSection[pid] = {
        npm: npmPkg || undefined,
        name: pName,
        options: { baseURL: baseUrl, apiKey: apiKey },
        models
      };
      if (!npmPkg) delete providerSection[pid].npm;
    }

    config.provider = providerSection;
    if (defaultModel) config.model = defaultModel;
    if (smallModel) config.small_model = smallModel;

    try {
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      const now = new Date().toISOString();
      const syncStmt = db.prepare('INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)');
      syncStmt.run(['opencode', allProviderIds.join(','), defaultModel || '', now, JSON.stringify({ providerIds: allProviderIds, defaultModel, smallModel })]);
      saveToFile();
      res.json({ success: true, message: 'OpenCode 配置已同步' });
    } catch (e) {
      res.status(500).json({ error: '写入 OpenCode 配置失败: ' + e.message });
    }
  });

  router.post('/sync/codex', (req, res) => {
    const { providerId, modelId } = req.body;
    if (!providerId || !modelId) return res.status(400).json({ error: 'providerId, modelId 必填' });

    const db = getDb();
    const pResult = db.exec(`SELECT base_url, api_key FROM providers WHERE id = '${providerId.replace(/'/g, "''")}'`);
    if (pResult.length === 0 || pResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Provider 不存在' });
    }

    const [baseUrl, apiKey] = pResult[0].values[0];
    const homeDir = process.env.HOME || '/root';
    const codexHome = process.env.CODEX_HOME || path.join(homeDir, '.codex');
    const configPath = path.join(codexHome, 'config.toml');

    try {
      const codexDir = path.dirname(configPath);
      if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });

      let tomlContent = '';
      if (fs.existsSync(configPath)) {
        tomlContent = fs.readFileSync(configPath, 'utf-8');
      }

      const lines = tomlContent.split('\n');
      const newLines = [];
      let foundModel = false;
      let foundProvider = false;

      for (const line of lines) {
        if (line.match(/^model\s*=/)) {
          newLines.push(`model = "${modelId}"`);
          foundModel = true;
        } else if (line.match(/^model_provider\s*=/)) {
          newLines.push(`model_provider = "${providerId}"`);
          foundProvider = true;
        } else {
          newLines.push(line);
        }
      }

      if (!foundModel) newLines.push(`model = "${modelId}"`);
      if (!foundProvider) newLines.push(`model_provider = "${providerId}"`);

      fs.writeFileSync(configPath, newLines.join('\n'));

      const now = new Date().toISOString();
      const syncStmt = db.prepare('INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)');
      syncStmt.run(['codex', providerId, modelId, now, '{}']);
      saveToFile();
      res.json({ success: true, message: 'Codex 配置已同步' });
    } catch (e) {
      res.status(500).json({ error: '写入 Codex 配置失败: ' + e.message });
    }
  });

  // ── Refresh model cache ──

  router.post('/refresh-cache', (req, res) => {
    try {
      const commands = require('../commands');
      if (typeof commands.clearModelCache === 'function') {
        commands.clearModelCache();
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 12) return key.slice(0, 4) + '***';
  return key.slice(0, 8) + '***' + key.slice(-4);
}
