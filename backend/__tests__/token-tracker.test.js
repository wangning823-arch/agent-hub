const { describe, test, expect, beforeEach } = require('@jest/globals');
const TokenTracker = require('../token-tracker');

jest.mock('../db', () => ({
  getTokenStatsDb: jest.fn(() => ({
    exec: jest.fn(() => []),
    run: jest.fn()
  })),
  saveTokenStats: jest.fn()
}));

describe('TokenTracker', () => {
  let tokenTracker;

  beforeEach(() => {
    tokenTracker = new TokenTracker();
    require('../db').getTokenStatsDb.mockClear();
    require('../db').saveTokenStats.mockClear();
  });

  test('should record token usage correctly', () => {
    const sessionId = 'test-session-id';
    const usage = {
      input_tokens: 100,
      output_tokens: 200,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 30,
      cost_usd: 0.001
    };

    const stats = tokenTracker.recordUsage(sessionId, usage);

    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(200);
    expect(stats.totalCacheReadTokens).toBe(50);
    expect(stats.totalCacheWriteTokens).toBe(30);
    expect(stats.totalCost).toBe(0.001);
    expect(stats.messageCount).toBe(1);

    const sessionStats = tokenTracker.getSessionStats(sessionId);
    expect(sessionStats).toEqual(stats);
  });

  test('should accumulate token usage for multiple records', () => {
    const sessionId = 'test-session-id';
    const usage1 = { input_tokens: 100, output_tokens: 200, cost_usd: 0.001 };
    const usage2 = { input_tokens: 150, output_tokens: 250, cost_usd: 0.0015 };

    tokenTracker.recordUsage(sessionId, usage1);
    const stats = tokenTracker.recordUsage(sessionId, usage2);

    expect(stats.totalInputTokens).toBe(250);
    expect(stats.totalOutputTokens).toBe(450);
    expect(stats.totalCost).toBe(0.0025);
    expect(stats.messageCount).toBe(2);
  });

  test('should return zero stats for non-existent session', () => {
    const stats = tokenTracker.getSessionStats('non-existent-session');
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.messageCount).toBe(0);
  });

  test('should calculate total stats correctly', () => {
    tokenTracker.recordUsage('session1', { input_tokens: 100, output_tokens: 200, cost_usd: 0.001 });
    tokenTracker.recordUsage('session2', { input_tokens: 150, output_tokens: 250, cost_usd: 0.0015 });

    const totalStats = tokenTracker.getTotalStats();
    expect(totalStats.totalInputTokens).toBe(250);
    expect(totalStats.totalOutputTokens).toBe(450);
    expect(totalStats.totalCost).toBe(0.0025);
    expect(totalStats.totalMessages).toBe(2);
    expect(totalStats.sessionCount).toBe(2);
  });
});
