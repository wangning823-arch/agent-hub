/**
 * 数据库模块 - 使用 sql.js 管理 SQLite 数据库
 */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';

const dataDir: string = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath: string = path.join(dataDir, 'agent-hub.db');
const tokenStatsDbPath: string = path.join(dataDir, 'token-stats.db');

let db: SqlJsDatabase | null = null;
let tokenStatsDb: SqlJsDatabase | null = null;
let saving = false; // 防止并发写入导致 .tmp 文件竞争

async function recoverFromBackup(SQL: any): Promise<boolean> {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) return false;

  // 按文件名倒序找最新的备份（格式：agent-hub-YYYY-MM-DD.db）
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('agent-hub-') && f.endsWith('.db'))
    .sort()
    .reverse();

  for (const file of files) {
    const backupPath = path.join(backupDir, file);
    try {
      const backupData = fs.readFileSync(backupPath);
      const testDb = new SQL.Database(backupData);
      const result = testDb.exec('SELECT COUNT(*) FROM users');
      const count = result.length > 0 ? (result[0].values[0][0] as number) : 0;
      if (count > 0) {
        console.log(`[数据库恢复] 从备份 ${file} 恢复成功，用户数: ${count}`);
        db = testDb;
        // 用恢复的数据覆盖损坏的文件
        saveToFile();
        return true;
      }
      testDb.close();
    } catch (e) {
      console.warn(`[数据库恢复] 备份 ${file} 也已损坏:`, (e as Error).message);
    }
  }
  return false;
}

