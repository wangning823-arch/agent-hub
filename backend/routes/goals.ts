/**
 * Goals REST API 路由
 * 管理目标监控任务
 */
import { Router, Request, Response } from 'express';
import GoalMonitor from '../goal-monitor';

export default (goalMonitor: GoalMonitor) => {
  const router = Router();

  /**
   * POST /api/goals - 创建监控目标
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { sessionId, originalPrompt, maxAttempts = 10 } = req.body;

      if (!sessionId || !originalPrompt) {
        return res.status(400).json({ error: 'sessionId 和 originalPrompt 是必需的' });
      }

      // 获取会话信息
      const sessionManager = goalMonitor.getSessionManager();
      if (!sessionManager) {
        return res.status(500).json({ error: 'SessionManager 未初始化' });
      }
      
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const goal = await goalMonitor.createGoal({
        sessionId,
        originalPrompt,
        maxAttempts,
        agentType: session.agentType || 'claude-code',
        workdir: session.workdir,
      });

      res.json(goal);
    } catch (error: any) {
      console.error('创建目标失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/goals - 列出所有目标
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const goals = goalMonitor.listGoals(status as any);
      res.json({ goals });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/goals/:id - 获取目标详情
   */
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const goal = goalMonitor.getGoal(req.params.id);
      if (!goal) {
        return res.status(404).json({ error: '目标不存在' });
      }
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/goals/:id - 更新目标
   */
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { maxAttempts } = req.body;
      const success = goalMonitor.updateGoal(req.params.id, { maxAttempts });
      if (!success) {
        return res.status(404).json({ error: '目标不存在或已完成' });
      }
      const goal = goalMonitor.getGoal(req.params.id);
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/goals/:id - 取消目标
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const success = goalMonitor.cancelGoal(req.params.id);
      if (!success) {
        return res.status(404).json({ error: '目标不存在' });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/goals/session/:sessionId - 获取会话关联的目标
   */
  router.get('/session/:sessionId', (req: Request, res: Response) => {
    try {
      const goal = goalMonitor.getGoalBySession(req.params.sessionId);
      res.json(goal || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
