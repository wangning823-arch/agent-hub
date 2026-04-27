/**
 * 会话摘要服务
 * 提供会话对话历史的摘要生成功能（各 agent 使用自己的 CLI）
 */
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import { SessionMessage, AgentType } from './types';

interface SummaryResult {
  summary: string;
}

// 查找 opencode 路径（复用 opencode.js 的逻辑）
function _findOpencodePath(): string {
  const candidates = [
    '/home/root1/.npm-global/lib/node_modules/opencode-ai/bin/.opencode',
    '/usr/local/lib/node_modules/opencode-ai/bin/.opencode',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8' }).trim();
    const binPath = prefix + '/lib/node_modules/opencode-ai/bin/.opencode';
    if (fs.existsSync(binPath)) return binPath;
  } catch (e) {}
  try {
    const p = execSync('which opencode 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (p) return p;
  } catch (e) {}
  return 'opencode';
}

function _getEnvWithPath(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8' }).trim();
    const binDir = prefix + '/bin';
    if (env.PATH && !env.PATH.includes(binDir)) {
      env.PATH = binDir + ':' + env.PATH;
    }
  } catch (e) {}
  return env;
}

/**
 * 用 claude CLI 生成摘要
 */
async function summarizeWithClaudeCode(messages: SessionMessage[], workdir?: string): Promise<SummaryResult> {
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const role = m.role === 'user' ? '用户' : '助手';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${role}]: ${content}`;
    })
    .join('\n\n');

  const prompt = `请简洁地总结以下对话的要点，保留关键决策和技术细节，用中文回答：\n\n${conversationText}`;

  const claudeBin = process.env.CLAUDE_CLI_PATH || 'claude';

  return new Promise((resolve, reject) => {
    const proc = spawn(claudeBin, [
      '--print',
      '--dangerously-skip-permissions',
      '-p', prompt
    ], {
      cwd: workdir || process.env.HOME || '/root',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: 60000
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const summary = stdout.trim();
      if (summary) {
        resolve({ summary });
      } else if (code !== 0) {
        reject(new Error(`Claude CLI 摘要生成失败: ${stderr || 'exit ' + code}`));
      } else {
        resolve({ summary: '无法生成摘要' });
      }
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`Claude CLI 摘要生成失败: ${err.message}`));
    });
  });
}

/**
 * 用 opencode CLI 生成摘要
 */
async function summarizeWithOpenCode(messages: SessionMessage[], workdir?: string): Promise<SummaryResult> {
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const role = m.role === 'user' ? '用户' : '助手';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${role}]: ${content}`;
    })
    .join('\n\n');

  const prompt = `请简洁地总结以下对话的要点，保留关键决策和技术细节，用中文回答：\n\n${conversationText}`;

  const opencodePath = _findOpencodePath();
  const env = _getEnvWithPath();

  return new Promise((resolve, reject) => {
    const args = ['run', '--pure', '--format', 'json', prompt];
    const proc = spawn(opencodePath, args, {
      cwd: workdir || process.env.HOME || '/root',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    });
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // 尝试从 JSON 输出中提取文本
      const lines = stdout.split('\n');
      let summary = '';
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'text' && msg.part?.text) {
            summary += msg.part.text;
          }
        } catch (e) {}
      }
      if (summary) {
        resolve({ summary });
      } else if (code !== 0) {
        reject(new Error(`OpenCode 摘要生成失败: ${stderr || 'exit ' + code}`));
      } else {
        resolve({ summary: stdout.trim() || '无法生成摘要' });
      }
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`OpenCode 摘要生成失败: ${err.message}`));
    });
  });
}

/**
 * 总结会话对话历史
 * @param messages - 会话消息列表 [{role, content, time}]
 * @param agentType - agent 类型 ('claude-code' | 'opencode')
 * @param workdir - 工作目录（opencode 需要）
 */
async function summarizeSession(messages: SessionMessage[], agentType: AgentType = 'claude-code', workdir?: string): Promise<SummaryResult> {
  // 各 agent 用自己 CLI 生成摘要，不依赖 Anthropic SDK
  if (agentType === 'opencode') {
    return summarizeWithOpenCode(messages, workdir);
  }
  // claude-code 用 claude CLI
  return summarizeWithClaudeCode(messages, workdir);
}

export { summarizeSession };
