import { Router, Request, Response } from 'express';
import { getDb, saveToFile } from '../db';
import { requireAdmin } from '../middleware/userAuth';
import path from 'path';
import fs from 'fs';

const BACKUP_DIR = path.join(__dirname, '..', '..', '..', 'data', 'backups', 'sync');

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

function getConfigPaths(tool: string, homeOverride?: string): string[] {
  const homeDir = homeOverride || process.env.HOME || '/root';
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

  // 所有 /api/models/* 路由需要管理员权限
  router.use(requireAdmin);

  // ── Provider CRUD（仅系统 Provider，owner_id IS NULL）──

  router.get('/providers', (_req: Request, res: Response) => {
    const db = getDb();
    const result = db.exec('SELECT id, name, npm_package, base_url, base_url_anthropic, api_key, created_at, updated_at FROM providers WHERE owner_id IS NULL ORDER BY created_at');
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
      const stmt = db.prepare('INSERT INTO providers (id, name, npm_package, base_url, base_url_anthropic, api_key, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)');
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
      const pid = req.params.id.replace(/'/g, "''");
      db.run(`DELETE FROM models WHERE provider_id = '${pid}'`);
      db.run(`DELETE FROM providers WHERE id = '${pid}'`);
      db.run(`DELETE FROM tool_sync WHERE provider_id = '${pid}'`);
      db.run(`DELETE FROM user_providers WHERE provider_id = '${pid}'`);
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
    const syncHome = (req.user && req.user.role !== 'admin')
      ? req.user.homeDir
      : (process.env.HOME || '/root');

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
        : path.resolve(syncHome, projectWorkdir);
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
      settingsPath = path.join(syncHome, '.claude', 'settings.json');
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

    const syncHome = (req.user && req.user.role !== 'admin')
      ? req.user.homeDir
      : (process.env.HOME || '/root');
    const configPath = path.join(syncHome, '.config', 'opencode', 'opencode.json');

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
    const syncHome = (req.user && req.user.role !== 'admin')
      ? req.user.homeDir
      : (process.env.HOME || '/root');

    const db = getDb();
    const pResult = db.exec(`SELECT base_url, api_key, name FROM providers WHERE id = '${providerId.replace(/'/g, "''")}'`);
    if (pResult.length === 0 || pResult[0].values.length === 0) {
      return res.status(404).json({ error: 'Provider 不存在' });
    }

    const [baseUrl, apiKey, providerName] = pResult[0].values[0];
    const codexHome = process.env.CODEX_HOME || path.join(syncHome, '.codex');
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
      let foundProviderSection = false;
      const sectionHeader = `[model_providers.${providerId}]`;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.match(/^model\s*=/)) {
          newLines.push(`model = "${modelId}"`);
          foundModel = true;
        } else if (line.match(/^model_provider\s*=/)) {
          newLines.push(`model_provider = "${providerId}"`);
          foundProvider = true;
        } else if (line.trim() === sectionHeader) {
          // 替换整个 [model_providers.xxx] 段落
          newLines.push(sectionHeader);
          newLines.push(`name = "${providerId}"`);
          newLines.push(`env_key = "${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY"`);
          newLines.push(`base_url = "${baseUrl}"`);
          newLines.push(`wire_api = "chat"`);
          foundProviderSection = true;
          // 跳过旧的段落内容（直到下一个 [section] 或文件结束）
          while (i + 1 < lines.length && !lines[i + 1].trim().startsWith('[')) {
            i++;
          }
        } else {
          newLines.push(line);
        }
      }

      if (!foundModel) newLines.push(`model = "${modelId}"`);
      if (!foundProvider) newLines.push(`model_provider = "${providerId}"`);
      if (!foundProviderSection) {
        newLines.push('');
        newLines.push(sectionHeader);
        newLines.push(`name = "${providerId}"`);
        newLines.push(`env_key = "${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY"`);
        newLines.push(`base_url = "${baseUrl}"`);
        newLines.push(`wire_api = "chat"`);
      }

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
      const undoHome = (req.user && req.user.role !== 'admin')
        ? req.user.homeDir
        : (process.env.HOME || '/root');
      const resolvedWorkdir = path.isAbsolute(undoWorkdir)
        ? undoWorkdir
        : path.resolve(undoHome, undoWorkdir);
      const projectPrefix = path.join(resolvedWorkdir, '.claude');
      const globalSettingsPath = path.join(undoHome, '.claude', 'settings.json');

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

  // ── 自动发现模型 ──

  async function discoverModels(baseUrl: string, apiKey: string): Promise<any[]> {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // 构建候选 URL 列表，按优先级尝试
    const candidates: string[] = [];
    if (cleanBase.endsWith('/v1')) {
      candidates.push(cleanBase + '/models');       // /v1/models
      candidates.push(cleanBase.slice(0, -3) + '/models');  // 去掉 /v1 后 + /models
    } else if (cleanBase.endsWith('/v1/')) {
      candidates.push(cleanBase + 'models');
      candidates.push(cleanBase.slice(0, -4) + '/models');
    } else {
      candidates.push(cleanBase + '/v1/models');
      candidates.push(cleanBase + '/models');
    }

    let lastError = '';
    for (const modelsUrl of candidates) {
      let response: globalThis.Response;
      try {
        response = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(15000) });
      } catch (e: any) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
          throw new Error('请求超时，请检查网络或 URL 是否正确');
        }
        lastError = e.message || '网络连接失败';
        continue;
      }
      if (!response.ok) {
        lastError = `请求失败: ${response.status} ${response.statusText} (${modelsUrl})`;
        continue;
      }
      const data = await response.json() as any;

      // OpenAI 格式: { data: [{ id, object, ... }] }
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((m: any) => ({
          id: m.id,
          name: m.id,
          contextLimit: m.context_length || m.context_window || 0,
          outputLimit: m.max_output_tokens || 0,
        }));
      }

      // Anthropic 格式 或其他: 直接是数组
      if (Array.isArray(data)) {
        return data.map((m: any) => ({
          id: typeof m === 'string' ? m : m.id || m.name || String(m),
          name: typeof m === 'string' ? m : m.name || m.id || String(m),
          contextLimit: m.context_length || m.context_window || 0,
          outputLimit: m.max_output_tokens || 0,
        }));
      }

      throw new Error('无法解析模型列表，API 返回格式不支持');
    }

    throw new Error(`无法获取模型列表: ${lastError || '所有候选 URL 均失败'}`);
  }

  router.post('/discover', async (req: Request, res: Response) => {
    const { baseUrl, apiKey } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl 必填' });
    try {
      console.log(`[Discover] Admin 正在发现模型: ${baseUrl}`);
      const models = await discoverModels(baseUrl, apiKey || '');
      console.log(`[Discover] 发现 ${models.length} 个模型`);
      res.json({ models });
    } catch (e: any) {
      console.error(`[Discover] 发现模型失败:`, e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // 通过 Provider ID 自动发现（后端读取 baseUrl 和 apiKey）
  router.post('/providers/:providerId/discover', async (req: Request, res: Response) => {
    const db = getDb();
    const pid = req.params.providerId.replace(/'/g, "''");
    const result = db.exec(`SELECT base_url, api_key FROM providers WHERE id = '${pid}' AND owner_id IS NULL`);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Provider 不存在' });
    }
    const baseUrl = result[0].values[0][0] as string;
    const apiKey = result[0].values[0][1] as string;
    if (!baseUrl) {
      return res.status(400).json({ error: 'Provider 未设置 Base URL' });
    }
    try {
      console.log(`[Discover] Admin 正在发现模型 (provider: ${pid}): ${baseUrl}`);
      const models = await discoverModels(baseUrl, apiKey);
      console.log(`[Discover] 发现 ${models.length} 个模型`);
      res.json({ models });
    } catch (e: any) {
      console.error(`[Discover] 发现模型失败:`, e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // ── 个人 Provider 路由（普通用户管理自己的 Provider）──

  const myModelsRouter = Router();

  myModelsRouter.get('/providers', (req: Request, res: Response) => {
    const db = getDb();
    const userId = req.user!.userId;
    const result = db.exec(
      `SELECT id, name, npm_package, base_url, base_url_anthropic, api_key, created_at, updated_at FROM providers WHERE owner_id = '${userId.replace(/'/g, "''")}' ORDER BY created_at`
    );
    const providers: any[] = result.length > 0 ? result[0].values.map((row: any[]) => ({
      id: row[0], name: row[1], npmPackage: row[2], baseUrl: row[3],
      baseUrlAnthropic: row[4], hasApiKey: !!row[5], createdAt: row[6], updatedAt: row[7]
    })) : [];

    const countResult = db.exec(`SELECT provider_id, COUNT(*) as cnt FROM models WHERE provider_id IN (SELECT id FROM providers WHERE owner_id = '${userId.replace(/'/g, "''")}') GROUP BY provider_id`);
    const modelCounts: Record<string, number> = {};
    if (countResult.length > 0) {
      countResult[0].values.forEach((row: any[]) => { modelCounts[row[0]] = row[1]; });
    }
    providers.forEach((p: any) => { p.modelCount = modelCounts[p.id] || 0; });

    res.json({ providers });
  });

  myModelsRouter.post('/providers', (req: Request, res: Response) => {
    const { id, name, npmPackage, baseUrl, baseUrlAnthropic, apiKey } = req.body;
    if (!id || !name || !baseUrl) {
      return res.status(400).json({ error: 'id, name, baseUrl 必填' });
    }
    const db = getDb();
    const userId = req.user!.userId;
    const now = new Date().toISOString();
    try {
      const stmt = db.prepare('INSERT INTO providers (id, name, npm_package, base_url, base_url_anthropic, api_key, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      stmt.run([id, name, npmPackage || '', baseUrl, baseUrlAnthropic || '', apiKey || '', userId, now, now]);
      saveToFile();
      res.json({ success: true, provider: { id, name, npmPackage, baseUrl, baseUrlAnthropic, hasApiKey: !!apiKey, createdAt: now, updatedAt: now } });
    } catch (e: any) {
      res.status(400).json({ error: 'Provider 已存在: ' + e.message });
    }
  });

  myModelsRouter.put('/providers/:id', (req: Request, res: Response) => {
    const { name, npmPackage, baseUrl, baseUrlAnthropic, apiKey } = req.body;
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.id.replace(/'/g, "''");

    const existing = db.exec(`SELECT api_key, owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    if (existing[0].values[0][1] !== userId) return res.status(403).json({ error: '无权操作此 Provider' });

    const oldApiKey = existing[0].values[0][0];
    const newApiKey = apiKey !== undefined && apiKey !== '' ? apiKey : oldApiKey;
    const now = new Date().toISOString();

    try {
      const stmt = db.prepare('UPDATE providers SET name=?, npm_package=?, base_url=?, base_url_anthropic=?, api_key=?, updated_at=? WHERE id=?');
      stmt.run([name || '', npmPackage || '', baseUrl || '', baseUrlAnthropic || '', newApiKey, now, req.params.id]);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  myModelsRouter.delete('/providers/:id', (req: Request, res: Response) => {
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.id.replace(/'/g, "''");

    const existing = db.exec(`SELECT owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    if (existing[0].values[0][0] !== userId) return res.status(403).json({ error: '无权操作此 Provider' });

    try {
      db.run(`DELETE FROM models WHERE provider_id = '${pid}'`);
      db.run(`DELETE FROM providers WHERE id = '${pid}'`);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  myModelsRouter.get('/providers/:providerId/models', (req: Request, res: Response) => {
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.providerId.replace(/'/g, "''");

    const existing = db.exec(`SELECT owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    const ownerId = existing[0].values[0][0];
    // 允许：个人 Provider（owner_id = userId）或 已分配的系统 Provider（owner_id IS NULL 且在 user_providers 中）
    if (ownerId !== null && ownerId !== userId) {
      const assigned = db.exec(`SELECT 1 FROM user_providers WHERE user_id = '${userId}' AND provider_id = '${pid}'`);
      if (assigned.length === 0 || assigned[0].values.length === 0) {
        return res.status(403).json({ error: '无权访问此 Provider' });
      }
    }

    const result = db.exec(`SELECT id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities FROM models WHERE provider_id = '${pid}' ORDER BY name`);
    const models: any[] = result.length > 0 ? result[0].values.map((row: any[]) => ({
      id: row[0], providerId: row[1], name: row[2], contextLimit: row[3],
      outputLimit: row[4], inputModalities: JSON.parse(row[5]), outputModalities: JSON.parse(row[6])
    })) : [];
    res.json({ models });
  });

  myModelsRouter.post('/providers/:providerId/models', (req: Request, res: Response) => {
    const { id, name, contextLimit, outputLimit, inputModalities, outputModalities } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id, name 必填' });
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.providerId.replace(/'/g, "''");

    const existing = db.exec(`SELECT owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    if (existing[0].values[0][0] !== userId) return res.status(403).json({ error: '无权操作此 Provider' });

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

  myModelsRouter.put('/providers/:providerId/models/:modelId', (req: Request, res: Response) => {
    const { name, contextLimit, outputLimit, inputModalities, outputModalities } = req.body;
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.providerId.replace(/'/g, "''");

    const existing = db.exec(`SELECT owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    if (existing[0].values[0][0] !== userId) return res.status(403).json({ error: '无权操作此 Provider' });

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

  myModelsRouter.delete('/providers/:providerId/models/:modelId', (req: Request, res: Response) => {
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.providerId.replace(/'/g, "''");

    const existing = db.exec(`SELECT owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    if (existing[0].values[0][0] !== userId) return res.status(403).json({ error: '无权操作此 Provider' });

    try {
      db.run(`DELETE FROM models WHERE id = '${req.params.modelId.replace(/'/g, "''")}' AND provider_id = '${pid}'`);
      saveToFile();
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── 个人 Provider 自动发现模型 ──
  myModelsRouter.post('/discover', async (req: Request, res: Response) => {
    const { baseUrl, apiKey } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl 必填' });
    try {
      console.log(`[Discover] 用户 ${req.user!.userId} 正在发现模型: ${baseUrl}`);
      const models = await discoverModels(baseUrl, apiKey || '');
      console.log(`[Discover] 发现 ${models.length} 个模型`);
      res.json({ models });
    } catch (e: any) {
      console.error(`[Discover] 发现模型失败:`, e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // 通过 Provider ID 自动发现（后端读取 baseUrl 和 apiKey）
  myModelsRouter.post('/providers/:providerId/discover', async (req: Request, res: Response) => {
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.providerId.replace(/'/g, "''");
    const result = db.exec(`SELECT base_url, api_key, owner_id FROM providers WHERE id = '${pid}'`);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Provider 不存在' });
    }
    if (result[0].values[0][2] !== userId) {
      return res.status(403).json({ error: '无权操作此 Provider' });
    }
    const baseUrl = result[0].values[0][0] as string;
    const apiKey = result[0].values[0][1] as string;
    if (!baseUrl) {
      return res.status(400).json({ error: 'Provider 未设置 Base URL' });
    }
    try {
      console.log(`[Discover] 用户 ${userId} 正在发现模型 (provider: ${pid}): ${baseUrl}`);
      const models = await discoverModels(baseUrl, apiKey);
      console.log(`[Discover] 发现 ${models.length} 个模型`);
      res.json({ models });
    } catch (e: any) {
      console.error(`[Discover] 发现模型失败:`, e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // ── 批量导入模型到 Provider ──
  myModelsRouter.post('/providers/:providerId/import', (req: Request, res: Response) => {
    const { models: modelsToImport } = req.body;
    if (!Array.isArray(modelsToImport)) return res.status(400).json({ error: 'models 必须是数组' });
    const db = getDb();
    const userId = req.user!.userId;
    const pid = req.params.providerId.replace(/'/g, "''");

    const existing = db.exec(`SELECT owner_id FROM providers WHERE id = '${pid}'`);
    if (existing.length === 0) return res.status(404).json({ error: 'Provider 不存在' });
    if (existing[0].values[0][0] !== userId) return res.status(403).json({ error: '无权操作此 Provider' });

    let imported = 0;
    let skipped = 0;
    for (const m of modelsToImport) {
      try {
        const stmt = db.prepare(
          'INSERT INTO models (id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run([
          m.id, req.params.providerId, m.name || m.id,
          m.contextLimit || 0, m.outputLimit || 0,
          JSON.stringify(m.inputModalities || ['text']),
          JSON.stringify(m.outputModalities || ['text'])
        ]);
        imported++;
      } catch {
        skipped++;
      }
    }
    saveToFile();
    res.json({ success: true, imported, skipped });
  });

  // ── 系统 Provider 批量导入模型 ──
  router.post('/providers/:providerId/import', (req: Request, res: Response) => {
    const { models: modelsToImport } = req.body;
    if (!Array.isArray(modelsToImport)) return res.status(400).json({ error: 'models 必须是数组' });
    const db = getDb();
    const pid = req.params.providerId.replace(/'/g, "''");

    let imported = 0;
    let skipped = 0;
    for (const m of modelsToImport) {
      try {
        const stmt = db.prepare(
          'INSERT INTO models (id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run([
          m.id, req.params.providerId, m.name || m.id,
          m.contextLimit || 0, m.outputLimit || 0,
          JSON.stringify(m.inputModalities || ['text']),
          JSON.stringify(m.outputModalities || ['text'])
        ]);
        imported++;
      } catch {
        skipped++;
      }
    }
    saveToFile();
    res.json({ success: true, imported, skipped });
  });

  return { systemRouter: router, myModelsRouter };
};
