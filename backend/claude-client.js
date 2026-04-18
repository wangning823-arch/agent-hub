/**
 * Anthropic SDK 单例客户端
 * 所有需要直接调用 Claude API 的模块共享此实例
 */
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/anthropic',
});

module.exports = client;
