import express, { Router, Request, Response } from 'express';
import type { SessionData, AgentBase } from '../types/index';

export default (sessionManager: any) => { // TODO: type this
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
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
    } catch (error: any) {
      console.error('创建会话失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/', (_req: Request, res: Response) => {
    res.json(sessionManager.listSessions());
  });

  router.get('/:id', (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    res.json(session.toJSON());
  });

  router.get('/:id/status', (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    const isActive = sessionManager.isAgentRunning(req.params.id);
    const isWorking = session.isWorking || false;
    const isStarting = session.isStarting || false;
    res.json({ isActive, isWorking, isStarting });
  });

  router.post('/:id/stop', async (req: Request, res: Response) => {
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/interrupt', async (req: Request, res: Response) => {
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await sessionManager.removeSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id/conversation', async (req: Request, res: Response) => {
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/resume', async (req: Request, res: Response) => {
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
    } catch (error: any) {
      console.error(`[resume] 恢复会话 ${req.params.id} 失败:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id/rename', (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: '标题是必需的' });
      }
      const session = sessionManager.renameSession(req.params.id, title);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/pin', (req: Request, res: Response) => {
    try {
      const session = sessionManager.togglePinSession(req.params.id);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/archive', (req: Request, res: Response) => {
    try {
      const session = sessionManager.toggleArchiveSession(req.params.id);
      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id/messages', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const messages = sessionManager.getMessages(req.params.id, limit, offset);
      res.json({ messages });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id/messages', (req: Request, res: Response) => {
    try {
      const { time } = req.body;
      if (time === undefined || time === null) {
        return res.status(400).json({ error: '缺少消息时间戳 time 参数' });
      }
      const result = sessionManager.deleteMessageByTime(req.params.id, time);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/delete-last', (req: Request, res: Response) => {
    try {
      const count = req.body.count || 2;
      const result = sessionManager.deleteLastMessages(req.params.id, count);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/compact', async (req: Request, res: Response) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      if (!session.agent) {
        return res.status(400).json({ error: 'Agent不支持此操作' });
      }

      // OpenCode 不支持 /compact，通过重启会话并恢复记忆来清空上下文
      if (session.agentType === 'opencode') {
        const agent = session.agent as any;
        // 重置 opencode 会话 ID
        if (agent.opencodeSessionId) {
          agent.opencodeSessionId = null;
        }
        // 恢复记忆：生成摘要并注入到 pendingHistory
        if (session.messages.length >= 5) {
          const { summarizeSession } = require('../summary-service');
          const result = await summarizeSession(session.messages, 'opencode', session.workdir);
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
          // 注入摘要到 pendingHistory，下一条消息会带上
          agent.pendingHistory = summaryContent;
        }
        res.json({ success: true, message: '上下文已重置并恢复记忆', contextUsage: null });
        return;
      }

      if (session.agent.send) {
        // 检查 agent 是否正在执行任务
        if ((session as any).isWorking) {
          // 返回成功但附带警告，让前端显示提示而不是错误
          return res.json({ success: true, message: 'agent正在执行任务，压缩将在任务完成后生效', contextUsage: null, pending: true });
        }

        await session.agent.send('/compact');

        // 压缩完成后，发送 /context 获取最新的上下文使用量
        let contextUsage: string | null = null;
        try {
          const contextPromise = new Promise<string | null>((resolve) => {
            const handler = (msg: any) => { // TODO: type this
              if (msg.type === 'context_usage') {
                session.agent.removeListener('message', handler);
                resolve(msg.content);
              }
            };
            session.agent.on('message', handler);
            // 超时 15 秒
            setTimeout(() => {
              session.agent.removeListener('message', handler);
              resolve(null);
            }, 15000);
          });
          await session.agent.send('/context');
          contextUsage = await contextPromise;
        } catch (_) {}
        res.json({ success: true, message: '压缩完成', contextUsage });
      } else {
        res.status(400).json({ error: 'Agent不支持此操作' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id/context', (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    const messageCount = session.messages.length;
    const estimatedTokens = session.messages.reduce((sum: number, msg: any) => { // TODO: type this
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

  router.post('/:id/summarize', async (req: Request, res: Response) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const { summarizeSession } = require('../summary-service');
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
    } catch (error: any) {
      console.error('总结会话失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 按需恢复记忆：生成摘要并注入到会话历史
  router.post('/:id/restore-memory', async (req: Request, res: Response) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      if (session.messages.length < 5) {
        return res.json({ success: true, message: '消息太少，无需恢复', summary: null });
      }

      // 检查是否已有摘要
      const hasSummary = session.messages.some((m: any) => // TODO: type this
        m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[之前对话的摘要]')
      );
      if (hasSummary) {
        // 已有摘要，但如果 agent 在运行，仍然注入到 pendingHistory
        if (session.agent && session.agent.isRunning) {
          const summaryMsg = session.messages.find((m: any) => // TODO: type this
            m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[之前对话的摘要]')
          );
          if (summaryMsg) {
            session.agent.pendingHistory = summaryMsg.content;
          }
        }
        return res.json({ success: true, message: '已有摘要，已注入到当前对话', summary: null });
      }

      const { summarizeSession } = require('../summary-service');
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
    } catch (error: any) {
      console.error('恢复记忆失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 子任务 API ====================

  // 分析任务并返回子任务列表
  router.post('/:id/split', async (req: Request, res: Response) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: '消息内容是必需的' });
      }

      const result = await sessionManager.executeSplitAnalysis(req.params.id, message);
      if (!result) {
        return res.status(500).json({ error: '任务分析失败，请重试' });
      }

      // 生成子任务列表并存入 session
      if (result.shouldSplit && result.tasks && result.tasks.length > 0) {
        const subtasks = result.tasks.map((t: any, i: number) => ({ // TODO: type this
          id: `st_${Date.now()}_${i}`,
          description: t.description,
          status: 'pending',
          result: null,
          messages: [],
          model: null,
          complexity: t.complexity || 'medium',
          error: null,
          createdAt: Date.now(),
          completedAt: null
        }));
        session.subtasks = subtasks;
        sessionManager.saveSession(session);
        // 返回完整的子任务列表（含 ID），前端直接使用
        result.subtasks = subtasks;
      }

      res.json(result);
    } catch (error: any) {
      console.error('任务拆分分析失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 获取子任务列表
  router.get('/:id/subtasks', (req: Request, res: Response) => {
    try {
      const subtasks = sessionManager.getSubtasks(req.params.id);
      res.json({ subtasks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 并行执行所有 pending 子任务
  router.post('/:id/subtasks/execute-all', async (req: Request, res: Response) => {
    try {
      sessionManager.executeAllSubtasks(req.params.id).catch((err: any) => { // TODO: type this
        console.error('执行子任务失败:', err);
      });
      res.json({ success: true, message: '子任务开始执行' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 执行单个子任务
  router.post('/:id/subtasks/:subtaskId/execute', async (req: Request, res: Response) => {
    try {
      sessionManager.executeSubtask(req.params.id, req.params.subtaskId).catch((err: any) => { // TODO: type this
        console.error('执行子任务失败:', err);
      });
      res.json({ success: true, message: '子任务开始执行' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 取消子任务
  router.post('/:id/subtasks/:subtaskId/cancel', (req: Request, res: Response) => {
    try {
      sessionManager.cancelSubtask(req.params.id, req.params.subtaskId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 更新子任务
  router.put('/:id/subtasks/:subtaskId', (req: Request, res: Response) => {
    try {
      const subtask = sessionManager.updateSubtask(req.params.id, req.params.subtaskId, req.body);
      res.json({ success: true, subtask });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 删除子任务
  router.delete('/:id/subtasks/:subtaskId', (req: Request, res: Response) => {
    try {
      sessionManager.deleteSubtask(req.params.id, req.params.subtaskId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
