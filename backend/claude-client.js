/**
 * Anthropic SDK 单例客户端
 * 从 Claude Code CLI 配置 (~/.claude/settings.json) 读取 API Key 和 Base URL
 */
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

function loadClaudeConfig() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/root';
  const configPath = path.join(homeDir, '.claude', 'settings.json');
  try {
    if (fs.existsSync(configPath)) {
      const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return settings.env || {};
    }
  } catch (e) {
    console.warn('[claude-client] 读取 Claude CLI 配置失败:', e.message);
  }
  return {};
}

const claudeEnv = loadClaudeConfig();

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || claudeEnv.ANTHROPIC_AUTH_TOKEN,
  baseURL: process.env.ANTHROPIC_BASE_URL || claudeEnv.ANTHROPIC_BASE_URL,
});

module.exports = client;
