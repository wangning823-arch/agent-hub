const ClaudeCodeAgent = require('./claude-code');
const OpenCodeAgent = require('./opencode');
const CodexAgent = require('./codex');

const AGENT_CLASSES = {
  'claude-code': ClaudeCodeAgent,
  'opencode': OpenCodeAgent,
  'codex': CodexAgent
};

function createAgent(workdir, agentType, options = {}) {
  const AgentClass = AGENT_CLASSES[agentType];
  if (!AgentClass) {
    throw new Error(`未知的Agent类型: ${agentType}，支持的类型: ${Object.keys(AGENT_CLASSES).join(', ')}`);
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
        const msg = { role: m.role };
        // 保持 content 的原始格式（数组或字符串）
        if (typeof m.content === 'string') {
          msg.content = m.content;
        } else if (Array.isArray(m.content)) {
          msg.content = m.content;
        } else {
          msg.content = JSON.stringify(m.content);
        }
        // 保留 time 字段
        if (m.time) msg.time = m.time;
        return msg;
      });
  }
}

module.exports = { createAgent, getAgentTypes, resumeAgentMessages };