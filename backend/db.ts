/**
 * 数据库模块 - 使用 sql.js 管理 SQLite 数据库
 */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';

const dataDir: string = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath: string = path.join(dataDir, 'agent-hub.db');
const tokenStatsDbPath: string = path.join(dataDir, 'token-stats.db');

let db: SqlJsDatabase | null = null;
let tokenStatsDb: SqlJsDatabase | null = null;

async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();

  let data: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }

  db = new SQL.Database(data as any);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workdir TEXT NOT NULL,
      agent_type TEXT DEFAULT 'claude-code',
      agent_name TEXT DEFAULT 'unknown',
      conversation_id TEXT,
      title TEXT,
      options TEXT DEFAULT '{}',
      is_pinned INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      subtasks TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      time TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workdir TEXT NOT NULL,
      agent_type TEXT DEFAULT 'claude-code',
      mode TEXT DEFAULT 'auto',
      model TEXT,
      effort TEXT DEFAULT 'medium',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_session_id TEXT,
      last_used_at TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)`);

  // 模型管理表
  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      npm_package TEXT DEFAULT '',
      base_url TEXT NOT NULL,
      base_url_anthropic TEXT DEFAULT '',
      api_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // 增量迁移：给已有的 providers 表添加 base_url_anthropic 列
  try {
    const cols = db.exec("PRAGMA table_info(providers)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('base_url_anthropic')) {
        db.run('ALTER TABLE providers ADD COLUMN base_url_anthropic TEXT DEFAULT ""');
        console.log('[数据库迁移] providers 表添加 base_url_anthropic 列');
      }
    }
  } catch (e) { }

  // 增量迁移：给 sessions 表添加 subtasks 列
  try {
    const cols = db.exec("PRAGMA table_info(sessions)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('subtasks')) {
        db.run('ALTER TABLE sessions ADD COLUMN subtasks TEXT DEFAULT "[]"');
        console.log('[数据库迁移] sessions 表添加 subtasks 列');
      }
    }
  } catch (e) { }

  // 增量迁移：清理从 Claude Code 自动迁移的 claude-custom provider
  try {
    const ccResult = db.exec("SELECT id FROM providers WHERE id = 'claude-custom'");
    if (ccResult.length > 0 && ccResult[0].values.length > 0) {
      db.run("DELETE FROM models WHERE provider_id = 'claude-custom'");
      db.run("DELETE FROM tool_sync WHERE provider_id = 'claude-custom'");
      db.run("DELETE FROM providers WHERE id = 'claude-custom'");
      console.log('[数据库迁移] 已清理 claude-custom provider（模型仅从 OpenCode 配置读取）');
      saveToFile();
    }
  } catch (e) { }

  db.run(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      context_limit INTEGER DEFAULT 0,
      output_limit INTEGER DEFAULT 0,
      input_modalities TEXT DEFAULT '["text"]',
      output_modalities TEXT DEFAULT '["text"]',
      PRIMARY KEY (id, provider_id),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    )
  `);

  // 工具同步状态表
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_sync (
      tool TEXT PRIMARY KEY,
      provider_id TEXT,
      model_id TEXT,
      synced_at TEXT,
      config TEXT DEFAULT '{}'
    )
  `);

  await migrateFromJson();
  await migrateProjectsFromJson();
  await migrateModelsFromConfigFiles();
  saveToFile();

  await initTokenStatsDb();

  console.log('数据库初始化完成');
  return db;
}

function saveToFile(): void {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

async function migrateFromJson(): Promise<void> {
  const sessionsFile = path.join(dataDir, 'sessions.json');
  if (!fs.existsSync(sessionsFile)) {
    return;
  }

  const result = db!.exec('SELECT COUNT(*) as count FROM sessions');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if ((count as number) > 0) {
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  if (!jsonData || jsonData.length === 0) {
    return;
  }

  const insertSession = db!.prepare(`
    INSERT INTO sessions (id, workdir, agent_type, agent_name, conversation_id, title, options, is_pinned, is_archived, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = db!.prepare(`
    INSERT INTO messages (session_id, role, content, time)
    VALUES (?, ?, ?, ?)
  `);

  for (const s of jsonData) {
    const tags = s.tags ? JSON.stringify(s.tags) : '[]';
    const options = s.options ? JSON.stringify(s.options) : '{}';
    insertSession.run([
      s.id,
      s.workdir,
      s.agentType || 'claude-code',
      s.agentName || 'unknown',
      s.conversationId || null,
      s.title || null,
      options,
      s.isPinned ? 1 : 0,
      s.isArchived ? 1 : 0,
      tags,
      s.createdAt,
      s.updatedAt || s.createdAt
    ]);

    if (s.messages && s.messages.length > 0) {
      for (const msg of s.messages) {
        const content = typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content;
        insertMessage.run([s.id, msg.role, content, msg.time]);
      }
    }
  }

  insertSession.free();
  insertMessage.free();

  console.log(`迁移 ${jsonData.length} 个会话到数据库`);
}