async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();

  let data: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }

  // 尝试加载数据库，如果损坏则从备份恢复
  try {
    db = new SQL.Database(data as any);
  } catch (e) {
    console.error('[数据库] 加载数据库文件失败，尝试从备份恢复:', (e as Error).message);
    db = null;
  }

  // 检查数据库是否有效（users 表是否有数据）
  if (db) {
    try {
      const result = db.exec('SELECT COUNT(*) FROM users');
      const count = result.length > 0 ? (result[0].values[0][0] as number) : 0;
      if (count === 0) {
        // users 表为空，可能数据库被重建了，尝试从备份恢复
        console.warn('[数据库] users 表为空，尝试从备份恢复...');
        const recovered = await recoverFromBackup(SQL);
        if (!recovered) {
          console.warn('[数据库] 无可用备份，将使用空数据库');
        }
      }
    } catch (e) {
      // users 表不存在，数据库可能损坏
      console.error('[数据库] 无法读取 users 表:', (e as Error).message);
      db = null;
      const recovered = await recoverFromBackup(SQL);
      if (!recovered) {
        console.warn('[数据库] 无可用备份，将创建新数据库');
      }
    }
  }

  // db 已初始化，以下所有 db 使用都是安全的
  if (!db) {
    console.warn('[数据库] 无可用数据库，创建新数据库...');
    db = new SQL.Database();
  }
  // 用局部变量遮蔽外层 nullable db，消除后续 TS18047 错误
  const _db: SqlJsDatabase = db;

  _db.run(`
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

  _db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      time TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workdir TEXT NOT NULL,
      agent_type TEXT DEFAULT 'claude-code',
      mode TEXT DEFAULT 'auto',
      model TEXT,
      effort TEXT DEFAULT 'high',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_session_id TEXT,
      last_used_at TEXT NOT NULL
    )
  `);

  _db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)`);

  // 模型管理表
  _db.run(`
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
    const cols = _db.exec("PRAGMA table_info(providers)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('base_url_anthropic')) {
        _db.run('ALTER TABLE providers ADD COLUMN base_url_anthropic TEXT DEFAULT ""');
        console.log('[数据库迁移] providers 表添加 base_url_anthropic 列');
      }
      // 增量迁移：给 providers 表添加 owner_id 列（NULL = 系统 Provider，user_id = 个人 Provider）
      if (!colNames.includes('owner_id')) {
        _db.run('ALTER TABLE providers ADD COLUMN owner_id TEXT DEFAULT NULL');
        console.log('[数据库迁移] providers 表添加 owner_id 列');
      }
    }
  } catch (e) { }

  // 增量迁移：给 sessions 表添加 subtasks 列
  try {
    const cols = _db.exec("PRAGMA table_info(sessions)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('subtasks')) {
        _db.run('ALTER TABLE sessions ADD COLUMN subtasks TEXT DEFAULT "[]"');
        console.log('[数据库迁移] sessions 表添加 subtasks 列');
      }
      if (!colNames.includes('context_usage')) {
        _db.run('ALTER TABLE sessions ADD COLUMN context_usage TEXT DEFAULT NULL');
        console.log('[数据库迁移] sessions 表添加 context_usage 列');
      }
    }
  } catch (e) { }

  // 增量迁移：给 sessions 表添加 workflow_defs 和 workflows 列
  try {
    const cols = _db.exec("PRAGMA table_info(sessions)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('workflow_defs')) {
        _db.run('ALTER TABLE sessions ADD COLUMN workflow_defs TEXT DEFAULT "[]"');
        console.log('[数据库迁移] sessions 表添加 workflow_defs 列');
      }
      if (!colNames.includes('workflows')) {
        _db.run('ALTER TABLE sessions ADD COLUMN workflows TEXT DEFAULT "[]"');
        console.log('[数据库迁移] sessions 表添加 workflows 列');
      }
    }
  } catch (e) { }

  // 工作流模板表
  _db.run(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      steps TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      usage_count INTEGER DEFAULT 0
    )
  `);

  // 工作流定时调度表
  _db.run(`
    CREATE TABLE IF NOT EXISTS workflow_schedules (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workflow_def_id TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL
    )
  `);

  // ========== Prompt 模板表 ==========
  _db.run(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      is_builtin INTEGER DEFAULT 0,
      owner_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      usage_count INTEGER DEFAULT 0
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_prompt_templates_owner_id ON prompt_templates(owner_id)`);

  // ========== 设计规范表 ==========
  _db.run(`
    CREATE TABLE IF NOT EXISTS design_specs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Default Spec',
      owner_id TEXT,
      ui_library TEXT DEFAULT 'tailwind',
      design_style TEXT DEFAULT 'modern',
      primary_color TEXT DEFAULT '#6366f1',
      border_radius TEXT DEFAULT 'medium',
      font_family TEXT DEFAULT 'system',
      font_size TEXT DEFAULT 'medium',
      spacing TEXT DEFAULT 'normal',
      dark_mode INTEGER DEFAULT 1,
      animations INTEGER DEFAULT 1,
      custom_css TEXT DEFAULT '',
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_design_specs_owner_id ON design_specs(owner_id)`);

  // 增量迁移：清理从 Claude Code 自动迁移的 claude-custom provider
  try {
    const ccResult = _db.exec("SELECT id FROM providers WHERE id = 'claude-custom'");
    if (ccResult.length > 0 && ccResult[0].values.length > 0) {
      _db.run("DELETE FROM models WHERE provider_id = 'claude-custom'");
      _db.run("DELETE FROM tool_sync WHERE provider_id = 'claude-custom'");
      _db.run("DELETE FROM providers WHERE id = 'claude-custom'");
      console.log('[数据库迁移] 已清理 claude-custom provider（模型仅从 OpenCode 配置读取）');
      saveToFile();
    }
  } catch (e) { }

  _db.run(`
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
  _db.run(`
    CREATE TABLE IF NOT EXISTS tool_sync (
      tool TEXT PRIMARY KEY,
      provider_id TEXT,
      model_id TEXT,
      synced_at TEXT,
      config TEXT DEFAULT '{}'
    )
  `);

  // ========== 用户管理表迁移 ==========
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      home_dir TEXT NOT NULL,
      display_name TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

  // 增量迁移：给 users 表添加 preferences 列
  try {
    const cols = _db.exec("PRAGMA table_info(users)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('preferences')) {
        _db.run('ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT \'{}\'');
        console.log('[数据库迁移] users 表添加 preferences 列');
      }
    }
  } catch (e) { }

  // 模型权限表：管理系统 Provider 分配给用户
  _db.run(`
    CREATE TABLE IF NOT EXISTS user_providers (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, provider_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_user_providers_provider_id ON user_providers(provider_id)`);

  // ========== 凭证管理表 ==========
  _db.run(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      type TEXT NOT NULL,
      username TEXT,
      secret TEXT,
      key_data TEXT,
      owner_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_credentials_host ON credentials(host)`);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_credentials_owner_id ON credentials(owner_id)`);

  // 管理员分配系统凭证给用户
  _db.run(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, credential_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_user_credentials_credential_id ON user_credentials(credential_id)`);

  // ========== Agent 类型权限表 ==========
  _db.run(`
    CREATE TABLE IF NOT EXISTS user_agent_types (
      user_id TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, agent_type),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 向后兼容：从 JSON 迁移旧凭证到 SQLite
  await migrateCredentialsFromJson();

  // 向后兼容：如果 user_credentials 为空且只有一个 admin，自动分配所有系统凭证给该 admin
  try {
    const adminResult = _db.exec("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    const credResult = _db.exec("SELECT id FROM credentials WHERE owner_id IS NULL");
    if (adminResult.length > 0 && adminResult[0].values.length === 1 && credResult.length > 0 && credResult[0].values.length > 0) {
      const permResult = _db.exec("SELECT COUNT(*) FROM user_credentials");
      const permCount = permResult[0]?.values[0][0] as number;
      if (permCount === 0) {
        const adminId = adminResult[0].values[0][0] as string;
        const now = new Date().toISOString();
        for (const row of credResult[0].values) {
          const cid = row[0] as string;
          _db.run("INSERT OR IGNORE INTO user_credentials (user_id, credential_id, created_at) VALUES (?, ?, ?)", [adminId, cid, now]);
        }
        console.log(`[数据库迁移] 自动分配 ${credResult[0].values.length} 个系统凭证给管理员 ${adminId}`);
      }
    }
  } catch (e) { }

  // 向后兼容：如果 user_providers 为空且只有一个 admin，自动分配所有系统 Provider 给该 admin
  try {
    const adminResult = _db.exec("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    const providerResult = _db.exec("SELECT id FROM providers WHERE owner_id IS NULL");
    if (adminResult.length > 0 && adminResult[0].values.length === 1 && providerResult.length > 0 && providerResult[0].values.length > 0) {
      const permResult = _db.exec("SELECT COUNT(*) FROM user_providers");
      const permCount = permResult[0]?.values[0][0] as number;
      if (permCount === 0) {
        const adminId = adminResult[0].values[0][0] as string;
        const now = new Date().toISOString();
        for (const row of providerResult[0].values) {
          const pid = row[0] as string;
          _db.run("INSERT OR IGNORE INTO user_providers (user_id, provider_id, created_at) VALUES (?, ?, ?)", [adminId, pid, now]);
        }
        console.log(`[数据库迁移] 自动分配 ${providerResult[0].values.length} 个系统 Provider 给管理员 ${adminId}`);
      }
    }
  } catch (e) { }

  // 向后兼容：如果 user_agent_types 为空且只有一个 admin，自动分配所有 agent 类型给该 admin
  try {
    const adminResult = _db.exec("SELECT id FROM users WHERE role = 'admin' AND is_active = 1");
    if (adminResult.length > 0 && adminResult[0].values.length === 1) {
      const permResult = _db.exec("SELECT COUNT(*) FROM user_agent_types");
      const permCount = permResult[0]?.values[0][0] as number;
      if (permCount === 0) {
        const adminId = adminResult[0].values[0][0] as string;
        const now = new Date().toISOString();
        const allAgentTypes = ['claude-code', 'opencode', 'codex', 'mimo'];
        for (const at of allAgentTypes) {
          _db.run("INSERT OR IGNORE INTO user_agent_types (user_id, agent_type, created_at) VALUES (?, ?, ?)", [adminId, at, now]);
        }
        console.log(`[数据库迁移] 自动分配所有 Agent 类型给管理员 ${adminId}`);
      }
    }
  } catch (e) { }

  try {
    const cols = _db.exec("PRAGMA table_info(projects)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('user_id')) {
        _db.run('ALTER TABLE projects ADD COLUMN user_id TEXT DEFAULT NULL');
        _db.run('CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)');
        console.log('[数据库迁移] projects 表添加 user_id 列');
      }
    }
  } catch (e) { }

  try {
    const cols = _db.exec("PRAGMA table_info(sessions)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('user_id')) {
        _db.run('ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT NULL');
        _db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
        console.log('[数据库迁移] sessions 表添加 user_id 列');
      }
    }
  } catch (e) { }

  try {
    const cols = _db.exec("PRAGMA table_info(workflow_templates)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map((row: any[]) => row[1]);
      if (!colNames.includes('user_id')) {
        _db.run('ALTER TABLE workflow_templates ADD COLUMN user_id TEXT DEFAULT NULL');
        _db.run('CREATE INDEX IF NOT EXISTS idx_workflow_templates_user_id ON workflow_templates(user_id)');
        console.log('[数据库迁移] workflow_templates 表添加 user_id 列');
      }
    }
  } catch (e) { }

  await migrateFromJson();
  await migrateProjectsFromJson();
  await migrateModelsFromConfigFiles();
  saveToFile();

  // 启动验证：检查关键表是否存在且可读
  try {
    const userCount = db.exec('SELECT COUNT(*) FROM users');
    const count = userCount.length > 0 ? userCount[0].values[0][0] : 0;
    console.log(`[数据库验证] 用户数: ${count}`);
    if ((count as number) === 0) {
      console.warn('[数据库警告] users 表为空，新用户将需要注册');
    }
  } catch (e) {
    console.error('[数据库错误] 无法读取 users 表:', e);
  }

  await initTokenStatsDb();

  console.log('数据库初始化完成');
  return db;
}

function saveToFile(): void {
  if (db) {
    if (saving) return; // 跳过并发调用，避免 .tmp 文件竞争
    saving = true;
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      if (buffer.length === 0) {
        console.error('[DB] saveToFile: db.export() 返回空 buffer，跳过写入（保留原文件）');
        return;
      }
      const tmpPath = dbPath + '.tmp';
      fs.writeFileSync(tmpPath, buffer);
      const stat = fs.statSync(tmpPath);
      if (stat.size !== buffer.length) {
        console.error(`[DB] saveToFile: 写入大小不匹配 expected=${buffer.length} actual=${stat.size}，删除临时文件`);
        try { fs.unlinkSync(tmpPath); } catch {}
        return;
      }
      fs.renameSync(tmpPath, dbPath);
      const countResult = db.exec('SELECT COUNT(*) FROM sessions');
      const currentCount = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;
      console.log(`[DB] saveToFile 成功: ${buffer.length} bytes, ${currentCount} sessions`);
    } catch (e) {
      console.error('[DB] saveToFile 失败:', (e as Error).message, '（保留原数据库文件不动）');
      try { fs.unlinkSync(dbPath + '.tmp'); } catch {}
    } finally {
      saving = false;
    }
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

async function migrateCredentialsFromJson(): Promise<void> {
  const credsFile = path.join(dataDir, 'credentials.json');
  if (!fs.existsSync(credsFile)) return;

  const result = db!.exec('SELECT COUNT(*) as count FROM credentials');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if ((count as number) > 0) return;

  try {
    const jsonData = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    if (!jsonData || Object.keys(jsonData).length === 0) return;

    const now = new Date().toISOString();
    const insertStmt = db!.prepare(
      'INSERT INTO credentials (id, host, type, username, secret, key_data, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)'
    );

    let migrated = 0;
    for (const [key, cred] of Object.entries(jsonData) as [string, any][]) {
      const id = `cred_migrated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      insertStmt.run([
        id,
        cred.host || key,
        cred.type || 'token',
        cred.username || null,
        cred.secret || null,
        cred.keyData || null,
        now,
        now
      ]);
      migrated++;
    }
    insertStmt.free();
    console.log(`[凭证迁移] 从 JSON 导入 ${migrated} 个凭证到数据库`);
  } catch (e: any) {
    console.warn('[凭证迁移] 读取凭证 JSON 失败:', e.message);
  }
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

  // 给 token_stats 和 token_history 表添加 user_id 列
  try {
    const tsCols = tokenStatsDb!.exec("PRAGMA table_info(token_stats)");
    if (tsCols.length > 0) {
      const tsColNames = tsCols[0].values.map((row: any[]) => row[1]);
      if (!tsColNames.includes('user_id')) {
        tokenStatsDb!.run('ALTER TABLE token_stats ADD COLUMN user_id TEXT DEFAULT NULL');
        tokenStatsDb!.run('CREATE INDEX IF NOT EXISTS idx_token_stats_user_id ON token_stats(user_id)');
        console.log('[数据库迁移] token_stats 表添加 user_id 列');
      }
    }
  } catch (e) { }

  try {
    const thCols = tokenStatsDb!.exec("PRAGMA table_info(token_history)");
    if (thCols.length > 0) {
      const thColNames = thCols[0].values.map((row: any[]) => row[1]);
      if (!thColNames.includes('user_id')) {
        tokenStatsDb!.run('ALTER TABLE token_history ADD COLUMN user_id TEXT DEFAULT NULL');
        tokenStatsDb!.run('CREATE INDEX IF NOT EXISTS idx_token_history_user_id ON token_history(user_id)');
        console.log('[数据库迁移] token_history 表添加 user_id 列');
      }
    }
  } catch (e) { }

  await migrateTokenStatsFromJson();

  // 清理 token_history 防止无限增长（每个 session 只保留最近 500 条）
  try {
    tokenStatsDb!.run(`
      DELETE FROM token_history WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) as rn
          FROM token_history
        ) WHERE rn <= 500
      )
    `);
    console.log('[数据库维护] 清理 token_history 历史记录');
  } catch (e) { }

  saveTokenStatsToFile();

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
    const tmpPath = tokenStatsDbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, tokenStatsDbPath);
  }
}

