// Phase0: Data access object skeleton for sessions (DB-agnostic)
class SessionDAO {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }
  createSession(data) { throw new Error('Not implemented'); }
  getSession(id) { throw new Error('Not implemented'); }
  updateSession(id, updates) { throw new Error('Not implemented'); }
  listSessions() { throw new Error('Not implemented'); }
}

module.exports = SessionDAO;
