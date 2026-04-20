/**
 * Token统计和上下文管理
 */
let getTokenStatsDb = null;
let saveTokenStatsFn = null;

class TokenTracker {
  constructor() {
    this.stats = new Map();
    this.loadStats();
  }

  initDb(getDbFn, saveStatsFn) {
    getTokenStatsDb = getDbFn;
    saveTokenStatsFn = saveStatsFn;
  }

  loadStats() {
    try {
      if (!getTokenStatsDb) {
        const { getTokenStatsDb: getDb, saveTokenStats } = require('./db');
        getTokenStatsDb = getDb;
        saveTokenStatsFn = saveTokenStats;
      }
      const db = getTokenStatsDb();
      const rows = db.exec('SELECT session_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_write_tokens, total_cost, message_count FROM token_stats');
      if (rows.length === 0) return;
      for (const row of rows[0].values) {
        this.stats.set(row[0], {
          totalInputTokens: row[1] || 0,
          totalOutputTokens: row[2] || 0,
          totalCacheReadTokens: row[3] || 0,
          totalCacheWriteTokens: row[4] || 0,
          totalCost: row[5] || 0,
          messageCount: row[6] || 0,
          history: []
        });
      }
    } catch (error) {
      console.error('加载Token统计失败:', error);
    }
  }

  saveStats() {
    if (!saveTokenStatsFn) return;
    try {
      saveTokenStatsFn();
    } catch (error) {
      console.error('保存Token统计失败:', error);
    }
  }

  /**
   * 记录Token使用
   */
  recordUsage(sessionId, usage) {
    try {
      if (!getTokenStatsDb) {
        const { getTokenStatsDb: getDb, saveTokenStats } = require('./db');
        getTokenStatsDb = getDb;
        saveTokenStatsFn = saveTokenStats;
      }
      const db = getTokenStatsDb();
      const now = new Date().toISOString();

      const existing = db.exec(`SELECT total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_write_tokens, total_cost, message_count FROM token_stats WHERE session_id = '${sessionId.replace(/'/g, "''")}'`);
      
      if (existing.length === 0 || existing[0].values.length === 0) {
        db.run(`INSERT INTO token_stats (session_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_write_tokens, total_cost, message_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sessionId, usage.input_tokens || 0, usage.output_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0, usage.cost_usd || 0, 1, now]);
      } else {
        const row = existing[0].values[0];
        db.run(`UPDATE token_stats SET total_input_tokens = ?, total_output_tokens = ?, total_cache_read_tokens = ?, total_cache_write_tokens = ?, total_cost = ?, message_count = ?, updated_at = ? WHERE session_id = ?`,
          [(row[0] || 0) + (usage.input_tokens || 0), (row[1] || 0) + (usage.output_tokens || 0), (row[2] || 0) + (usage.cache_read_input_tokens || 0), (row[3] || 0) + (usage.cache_creation_input_tokens || 0), (row[4] || 0) + (usage.cost_usd || 0), (row[5] || 0) + 1, now, sessionId]);
      }

      db.run(`INSERT INTO token_history (session_id, timestamp, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?)`,
        [sessionId, now, usage.input_tokens || 0, usage.output_tokens || 0, usage.cost_usd || 0]);

      if (saveTokenStatsFn) saveTokenStatsFn();

      if (!this.stats.has(sessionId)) {
        this.stats.set(sessionId, { totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, totalCost: 0, messageCount: 0, history: [] });
      }
      const stats = this.stats.get(sessionId);
      stats.totalInputTokens += usage.input_tokens || 0;
      stats.totalOutputTokens += usage.output_tokens || 0;
      stats.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
      stats.totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
      stats.totalCost += usage.cost_usd || 0;
      stats.messageCount += 1;

      return stats;
    } catch (error) {
      console.error('记录Token使用失败:', error);
      return { totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, totalCost: 0, messageCount: 0 };
    }
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId) {
    return this.stats.get(sessionId) || {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: 0,
      messageCount: 0,
      history: []
    };
  }

  /**
   * 获取所有会话统计
   */
  getAllStats() {
    const result = {};
    for (const [sessionId, stats] of this.stats) {
      result[sessionId] = stats;
    }
    return result;
  }

  /**
   * 清除会话统计
   */
  clearSessionStats(sessionId) {
    this.stats.delete(sessionId);
    this.saveStats();
  }

  /**
   * 获取总统计
   */
  getTotalStats() {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let totalMessages = 0;

    for (const stats of this.stats.values()) {
      totalInput += stats.totalInputTokens;
      totalOutput += stats.totalOutputTokens;
      totalCacheRead += stats.totalCacheReadTokens;
      totalCacheWrite += stats.totalCacheWriteTokens;
      totalCost += stats.totalCost;
      totalMessages += stats.messageCount;
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
      totalCost,
      totalMessages,
      sessionCount: this.stats.size
    };
  }

  /**
   * 格式化Token数量
   */
  static formatTokens(count) {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(2) + 'M';
    }
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
  }

  /**
   * 格式化费用
   */
  static formatCost(cost) {
    return '$' + cost.toFixed(4);
  }
}

module.exports = TokenTracker;
