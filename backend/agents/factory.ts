import ClaudeCodeAgent from './claude-code';
import OpenCodeAgent from './opencode';
import CodexAgent from './codex';
import Agent from './base';
import { AgentType, AgentOptions, SessionMessage } from '../types';

const AGENT_CLASSES: Record<AgentType, typeof Agent> = {
  'claude-code': ClaudeCodeAgent as any,
  'opencode': OpenCodeAgent as any,
  'codex': CodexAgent as any,
};

function createAgent(workdir: string, agentType: AgentType, options: AgentOptions = {}): Agent {
  const AgentClass = AGENT_CLASSES[agentType];
  if (!AgentClass) {
    throw new Error(`未知的Agent类型: ${agentType}，支持的类型: ${Object.keys(AGENT_CLASSES).join(', ')}`);
  }
  return new AgentClass(workdir, options as any);
}

function getAgentTypes(): string[] {
  return Object.keys(AGENT_CLASSES);
}

function resumeAgentMessages(agent: any, messages: SessionMessage[]): void {
  if (agent.messages && messages.length > 0) {
    agent.messages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const msg: Record<string, unknown> = { role: m.role };
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

export { createAgent, getAgentTypes, resumeAgentMessages };
