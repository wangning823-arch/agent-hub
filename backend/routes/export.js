const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {
  router.get('/session/:id', (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const title = session.title || session.workdir.split('/').pop();
      const createdAt = new Date(session.createdAt).toLocaleString('zh-CN');

      let markdown = `# ${title}\n\n`;
      markdown += `- **项目路径**: ${session.workdir}\n`;
      markdown += `- **创建时间**: ${createdAt}\n`;
      markdown += `- **消息数量**: ${session.messages.length}\n\n`;
      markdown += `---\n\n`;

      for (const msg of session.messages) {
        const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
        const time = new Date(msg.time).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        });
        const content = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content, null, 2);

        markdown += `### ${role} (${time})\n\n${content}\n\n---\n\n`;
      }

      const filename = `${title}_${new Date().toISOString().slice(0, 10)}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(markdown);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/sessions', (req, res) => {
    try {
      const sessions = sessionManager.listSessions();

      const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        sessions: sessions.map(s => ({
          id: s.id,
          title: s.title,
          workdir: s.workdir,
          agentName: s.agentName,
          messageCount: s.messageCount,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          isPinned: s.isPinned,
          isArchived: s.isArchived,
          conversationId: s.conversationId
        }))
      };

      const filename = `agent-hub-backup_${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.json(exportData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sessions', (req, res) => {
    const { sessions: importedSessions, overwrite = false } = req.body;

    if (!importedSessions || !Array.isArray(importedSessions)) {
      return res.status(400).json({ error: '无效的备份数据' });
    }

    try {
      const results = {
        imported: 0,
        skipped: 0,
        errors: []
      };

      const existingSessions = sessionManager.listSessions();

      for (const sessionData of importedSessions) {
        try {
          const exists = existingSessions.find(s =>
            s.id === sessionData.id ||
            (s.workdir === sessionData.workdir && s.title === sessionData.title)
          );

          if (exists && !overwrite) {
            results.skipped++;
            continue;
          }

          const newSession = {
            id: sessionData.id || require('uuid').v4(),
            workdir: sessionData.workdir,
            agentType: sessionData.agentName === 'Claude Code' ? 'claude-code' :
              sessionData.agentName === 'Codex' ? 'codex' : 'opencode',
            title: sessionData.title,
            isPinned: sessionData.isPinned || false,
            isArchived: sessionData.isArchived || false,
            conversationId: sessionData.conversationId,
            messages: [],
            createdAt: new Date(sessionData.createdAt || Date.now()),
            updatedAt: new Date(sessionData.updatedAt || Date.now())
          };

          sessionManager.sessions.set(newSession.id, newSession);
          results.imported++;
        } catch (err) {
          results.errors.push({
            session: sessionData.title || sessionData.id,
            error: err.message
          });
        }
      }

      sessionManager.saveData();

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};