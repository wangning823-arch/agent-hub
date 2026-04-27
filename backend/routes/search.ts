import { Router, Request, Response } from 'express';

export default (sessionManager: any) => { // TODO: type this
  const router = Router();

  router.get('/messages', (req: Request, res: Response) => {
    const query = req.query.query as string;
    const sessionId = req.query.sessionId as string;
    const limit = (req.query.limit as string) || '50';

    if (!query) {
      return res.status(400).json({ error: 'query参数是必需的' });
    }

    try {
      const results: any[] = []; // TODO: type this
      const searchLower = query.toLowerCase();

      const sessions = sessionManager.listSessions();

      for (const session of sessions) {
        if (sessionId && session.id !== sessionId) continue;

        const sessionData = sessionManager.getSession(session.id);
        if (!sessionData || !sessionData.messages) continue;

        for (const [index, msg] of sessionData.messages.entries()) {
          const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);

          if (content.toLowerCase().includes(searchLower)) {
            const contentLower = content.toLowerCase();
            const matchIndex = contentLower.indexOf(searchLower);
            const start = Math.max(0, matchIndex - 50);
            const end = Math.min(content.length, matchIndex + query.length + 50);
            const snippet = (start > 0 ? '...' : '') +
              content.slice(start, end) +
              (end < content.length ? '...' : '');

            results.push({
              sessionId: session.id,
              sessionTitle: session.title || session.workdir.split('/').pop(),
              messageIndex: index,
              role: msg.role,
              snippet,
              timestamp: msg.time,
              matchCount: (contentLower.match(new RegExp(searchLower, 'g')) || []).length
            });
          }

          if (results.length >= parseInt(limit)) break;
        }

        if (results.length >= parseInt(limit)) break;
      }

      results.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({
        query,
        total: results.length,
        results: results.slice(0, parseInt(limit))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/sessions', (req: Request, res: Response) => {
    const query = req.query.query as string;
    const limit = (req.query.limit as string) || '20';

    if (!query) {
      return res.status(400).json({ error: 'query参数是必需的' });
    }

    try {
      const searchLower = query.toLowerCase();
      const sessions = sessionManager.listSessions();

      const results = sessions
        .filter((session: any) => { // TODO: type this
          const title = (session.title || '').toLowerCase();
          const workdir = session.workdir.toLowerCase();
          return title.includes(searchLower) || workdir.includes(searchLower);
        })
        .slice(0, parseInt(limit))
        .map((session: any) => ({ // TODO: type this
          id: session.id,
          title: session.title || session.workdir.split('/').pop(),
          workdir: session.workdir,
          messageCount: session.messageCount,
          lastMessageAt: session.lastMessageAt,
          isPinned: session.isPinned
        }));

      res.json({
        query,
        total: results.length,
        results
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
