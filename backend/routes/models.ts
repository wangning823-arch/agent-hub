import { Router, Request, Response } from 'express';
import { getDb, saveToFile } from '../db';
import path from 'path';
import fs from 'fs';

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups', 'sync');

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getBackupPath(tool: string): string {
  ensureBackupDir();
  return path.join(BACKUP_DIR, `${tool}.json`);
}

function backupConfig(tool: string, filePath: string, content: string): void {
  ensureBackupDir();
  const backupPath = getBackupPath(tool);
  const existing: Record<string, any> = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, 'utf-8')) : {}; // TODO: type this
  existing[filePath] = {
    content,
    backedUpAt: new Date().toISOString()
  };
  fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2));
}

function readBackup(tool: string): Record<string, any> | null { // TODO: type this
  const backupPath = getBackupPath(tool);
  if (!fs.existsSync(backupPath)) return null;
  return JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
}

function getConfigPaths(tool: string): string[] {
  const homeDir = process.env.HOME || '/root';
  switch (tool) {
    case 'claude-code':
      return [path.join(homeDir, '.claude', 'settings.json')];
    case 'opencode':
      return [path.join(homeDir, '.config', 'opencode', 'opencode.json')];
    case 'codex': {
      const codexHome = process.env.CODEX_HOME || path.join(homeDir, '.codex');
      return [path.join(codexHome, 'config.toml')];
    }
    default:
      return [];
  }
}

