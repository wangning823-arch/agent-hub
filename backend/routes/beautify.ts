/**
 * 代码美化路由
 * 使用 Anthropic SDK 调用 Claude API 对代码进行美化
 */
import { Router, Request, Response } from 'express';
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { buildBeautifyPrompt } from '../prompts/beautify';
import * as fs from 'fs';
import * as path from 'path';

function getAnthropicClient(): { client: Anthropic; model: string } {
  // Try to get API key and model from database providers table
  try {
    const db = getDb();
    const result = db.exec(
      "SELECT base_url_anthropic, api_key, id FROM providers WHERE owner_id IS NULL ORDER BY updated_at DESC LIMIT 1"
    );
    if (result.length > 0 && result[0].values.length > 0) {
      const [baseUrl, apiKey, providerId] = result[0].values[0] as [string, string, string];
      if (apiKey) {
        const config: ClientOptions = { apiKey };
        if (baseUrl) {
          config.baseURL = baseUrl;
        }
        // Try to get a model for this provider
        let model = 'claude-sonnet-4-20250514';
        try {
          const modelResult = (db as any).exec(
            "SELECT id FROM models WHERE provider_id = ? ORDER BY context_limit DESC LIMIT 1",
            [providerId]
          );
          if (modelResult.length > 0 && modelResult[0].values.length > 0) {
            model = modelResult[0].values[0][0] as string;
          }
        } catch (e) { /* use default */ }
        return { client: new Anthropic(config), model };
      }
    }
  } catch (e) {
    // Fall through to other methods
  }

  // Try to read from ~/.claude/settings.json
  try {
    const homeDir = process.env.HOME || '/root';
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const env = settings.env || {};
      const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const config: ClientOptions = { apiKey };
        if (env.ANTHROPIC_BASE_URL) {
          config.baseURL = env.ANTHROPIC_BASE_URL;
        }
        return { client: new Anthropic(config), model: 'claude-sonnet-4-20250514' };
      }
    }
  } catch (e) {
    // Fall through
  }

  // Fallback: try environment variable
  return { client: new Anthropic(), model: 'claude-sonnet-4-20250514' };
}

export default () => {
  const router = Router();

  router.post('/beautify', async (req: Request, res: Response) => {
    try {
      const { code, language, level, style, preserveFunctionality } = req.body;

      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'code 参数是必需的' });
      }

      if (!['light', 'moderate', 'aggressive'].includes(level)) {
        return res.status(400).json({ error: 'level 必须是 light、moderate 或 aggressive' });
      }

      const prompt = buildBeautifyPrompt({
        level,
        style,
        preserveFunctionality: preserveFunctionality !== false
      });

      const languageHint = language ? `\nThe code language is: ${language}` : '';

      const { client, model } = getAnthropicClient();
      const message = await client.messages.create({
        model,
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: prompt + languageHint + '\n\n```' + (language || '') + '\n' + code + '\n```'
          }
        ]
      });

      // Extract text from response
      const responseText = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      // Clean up: remove markdown code fences if present
      let beautified = responseText.trim();
      const fenceMatch = beautified.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
      if (fenceMatch) {
        beautified = fenceMatch[1];
      }

      res.json({
        original: code,
        beautified
      });
    } catch (error: any) {
      console.error('[Beautify] 美化失败:', error.message);
      res.status(500).json({ error: '代码美化失败: ' + error.message });
    }
  });

  return router;
};