async function migrateProjectsFromJson(): Promise<void> {
  const projectsFile = path.join(dataDir, 'projects.json');
  if (!fs.existsSync(projectsFile)) {
    return;
  }

  const result = db!.exec('SELECT COUNT(*) as count FROM projects');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if ((count as number) > 0) {
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  if (!jsonData || !jsonData.projects || jsonData.projects.length === 0) {
    return;
  }

  const insertProject = db!.prepare(`
    INSERT INTO projects (id, name, workdir, agent_type, mode, model, effort, created_at, updated_at, last_session_id, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [, project] of Object.entries(jsonData.projects) as [string, any][]) {
    insertProject.run([
      project.id,
      project.name,
      project.workdir,
      project.agentType || 'claude-code',
      project.mode || 'auto',
      project.model || null,
      project.effort || 'medium',
      project.createdAt,
      project.updatedAt,
      project.lastSessionId || null,
      project.lastUsedAt
    ]);
  }

  insertProject.free();

  console.log(`迁移 ${jsonData.projects.length} 个项目到数据库`);
}

async function migrateModelsFromConfigFiles(): Promise<void> {
  const result = db!.exec('SELECT COUNT(*) as count FROM providers');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if ((count as number) > 0) return;

  const now = new Date().toISOString();
  const homeDir = process.env.HOME || '/root';

  const opencodeConfigPath = path.join(homeDir, '.config', 'opencode', 'opencode.json');
  if (fs.existsSync(opencodeConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf-8'));
      const providers = config.provider || {};

      for (const [providerId, provider] of Object.entries(providers) as [string, any][]) {
        const insertProvider = db!.prepare(
          'INSERT INTO providers (id, name, npm_package, base_url, base_url_anthropic, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const baseURL = provider.options?.baseURL || '';
        const apiKey = provider.options?.apiKey || '';
        insertProvider.run([providerId, provider.name || providerId, provider.npm || '', baseURL, '', apiKey, now, now]);
        insertProvider.free();

        const models = provider.models || {};
        for (const [modelId, modelInfo] of Object.entries(models) as [string, any][]) {
          const insertModel = db!.prepare(
            'INSERT INTO models (id, provider_id, name, context_limit, output_limit, input_modalities, output_modalities) VALUES (?, ?, ?, ?, ?, ?, ?)'
          );
          const ctx = modelInfo.limit?.context || 0;
          const out = modelInfo.limit?.output || 0;
          const inMods = JSON.stringify(modelInfo.modalities?.input || ['text']);
          const outMods = JSON.stringify(modelInfo.modalities?.output || ['text']);
          insertModel.run([modelId, providerId, modelInfo.name || modelId, ctx, out, inMods, outMods]);
          insertModel.free();
        }

        const defaultModel: string = config.model || '';
        if (defaultModel.startsWith(providerId + '/')) {
          const insertSync = db!.prepare(
            'INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)'
          );
          const modelId = defaultModel.slice(providerId.length + 1);
          insertSync.run(['opencode', providerId, modelId, now, '{}']);
          insertSync.free();
        }
      }
      console.log(`[模型迁移] 从 OpenCode 配置导入 ${Object.keys(providers).length} 个 provider`);
    } catch (e: any) {
      console.warn('[模型迁移] 读取 OpenCode 配置失败:', e.message);
    }
  }

  const claudeSettingsPath = path.join(homeDir, '.claude', 'settings.json');
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      const env = settings.env || {};
      if (env.ANTHROPIC_BASE_URL) {
        const anthropicBaseURL: string = env.ANTHROPIC_BASE_URL;

        const existingResult = db!.exec('SELECT id, base_url, base_url_anthropic FROM providers');
        let matchedProvider: { id: string; baseUrl: string } | null = null;
        if (existingResult.length > 0) {
          for (const row of existingResult[0].values) {
            const [pid, bUrl, bUrlAnthropic] = row as [string, string, string];
            if (!bUrlAnthropic && bUrl && anthropicBaseURL.includes(new URL(bUrl).hostname)) {
              matchedProvider = { id: pid, baseUrl: bUrl };
              break;
            }
          }
        }

        if (matchedProvider) {
          const updateStmt = db!.prepare('UPDATE providers SET base_url_anthropic = ? WHERE id = ?');
          updateStmt.run([anthropicBaseURL, matchedProvider.id]);
          updateStmt.free();
        }

        if (matchedProvider) {
          const insertSync = db!.prepare(
            'INSERT OR REPLACE INTO tool_sync (tool, provider_id, model_id, synced_at, config) VALUES (?, ?, ?, ?, ?)'
          );
          const config: Record<string, string> = {};
          if (env.ANTHROPIC_MODEL) config.model = env.ANTHROPIC_MODEL;
          if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) config.sonnetModel = env.ANTHROPIC_DEFAULT_SONNET_MODEL;
          if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) config.opusModel = env.ANTHROPIC_DEFAULT_OPUS_MODEL;
          if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) config.haikuModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
          insertSync.run(['claude-code', matchedProvider.id, env.ANTHROPIC_MODEL || '', now, JSON.stringify(config)]);
          insertSync.free();
        }
      }
    } catch (e: any) {
      console.warn('[模型迁移] 读取 Claude 配置失败:', e.message);
    }
  }
}

async function initTokenStatsDb(): Promise<void> {
  const SQL = await initSqlJs();

  let data: Buffer | null = null;
  if (fs.existsSync(tokenStatsDbPath)) {
    data = fs.readFileSync(tokenStatsDbPath);
  }

  tokenStatsDb = new SQL.Database(data as any);

  tokenStatsDb.run(`
    CREATE TABLE IF NOT EXISTS token_stats (
      session_id TEXT PRIMARY KEY,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      total_cache_write_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);

  tokenStatsDb.run(`
    CREATE TABLE IF NOT EXISTS token_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES token_stats(session_id) ON DELETE CASCADE
    )
  `);

  tokenStatsDb.run(`CREATE INDEX IF NOT EXISTS idx_token_history_session_id ON token_history(session_id)`);

  await migrateTokenStatsFromJson();
  saveTokenStatsToFile();

  startDailyBackup();

  console.log('Token统计数据库初始化完成');
}

async function migrateTokenStatsFromJson(): Promise<void> {
  const filePath = path.join(dataDir, 'token-stats.json');
  if (!fs.existsSync(filePath)) {
    return;
  }

  const result = tokenStatsDb!.exec('SELECT COUNT(*) as count FROM token_stats');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if ((count as number) > 0) {
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!jsonData || Object.keys(jsonData).length === 0) {
    return;
  }

  const insertStats = tokenStatsDb!.prepare(`
    INSERT INTO token_stats (session_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_write_tokens, total_cost, message_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHistory = tokenStatsDb!.prepare(`
    INSERT INTO token_history (session_id, timestamp, input_tokens, output_tokens, cost)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const [sessionId, stats] of Object.entries(jsonData) as [string, any][]) {
    const updatedAt = stats.history && stats.history.length > 0
      ? stats.history[stats.history.length - 1].timestamp
      : new Date().toISOString();

    insertStats.run([
      sessionId,
      stats.totalInputTokens || 0,
      stats.totalOutputTokens || 0,
      stats.totalCacheReadTokens || 0,
      stats.totalCacheWriteTokens || 0,
      stats.totalCost || 0,
      stats.messageCount || 0,
      updatedAt
    ]);

    if (stats.history && stats.history.length > 0) {
      for (const h of stats.history) {
        insertHistory.run([sessionId, h.timestamp, h.inputTokens || 0, h.outputTokens || 0, h.cost || 0]);
      }
    }
  }

  insertStats.free();
  insertHistory.free();

  console.log(`迁移 ${Object.keys(jsonData).length} 个token统计到数据库`);
}

function saveTokenStatsToFile(): void {
  if (tokenStatsDb) {
    const data = tokenStatsDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(tokenStatsDbPath, buffer);
  }
}

function startDailyBackup(): void {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const doBackup = (): void => {
    const date = new Date().toISOString().split('T')[0];
    const backupPath = path.join(backupDir, `token-stats-${date}.db`);

    if (tokenStatsDb) {
      const data = tokenStatsDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(backupPath, buffer);
      console.log(`Token统计已备份到 ${backupPath}`);

      cleanupOldBackups(30);
    }
  };

  const cleanupOldBackups = (daysToKeep: number): void => {
    const backupDir = path.join(dataDir, 'backups');
    if (!fs.existsSync(backupDir)) return;

    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(backupDir);

    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        console.log(`已删除过期备份: ${file}`);
      }
    }
  };

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    doBackup();
    setInterval(doBackup, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDb()');
  }
  return db;
}

function getTokenStatsDb(): SqlJsDatabase {
  if (!tokenStatsDb) {
    throw new Error('Token统计数据库未初始化');
  }
  return tokenStatsDb;
}

function saveTokenStats(): void {
  saveTokenStatsToFile();
}

export { initDb, getDb, saveToFile, getTokenStatsDb, saveTokenStats };