export default () => {
  const router = Router();

  // ── Provider CRUD ──

  router.get('/providers', (_req: Request, res: Response) => {
    const db = getDb();
    const result = db.exec('SELECT id, name, npm_package, base_url, base_url_anthropic, api_key, created_at, updated_at FROM providers ORDER BY created_at');
    const providers: any[] = result.length > 0 ? result[0].values.map((row: any[]) => ({ // TODO: type this
      id: row[0], name: row[1], npmPackage: row[2], baseUrl: row[3],
      baseUrlAnthropic: row[4], hasApiKey: !!row[5], createdAt: row[6], updatedAt: row[7]
    })) : [];

    const countResult = db.exec('SELECT provider_id, COUNT(*) as cnt FROM models GROUP BY provider_id');
    const modelCounts: Record<string, number> = {}; // TODO: type this
    if (countResult.length > 0) {
      countResult[0].values.forEach((row: any[]) => { modelCounts[row[0]] = row[1]; }); // TODO: type this
    }
    providers.forEach((p: any) => { p.modelCount = modelCounts[p.id] || 0; }); // TODO: type this

    res.json({ providers });
  });

  router.post('/providers', (req: Request, res: Response) => {
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
      res.json({ success: true, provider: { id, name, npmPackage, baseUrl, baseUrlAnthropic, hasApiKey: !!apiKey, createdAt: now, updatedAt: now } });
    } catch (e: any) {
      res.status(400).json({ error: 'Provider 已存在: ' + e.message });
    }
  });

  router.put('/providers/:id', (req: Request, res: Response) => {
    const { name, npmPackage, baseUrl, baseUrlAnthropic, apiKey } = req.body;
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.exec(`SELECT api_key FROM providers WHERE id = '${req.params.id.replace(/'/g, "''")}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });

    const oldApiKey = existing[0].values[0][0];
    const newApiKey = apiKey !== undefined && apiKey !== '' ? apiKey : oldApiKey;

    try {
      const stmt = db.prepare('UPDATE providers SET name=?, npm_package=?, base_url=?, base_url_anthropic=?, api_key=?, updated_at=? WHERE id=?');
      stmt.run([name || '', npmPackage || '', baseUrl || '', baseUrlAnthropic || '', newApiKey, now, req.params.id]);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/providers/:id', (req: Request, res: Response) => {
    const db = getDb();
    try {
      db.run(`DELETE FROM models WHERE provider_id = '${req.params.id.replace(/'/g, "''")}'`);
      db.run(`DELETE FROM providers WHERE id = '${req.params.id.replace(/'/g, "''")}'`);
      db.run(`DELETE FROM tool_sync WHERE provider_id = '${req.params.id.replace(/'/g, "''")}'`);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Model CRUD ──

  router.get('/providers/:providerId/models', (req: Request, res: Response) => {
    const db = getDb();
    const pid = req.params.providerId.replace(/'/g, "''");
    const result = db.exec(`SELECT id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities FROM models WHERE provider_id = '${pid}' ORDER BY name`);
    const models: any[] = result.length > 0 ? result[0].values.map((row: any[]) => ({ // TODO: type this
      id: row[0], providerId: row[1], name: row[2], contextLimit: row[3],
      outputLimit: row[4], inputModalities: JSON.parse(row[5]), outputModalities: JSON.parse(row[6])
    })) : [];
    res.json({ models });
  });

  router.post('/providers/:providerId/models', (req: Request, res: Response) => {
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
    } catch (e: any) {
      res.status(400).json({ error: '模型已存在: ' + e.message });
    }
  });

  router.put('/providers/:providerId/models/:modelId', (req: Request, res: Response) => {
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
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/providers/:providerId/models/:modelId', (req: Request, res: Response) => {
    const db = getDb();
    try {
      db.run(`DELETE FROM models WHERE id = '${req.params.modelId.replace(/'/g, "''")}' AND provider_id = '${req.params.providerId.replace(/'/g, "''")}'`);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Sync Status ──

  router.get('/sync/status', (_req: Request, res: Response) => {
    const db = getDb();
    const result = db.exec('SELECT tool, provider_id, model_id, synced_at, config FROM tool_sync');
    const status: Record<string, any> = {}; // TODO: type this
    if (result.length > 0) {
      result[0].values.forEach((row: any[]) => { // TODO: type this
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

  router.put('/sync/status', (req: Request, res: Response) => {
    const { tool, providerId, modelId, config } = req.body;
    if (!tool) return res.status(400).json({ error: 'tool 必填' });
    const db = getDb();
    const now = new Date().toISOString();
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)');
      stmt.run([tool, providerId || '', modelId || '', now, JSON.stringify(config || {})]);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Sync to CLI config files ──

  router.post('/sync/claude-code', (req: Request, res: Response) => {
    const { providerId, modelConfig, workdir: projectWorkdir } = req.body;
    if (!providerId) return res.status(400).json({ error: 'providerId 必填' });

    const db = getDb();
    const result = db.exec(`SELECT base_url, base_url_anthropic, api_key FROM providers WHERE id = '${providerId.replace(/'/g, "''")}'`);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Provider 不存在' });
    }

    const [baseUrl, baseUrlAnthropic, apiKey] = result[0].values[0];
    if (!baseUrlAnthropic) {
      return res.status(400).json({ error: '该 Provider 未设置 Base URL (Anthropic 协议)，无法同步到 Claude Code' });
    }
    const anthropicUrl = baseUrlAnthropic;

    // 确定配置文件路径：有 workdir 则写入项目目录，否则写入全局配置
    let settingsPath: string;
    if (projectWorkdir) {
      // 解析相对路径为绝对路径
      const resolvedWorkdir = path.isAbsolute(projectWorkdir)
        ? projectWorkdir
        : path.resolve(process.env.HOME || '/root', projectWorkdir);
      settingsPath = path.join(resolvedWorkdir, '.claude', 'settings.json');
      // 确保 .claude 目录存在
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
      // 将 .claude/ 添加到项目的 .gitignore
      try {
        const gitignorePath = path.join(resolvedWorkdir, '.gitignore');
        const gitignoreEntry = '.claude/';
        let gitignoreContent = '';
        if (fs.existsSync(gitignorePath)) {
          gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
        }
        if (!gitignoreContent.split('\n').some(line => line.trim() === gitignoreEntry)) {
          const suffix = gitignoreContent.endsWith('\n') ? '' : '\n';
          fs.writeFileSync(gitignorePath, gitignoreContent + suffix + gitignoreEntry + '\n');
        }
      } catch (e: any) {
        console.warn('更新 .gitignore 失败:', e.message);
      }
    }
    if (!settingsPath!) {
      const homeDir = process.env.HOME || '/root';
      settingsPath = path.join(homeDir, '.claude', 'settings.json');
    }

    let settings: any = {}; // TODO: type this
    try {
      if (fs.existsSync(settingsPath)) {
        const originalContent = fs.readFileSync(settingsPath, 'utf-8');
        backupConfig('claude-code', settingsPath, originalContent);
        settings = JSON.parse(originalContent);
      } else {
        backupConfig('claude-code', settingsPath, '');
      }
    } catch (e: any) {
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
      console.log(`[sync/claude-code] 写入配置到: ${settingsPath}`);
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      const now = new Date().toISOString();
      const syncConfig = { ...modelConfig || {}, workdir: projectWorkdir || null };
      const syncStmt = db.prepare('INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)');
      syncStmt.run(['claude-code', providerId, modelConfig?.model || '', now, JSON.stringify(syncConfig)]);
      saveToFile();
      const msg = projectWorkdir ? `Claude Code 配置已同步到项目: ${settingsPath}` : 'Claude Code 全局配置已同步';
      res.json({ success: true, message: msg, backedUp: true, settingsPath });
    } catch (e: any) {
      res.status(500).json({ error: '写入 Claude 配置失败: ' + e.message });
    }
  });

  router.post('/sync/opencode', (req: Request, res: Response) => {
    const { providerIds, defaultModel, smallModel } = req.body;
    const db = getDb();

    const homeDir = process.env.HOME || '/root';
    const configPath = path.join(homeDir, '.config', 'opencode', 'opencode.json');

    let config: any = {}; // TODO: type this
    try {
      if (fs.existsSync(configPath)) {
        const originalContent = fs.readFileSync(configPath, 'utf-8');
        backupConfig('opencode', configPath, originalContent);
        config = JSON.parse(originalContent);
      } else {
        backupConfig('opencode', configPath, '');
      }
    } catch (e: any) {
      return res.status(500).json({ error: '读取 OpenCode 配置失败: ' + e.message });
    }

    const allProviderIds: string[] = providerIds || [];
    const providerSection: Record<string, any> = {}; // TODO: type this
    const pidList = allProviderIds.map(id => id.replace(/'/g, "''"));

    for (const pid of allProviderIds) {
      const pResult = db.exec(`SELECT name, npm_package, base_url, api_key FROM providers WHERE id = '${pid.replace(/'/g, "''")}'`);
      if (pResult.length === 0 || pResult[0].values.length === 0) continue;

      const [pName, npmPkg, baseUrl, apiKey] = pResult[0].values[0];
      const mResult = db.exec(`SELECT id, name, context_limit, output_limit, input_modalities, output_modalities FROM models WHERE provider_id = '${pid.replace(/'/g, "''")}'`);

      const models: Record<string, any> = {}; // TODO: type this
      if (mResult.length > 0) {
        mResult[0].values.forEach((row: any[]) => { // TODO: type this
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
      res.json({ success: true, message: 'OpenCode 配置已同步', backedUp: true });
    } catch (e: any) {
      res.status(500).json({ error: '写入 OpenCode 配置失败: ' + e.message });
    }
  });

  router.post('/sync/codex', (req: Request, res: Response) => {
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
        backupConfig('codex', configPath, tomlContent);
      } else {
        backupConfig('codex', configPath, '');
      }

      const lines = tomlContent.split('\n');
      const newLines: string[] = [];
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
      res.json({ success: true, message: 'Codex 配置已同步', backedUp: true });
    } catch (e: any) {
      res.status(500).json({ error: '写入 Codex 配置失败: ' + e.message });
    }
  });

  // ── Backup info & Undo sync ──

  router.get('/sync/backups', (_req: Request, res: Response) => {
    const backups: Record<string, any> = {}; // TODO: type this
    for (const tool of ['claude-code', 'opencode', 'codex']) {
      const backup = readBackup(tool);
      if (backup) {
        backups[tool] = {};
        for (const [filePath, info] of Object.entries(backup)) {
          backups[tool][filePath] = {
            backedUpAt: info.backedUpAt,
            hasContent: info.content !== ''
          };
        }
      }
    }
    res.json({ backups });
  });

  router.get('/sync/backups/:tool', (req: Request, res: Response) => {
    const tool = req.params.tool;
    if (!['claude-code', 'opencode', 'codex'].includes(tool)) {
      return res.status(400).json({ error: '无效的工具名称' });
    }
    const backup = readBackup(tool);
    if (!backup) {
      return res.json({ backup: null });
    }
    res.json({ backup });
  });

  router.post('/sync/undo/:tool', (req: Request, res: Response) => {
    const tool = req.params.tool;
    if (!['claude-code', 'opencode', 'codex'].includes(tool)) {
      return res.status(400).json({ error: '无效的工具名称' });
    }

    const { workdir: undoWorkdir } = req.body || {};

    const backup = readBackup(tool);
    if (!backup) {
      return res.status(404).json({ error: '没有找到备份，无法撤销' });
    }

    // 按 workdir 过滤：有 workdir 时只恢复对应项目的备份，无 workdir 时只恢复全局备份
    let filteredBackup = backup;
    if (tool === 'claude-code' && undoWorkdir !== undefined) {
      const resolvedWorkdir = path.isAbsolute(undoWorkdir)
        ? undoWorkdir
        : path.resolve(process.env.HOME || '/root', undoWorkdir);
      const projectPrefix = path.join(resolvedWorkdir, '.claude');
      const globalSettingsPath = path.join(process.env.HOME || '/root', '.claude', 'settings.json');

      filteredBackup = {};
      for (const [filePath, info] of Object.entries(backup)) {
        if (undoWorkdir === '') {
          // 撤销全局：只恢复全局配置文件
          if (filePath === globalSettingsPath) {
            filteredBackup[filePath] = info;
          }
        } else {
          // 撤销项目：只恢复该项目目录下的配置文件
          if (filePath.startsWith(projectPrefix)) {
            filteredBackup[filePath] = info;
          }
        }
      }
    }

    if (Object.keys(filteredBackup).length === 0) {
      return res.status(404).json({ error: '没有找到对应项目的备份，无法撤销' });
    }

    const restored: string[] = [];
    const errors: Array<{ file: string; error: string }> = [];
    for (const [filePath, info] of Object.entries(filteredBackup)) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (info.content === '') {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          restored.push(filePath);
        } else {
          fs.writeFileSync(filePath, info.content);
          restored.push(filePath);
        }
      } catch (e: any) {
        errors.push({ file: filePath, error: e.message });
      }
    }

    if (errors.length > 0 && restored.length === 0) {
      return res.status(500).json({ error: '撤销同步失败', errors });
    }

    // 从备份中移除已恢复的条目
    const backupPath = getBackupPath(tool);
    const remainingBackup = { ...backup };
    for (const filePath of restored) {
      delete remainingBackup[filePath];
    }

    if (Object.keys(remainingBackup).length === 0) {
      // 没有剩余备份，删除整个备份文件和 sync 记录
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      const db = getDb();
      try {
        db.run(`DELETE FROM tool_sync WHERE tool = '${tool.replace(/'/g, "''")}'`);
        saveToFile();
      } catch {}
    } else {
      // 还有其他项目的备份，只更新备份文件
      fs.writeFileSync(backupPath, JSON.stringify(remainingBackup, null, 2));
    }

    res.json({
      success: true,
      message: `${tool} 同步已撤销，配置已恢复`,
      restored,
      errors: errors.length > 0 ? errors : undefined
    });
  });

  // ── Refresh model cache ──

  router.post('/refresh-cache', (_req: Request, res: Response) => {
    try {
      const commands = require('../commands');
      if (typeof commands.clearModelCache === 'function') {
        commands.clearModelCache();
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
