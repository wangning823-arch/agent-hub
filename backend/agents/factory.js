const ClaudeCodeAgent = require('./claude-code');
const ClaudeApiAgent = require('./claude-api');
const OpenCodeAgent = require('./opencode');
const CodexAgent = require('./codex');

const AGENT_CLASSES = {
  'claude-code': ClaudeCodeAgent,
  'claude-api': ClaudeApiAgent,
  'opencode': OpenCodeAgent,
  'codex': CodexAgent
};

function createAgent(workdir, agentType, options = {}) {
  const AgentClass = AGENT_CLASSES[agentType];
  if (!AgentClass) {
    throw new Error(`未知的Agent类型: ${agentType}`);
  }
  return new AgentClass(workdir, options);
}

function getAgentTypes() {
  return Object.keys(AGENT_CLASSES);
}

function resumeAgentMessages(agent, messages) {
  if (agent.messages && messages.length > 0) {
    agent.messages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        // 保持 content 的原始格式（数组或字符串）
        if (typeof m.content === 'string') {
          return { role: m.role, content: m.content };
        }
        // 如果是数组（包含 tool_use/tool_result），直接保留
        if (Array.isArray(m.content)) {
          return { role: m.role, content: m.content };
        }
        // 其他情况 stringify
        return { role: m.role, content: JSON.stringify(m.content) };
      });
  }
}

module.exports = { createAgent, getAgentTypes, resumeAgentMessages };