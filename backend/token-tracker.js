/**
 * Token统计和上下文管理
 */
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '..', 'data', 'token-stats.json');

class TokenTracker {
  constructor() {
    this.stats = new Map(); // sessionId -> stats
    this.loadStats();
  }

  /**
   * 加载统计数据
   */
  loadStats() {
    try {
      if (fs.existsSync(STATS_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        for (const [sessionId, stats] of Object.entries(data)) {
          this.stats.set(sessionId, stats);
        }
      }
    } catch (error) {
      console.error('加载Token统计失败:', error);
    }
  }

  /**
   * 保存统计数据
   */
  saveStats() {
    try {
      const data = {};
      for (const [sessionId, stats] of this.stats) {
        data[sessionId] = stats;
      }
      fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('保存Token统计失败:', error);
    }
  }

  /**
   * 记录Token使用
   */
  recordUsage(sessionId, usage) {
    if (!this.stats.has(sessionId)) {
      this.stats.set(sessionId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCost: 0,
        messageCount: 0,
        history: []
      });
    }

    const stats = this.stats.get(sessionId);
    
    // 更新总计
    stats.totalInputTokens += usage.input_tokens || 0;
    stats.totalOutputTokens += usage.output_tokens || 0;
    stats.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
    stats.totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
    stats.totalCost += usage.cost_usd || 0;
    stats.messageCount += 1;

    // 添加到历史（保留最近100条）
    stats.history.push({
      timestamp: new Date().toISOString(),
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cost: usage.cost_usd || 0
    });

    if (stats.history.length > 100) {
      stats.history = stats.history.slice(-100);
    }

    // 保存
    this.saveStats();

    return stats;
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
