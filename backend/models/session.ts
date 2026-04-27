import { AgentBase, Subtask, SessionJSON, SessionOptions, SessionMessage } from '../types';

class Session {
  id: string;
  agent: AgentBase | null;
  agentType: string;
  workdir: string;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt?: Date;
  options: SessionOptions;
  isActive: boolean;
  conversationId: string | null;
  lastSavedMessageCount: number;
  subtasks: Subtask[];
  title?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  tags?: string[];

  constructor(id: string, agent: AgentBase | null, workdir: string, options: SessionOptions = {}) {
    this.id = id;
    this.agent = agent;
    this.workdir = workdir;
    this.messages = [];
    this.createdAt = new Date();
    this.options = options;
    this.isActive = true;
    this.conversationId = null;
    this.lastSavedMessageCount = 0;
    this.subtasks = [];
    this.agentType = 'claude-code';
  }

  toJSON(): SessionJSON {
    return {
      id: this.id,
      agentType: (this.agentType || 'claude-code') as any,
      agentName: this.agent?.name || 'unknown',
      workdir: this.workdir,
      messageCount: this.messages.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt || this.createdAt,
      options: this.options,
      isActive: this.isActive,
      conversationId: this.conversationId,
      lastMessageAt: this.messages.length > 0
        ? this.messages[this.messages.length - 1].time
        : this.createdAt as any,
      title: this.title || null,
      isPinned: this.isPinned || false,
      isArchived: this.isArchived || false,
      tags: this.tags || [],
    };
  }
}

export default Session;
