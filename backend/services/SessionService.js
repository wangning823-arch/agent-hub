// Phase0: Session service skeleton (decoupled from persistence)
class SessionService {
  constructor() {
    // TODO: future in-memory store or DB-backed store
  }

  async createSession(workdir, agentType, options = {}) {
    // placeholder
    return { id: 'phase0-temp-session', workdir, agentType, options };
  }

  async getSession(id) {
    // placeholder
    return null;
  }
}

module.exports = SessionService;
