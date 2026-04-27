import { WebSocket } from 'ws';

class WSClients {
  private clients: Map<string, Set<WebSocket>>;

  constructor() {
    this.clients = new Map();
  }

  add(sessionId: string, ws: WebSocket): void {
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)!.add(ws);
  }

  remove(sessionId: string, ws: WebSocket): void {
    const clients = this.clients.get(sessionId);
    if (clients) {
      clients.delete(ws);
    }
  }

  broadcast(sessionId: string, message: Record<string, unknown>): void {
    const clients = this.clients.get(sessionId);
    if (!clients) return;

    const payload = JSON.stringify({ sessionId, ...message });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  get(sessionId: string): Set<WebSocket> | undefined {
    return this.clients.get(sessionId);
  }

  delete(sessionId: string): void {
    this.clients.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.clients.has(sessionId);
  }
}

export default WSClients;
