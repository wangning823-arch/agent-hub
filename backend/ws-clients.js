class WSClients {
  constructor() {
    this.clients = new Map();
  }

  add(sessionId, ws) {
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId).add(ws);
  }

  remove(sessionId, ws) {
    const clients = this.clients.get(sessionId);
    if (clients) {
      clients.delete(ws);
    }
  }

  broadcast(sessionId, message) {
    const clients = this.clients.get(sessionId);
    if (!clients) return;

    const payload = JSON.stringify({ sessionId, ...message });
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  get(sessionId) {
    return this.clients.get(sessionId);
  }

  delete(sessionId) {
    this.clients.delete(sessionId);
  }

  has(sessionId) {
    return this.clients.has(sessionId);
  }
}

module.exports = WSClients;