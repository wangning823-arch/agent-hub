/**
 * Claude 独立服务
 * 提供一次性 Claude API 调用功能（总结、代码审查、标题生成）
 */
const client = require('./claude-client');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 查找 opencode 路径（复用 opencode.js 的逻辑）
function _findOpencodePath() {
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

function _getEnvWithPath() {
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
async function summarizeWithClaudeCode(messages, workdir) {
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
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

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

    proc.on('error', (err) => {
      reject(new Error(`Claude CLI 摘要生成失败: ${err.message}`));
    });
  });
}

/**
 * 用 opencode CLI 生成摘要
 */
async function summarizeWithOpenCode(messages, workdir) {
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
    const shellArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const proc = spawn('sh', ['-c', `${opencodePath} ${shellArgs} < /dev/null`], {
      cwd: workdir || process.env.HOME || '/root',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

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

    proc.on('error', (err) => {
      reject(new Error(`OpenCode 摘要生成失败: ${err.message}`));
    });
  });
}

/**
 * 总结会话对话历史
 * @param {Array} messages - 会话消息列表 [{role, content, time}]
 * @param {string} agentType - agent 类型 ('claude-code' | 'opencode')
 * @param {string} workdir - 工作目录（opencode 需要）
 * @returns {Promise<{summary: string}>}
 */
async function summarizeSession(messages, agentType = 'claude-code', workdir) {
  // 各 agent 用自己 CLI 生成摘要，不依赖 Anthropic SDK
  if (agentType === 'opencode') {
    return summarizeWithOpenCode(messages, workdir);
  }
  // claude-code 用 claude CLI
  return summarizeWithClaudeCode(messages, workdir);
}

/**
 * 代码审查
 * @param {string} diff - git diff 输出
 * @param {string} workdir - 工作目录路径
 * @returns {Promise<{review: string}>}
 */
async function reviewCode(diff, workdir) {
  if (!diff || !diff.trim()) {
    return { review: '没有检测到代码变更，无需审查。' };
  }

  // 截断过大的 diff（保留前后各 5000 行）
  const lines = diff.split('\n');
  let truncatedDiff = diff;
  if (lines.length > 10000) {
    const head = lines.slice(0, 5000).join('\n');
    const tail = lines.slice(-5000).join('\n');
    truncatedDiff = `${head}\n\n... [已截断 ${lines.length - 10000} 行] ...\n\n${tail}`;
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: `你是一个专业的代码审查专家。请审查以下代码变更，关注：
1. 潜在的 bug 和逻辑错误
2. 安全漏洞
3. 性能问题
4. 代码风格和最佳实践
5. 可读性和可维护性

请用中文回复，格式清晰，列出具体问题和改进建议。如果没有问题，也要说明代码质量良好。`,
    messages: [
      {
        role: 'user',
        content: `项目目录: ${workdir}\n\nGit Diff:\n\`\`\`diff\n${truncatedDiff}\n\`\`\``
      }
    ]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return { review: textBlock?.text || '无法生成审查报告' };
}

/**
 * 生成会话标题
 * @param {string} firstUserMessage - 用户的第一条消息
 * @param {string} firstAssistantMessage - 助手的第一条回复
 * @returns {Promise<{title: string}>}
 */
async function generateTitle(firstUserMessage, firstAssistantMessage) {
  // 截断过长的内容
  const userMsg = (firstUserMessage || '').slice(0, 500);
  const asstMsg = (firstAssistantMessage || '').slice(0, 500);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: `根据以下对话内容，生成一个简短的会话标题（不超过30个字，不要加引号）：\n\n用户: ${userMsg}\n助手: ${asstMsg}`
      }
    ]
  });

  let title = response.content.find(b => b.type === 'text')?.text || '';
  // 清理标题（去除引号、多余空格）
  title = title.replace(/^["'"「]|["'"」]$/g, '').trim();
  // 限制长度
  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }

  return { title: title || '新会话' };
}

module.exports = { summarizeSession, reviewCode, generateTitle };
