const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'agent-hub.db');
const tokenStatsDbPath = path.join(dataDir, 'token-stats.db');

let db = null;
let tokenStatsDb = null;

async function initDb() {
  const SQL = await initSqlJs();

  let data = null;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }

  db = new SQL.Database(data);

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

  await migrateFromJson();
  await migrateProjectsFromJson();
  saveToFile();

  await initTokenStatsDb();

  console.log('数据库初始化完成');
  return db;
}

function saveToFile() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

async function migrateFromJson() {
  const sessionsFile = path.join(dataDir, 'sessions.json');
  if (!fs.existsSync(sessionsFile)) {
    return;
  }
  
  const result = db.exec('SELECT COUNT(*) as count FROM sessions');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if (count > 0) {
    return;
  }
  
  const jsonData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  if (!jsonData || jsonData.length === 0) {
    return;
  }
  
  const insertSession = db.prepare(`
    INSERT INTO sessions (id, workdir, agent_type, agent_name, conversation_id, title, options, is_pinned, is_archived, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMessage = db.prepare(`
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
  
  console.log(`迁移 ${jsonData.length} 个会话到数据库`);
}

async function migrateProjectsFromJson() {
  const projectsFile = path.join(dataDir, 'projects.json');
  if (!fs.existsSync(projectsFile)) {
    return;
  }

  const result = db.exec('SELECT COUNT(*) as count FROM projects');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if (count > 0) {
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  if (!jsonData || !jsonData.projects || jsonData.projects.length === 0) {
    return;
  }

  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, workdir, agent_type, mode, model, effort, created_at, updated_at, last_session_id, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [, project] of jsonData.projects) {
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

  console.log(`迁移 ${jsonData.projects.length} 个项目到数据库`);
}

async function initTokenStatsDb() {
  const SQL = await initSqlJs();

  let data = null;
  if (fs.existsSync(tokenStatsDbPath)) {
    data = fs.readFileSync(tokenStatsDbPath);
  }

  tokenStatsDb = new SQL.Database(data);

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

async function migrateTokenStatsFromJson() {
  const filePath = path.join(dataDir, 'token-stats.json');
  if (!fs.existsSync(filePath)) {
    return;
  }

  const result = tokenStatsDb.exec('SELECT COUNT(*) as count FROM token_stats');
  const count = result.length > 0 ? result[0].values[0][0] : 0;
  if (count > 0) {
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!jsonData || Object.keys(jsonData).length === 0) {
    return;
  }

  const insertStats = tokenStatsDb.prepare(`
    INSERT INTO token_stats (session_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_write_tokens, total_cost, message_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHistory = tokenStatsDb.prepare(`
    INSERT INTO token_history (session_id, timestamp, input_tokens, output_tokens, cost)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const [sessionId, stats] of Object.entries(jsonData)) {
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

  console.log(`迁移 ${Object.keys(jsonData).length} 个token统计到数据库`);
}

function saveTokenStatsToFile() {
  if (tokenStatsDb) {
    const data = tokenStatsDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(tokenStatsDbPath, buffer);
  }
}

function startDailyBackup() {
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const doBackup = () => {
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

  const cleanupOldBackups = (daysToKeep) => {
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

function getDb() {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDb()');
  }
  return db;
}

function getTokenStatsDb() {
  if (!tokenStatsDb) {
    throw new Error('Token统计数据库未初始化');
  }
  return tokenStatsDb;
}

function saveTokenStats() {
  saveTokenStatsToFile();
}

module.exports = { initDb, getDb, saveToFile, getTokenStatsDb, saveTokenStats };