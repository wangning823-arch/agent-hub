class Session {
  constructor(id, agent, workdir, options = {}) {
    this.id = id;
    this.agent = agent;
    this.workdir = workdir;
    this.messages = [];
    this.createdAt = new Date();
    this.options = options;
    this.isActive = true;
    this.conversationId = null;
  }

  toJSON() {
    return {
      id: this.id,
      agentType: this.agentType || 'claude-code',
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
        : this.createdAt,
      title: this.title || null,
      isPinned: this.isPinned || false,
      isArchived: this.isArchived || false,
      tags: this.tags || []
    };
  }
}

module.exports = Session;