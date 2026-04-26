const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {
  router.post('/', async (req, res) => {
    try {
      const { workdir, agentType = 'claude-code', ...options } = req.body;

      if (!workdir) {
        return res.status(400).json({ error: 'workdir是必需的' });
      }

      const validAgentTypes = ['claude-code', 'opencode', 'codex'];
      if (!validAgentTypes.includes(agentType)) {
        return res.status(400).json({ error: `不支持的Agent类型: ${agentType}` });
      }

      const session = await sessionManager.createSession(workdir, agentType, options);
      res.json(session.toJSON());
    } catch (error) {
      console.error('创建会话失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/', (req, res) => {
    res.json(sessionManager.listSessions());
  });

  router.get('/:id', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    res.json(session.toJSON());
  });

  router.get('/:id/status', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const isActive = sessionManager.isAgentRunning(req.params.id);
    const isWorking = session.isWorking || false;
    const isStarting = session.isStarting || false;
    res.json({ isActive, isWorking, isStarting });
  });

router.post('/:id/stop', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }
      // 完全停止Agent
      if (session.agent) {
        try {
          await session.agent.stop();
        } catch (e) {
          console.error('停止agent失败:', e);
        }
      }
      session.isWorking = false;
      session.isStarting = false;
      sessionManager.saveSession(session);
      sessionManager.broadcast(req.params.id, { type: 'status', content: 'task_done' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/interrupt', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }
      // 中断当前任务，保持Agent可用
      if (session.agent && typeof session.agent.interrupt === 'function') {
        try {
          await session.agent.interrupt();
        } catch (e) {
          console.error('中断任务失败:', e);
        }
      }
      session.isWorking = false;
      sessionManager.saveSession(session);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await sessionManager.removeSession(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id/conversation', async (req, res) => {
    try {
      const { conversationId } = req.body;
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      session.conversationId = conversationId;
      if (session.agent) {
        session.agent.conversationId = conversationId;
      }

      sessionManager.saveData();

      res.json({ success: true, conversationId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/resume', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      console.log(`[resume] 会话 ${req.params.id} 当前状态: isActive=${session.isActive}, agentType=${session.agentType}, workdir=${session.workdir}`);

      // 如果标记为活跃但 agent 实际已停止，先重置状态
      if (session.isActive && !sessionManager.isAgentRunning(req.params.id)) {
        console.log(`[resume] 会话 ${req.params.id} 标记为活跃但agent已停止，重置状态`);
        session.isActive = false;
      }

      if (session.isActive) {
        console.log(`[resume] 会话 ${req.params.id} 已经是活跃状态，跳过`);
        return res.json({ message: '会话已经是活跃状态', session: session.toJSON() });
      }

      console.log(`[resume] 开始恢复会话 ${req.params.id}...`);
      await sessionManager.resumeSession(req.params.id);
      console.log(`[resume] 会话 ${req.params.id} 恢复成功`);

      res.json({
        message: '会话已恢复',
        session: session.toJSON()
      });
    } catch (error) {
      console.error(`[resume] 恢复会话 ${req.params.id} 失败:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id/rename', (req, res) => {
    try {
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: '标题是必需的' });
      }
      const session = sessionManager.renameSession(req.params.id, title);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/pin', (req, res) => {
    try {
      const session = sessionManager.togglePinSession(req.params.id);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/archive', (req, res) => {
    try {
      const session = sessionManager.toggleArchiveSession(req.params.id);
      res.json({ success: true, session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id/messages', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      const messages = sessionManager.getMessages(req.params.id, limit, offset);
      res.json({ messages });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id/messages', (req, res) => {
    try {
      const { time } = req.body;
      if (time === undefined || time === null) {
        return res.status(400).json({ error: '缺少消息时间戳 time 参数' });
      }
      const result = sessionManager.deleteMessageByTime(req.params.id, time);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/delete-last', (req, res) => {
    try {
      const count = req.body.count || 2;
      const result = sessionManager.deleteLastMessages(req.params.id, count);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/compact', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      if (session.agent && session.agent.send) {
        await session.agent.send('/compact');
        res.json({ success: true, message: '已发送压缩命令' });
      } else {
        res.status(400).json({ error: 'Agent不支持此操作' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id/context', (req, res) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    const messageCount = session.messages.length;
    const estimatedTokens = session.messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    res.json({
      messageCount,
      estimatedTokens,
      conversationId: session.conversationId,
      isActive: session.isActive,
      createdAt: session.createdAt
    });
  });

  router.post('/:id/summarize', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const { summarizeSession } = require('../claude-service');
      const result = await summarizeSession(session.messages, session.agentType || 'claude-code', session.workdir);

      if (req.body.compact) {
        const keepLast = Math.min(10, session.messages.length);
        const recentMessages = session.messages.slice(-keepLast);
        session.messages = [
          { role: 'user', content: `[之前对话的摘要]\n${result.summary}`, time: Date.now() },
          { role: 'assistant', content: '已了解之前的对话内容，可以继续交流。', time: Date.now() },
          ...recentMessages
        ];
        session.updatedAt = new Date();
        sessionManager.saveData();
        result.compacted = true;
      }

      res.json(result);
    } catch (error) {
      console.error('总结会话失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 按需恢复记忆：生成摘要并注入到会话历史
  router.post('/:id/restore-memory', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      if (session.messages.length < 5) {
        return res.json({ success: true, message: '消息太少，无需恢复', summary: null });
      }

      // 检查是否已有摘要
      const hasSummary = session.messages.some(m =>
        m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[之前对话的摘要]')
      );
      if (hasSummary) {
        // 已有摘要，但如果 agent 在运行，仍然注入到 pendingHistory
        if (session.agent && session.agent.isRunning) {
          const summaryMsg = session.messages.find(m =>
            m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[之前对话的摘要]')
          );
          if (summaryMsg) {
            session.agent.pendingHistory = summaryMsg.content;
          }
        }
        return res.json({ success: true, message: '已有摘要，已注入到当前对话', summary: null });
      }

      const { summarizeSession } = require('../claude-service');
      const result = await summarizeSession(session.messages, session.agentType || 'claude-code', session.workdir);

      const summaryContent = `[之前对话的摘要]\n${result.summary}`;

      // 保留最近10条，其余用摘要替代
      const keepLast = Math.min(10, session.messages.length);
      const recentMessages = session.messages.slice(-keepLast);
      session.messages = [
        { role: 'user', content: summaryContent, time: Date.now() },
        { role: 'assistant', content: '已了解之前的对话内容，可以继续交流。', time: Date.now() },
        ...recentMessages
      ];
      session.updatedAt = new Date();
      sessionManager.saveSession(session);

      // 如果 agent 正在运行，直接注入到 pendingHistory，下一条消息就会带上摘要上下文
      if (session.agent && session.agent.isRunning) {
        session.agent.pendingHistory = summaryContent;
      }

      res.json({ success: true, summary: result.summary });
    } catch (error) {
      console.error('恢复记忆失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/review', async (req, res) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const { execFileSync } = require('child_process');
      let diff;
      try {
        diff = execFileSync('git', ['diff'], {
          cwd: session.workdir,
          encoding: 'utf8',
          maxBuffer: 5 * 1024 * 1024
        });
      } catch (e) {
        return res.json({ review: '无法获取 git diff，可能不在 git 仓库中或没有未提交的更改。' });
      }

      if (!diff || !diff.trim()) {
        return res.json({ review: '没有检测到代码变更，无需审查。' });
      }

      const { reviewCode } = require('../claude-service');
      const result = await reviewCode(diff, session.workdir);
      res.json(result);
    } catch (error) {
      console.error('代码审查失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};