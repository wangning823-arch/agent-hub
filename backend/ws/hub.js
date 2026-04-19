// Phase0: WebSocket hub skeleton
// 未来将由 SessionManager/WS 事件驱动，负责集中管理会话的 WebSocket 连接与广播。
class WebSocketHub {
  constructor() {
    this.sessions = new Map(); // sessionId -> Set<ws>
  }

  register(sessionId, ws) {
    if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, new Set());
    this.sessions.get(sessionId).add(ws);
  }

  unregister(sessionId, ws) {
    const set = this.sessions.get(sessionId);
    if (set) set.delete(ws);
  }

  broadcast(sessionId, message) {
    const set = this.sessions.get(sessionId);
    if (!set) return;
    for (const ws of set) {
      try { ws.send(JSON.stringify({ type: 'text', content: message })); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = WebSocketHub;