function startDailyBackup(): void {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const doBackup = (): void => {
    const date = new Date().toISOString().split('T')[0];

    // 备份主数据库
    if (db) {
      try {
        const backupPath = path.join(backupDir, `agent-hub-${date}.db`);
        const data = db.export();
        const buffer = Buffer.from(data);
        const tmpPath = backupPath + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, backupPath);
        console.log(`主数据库已备份到 ${backupPath}`);
      } catch (e) {
        console.error('主数据库备份失败:', e);
      }
    }

    // 备份 token 统计数据库
    if (tokenStatsDb) {
      try {
        const backupPath = path.join(backupDir, `token-stats-${date}.db`);
        const data = tokenStatsDb.export();
        const buffer = Buffer.from(data);
        const tmpPath = backupPath + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, backupPath);
        console.log(`Token统计已备份到 ${backupPath}`);
      } catch (e) {
        console.error('Token统计备份失败:', e);
      }
    }

    cleanupOldBackups(30);
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

  // 每小时清理 token_history 防止无限增长
  setInterval(() => {
    try {
      if (tokenStatsDb) {
        tokenStatsDb.run(`
          DELETE FROM token_history WHERE id NOT IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) as rn
              FROM token_history
            ) WHERE rn <= 500
          )
        `);
        saveTokenStatsToFile();
      }
    } catch (e) { }
  }, 60 * 60 * 1000);
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

const JWT_SECRET_PATH = path.join(dataDir, 'jwt-secret.json');

function getJwtSecret(): string {
  if (fs.existsSync(JWT_SECRET_PATH)) {
    const data = JSON.parse(fs.readFileSync(JWT_SECRET_PATH, 'utf8'));
    return data.secret;
  }
  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(JWT_SECRET_PATH, JSON.stringify({ secret }, null, 2));
  console.log('[JWT] 已生成新的 JWT 签名密钥');
  return secret;
}

export { initDb, getDb, saveToFile, saveTokenStatsToFile, getTokenStatsDb, saveTokenStats, getJwtSecret };
