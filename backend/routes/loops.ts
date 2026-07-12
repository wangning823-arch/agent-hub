import { Router, Request, Response } from 'express';
import type SessionManager from '../sessions';
import LoopStore from '../loop-store';
import type { LoopDefinition, LoopStepDef } from '../types';

export default function loopsRouter(sessionManager: SessionManager): Router {
  const router = Router();

  // ==================== 循环定义 CRUD ====================

  /**
   * 创建循环定义
   */
  router.post('/sessions/:sessionId/loop-defs', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { name, description, steps, maxIterations, exitCondition, exitConditionType, delayBetweenIterations } = req.body;

      if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
        return res.status(400).json({ error: 'name 和 steps 是必需的' });
      }

      // 验证步骤格式
      for (const step of steps) {
        if (!step.id || !step.name || !step.prompt) {
          return res.status(400).json({ error: '每个步骤必须包含 id、name 和 prompt' });
        }
      }

      const def = LoopStore.createDefinition({
        name,
        description: description || '',
        steps,
        maxIterations,
        exitCondition,
        exitConditionType,
        delayBetweenIterations,
      });

      const saved = sessionManager.saveLoopDef(sessionId, def);
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 获取循环定义列表
   */
  router.get('/sessions/:sessionId/loop-defs', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const defs = sessionManager.getLoopDefs(sessionId);
      res.json({ defs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 更新循环定义
   */
  router.put('/sessions/:sessionId/loop-defs/:defId', (req: Request, res: Response) => {
    try {
      const { sessionId, defId } = req.params;
      const updates = req.body;

      const updated = sessionManager.updateLoopDef(sessionId, defId, updates);
      if (!updated) {
        return res.status(404).json({ error: '循环定义不存在' });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 删除循环定义
   */
  router.delete('/sessions/:sessionId/loop-defs/:defId', (req: Request, res: Response) => {
    try {
      const { sessionId, defId } = req.params;
      const success = sessionManager.deleteLoopDef(sessionId, defId);
      if (!success) {
        return res.status(404).json({ error: '循环定义不存在' });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 循环运行 CRUD ====================

  /**
   * 启动循环运行
   */
  router.post('/sessions/:sessionId/loops', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { defId } = req.body;

      if (!defId) {
        return res.status(400).json({ error: 'defId 是必需的' });
      }

      // 获取循环定义
      const defs = sessionManager.getLoopDefs(sessionId);
      const def = defs.find(d => d.id === defId);
      if (!def) {
        return res.status(404).json({ error: '循环定义不存在' });
      }

      // 检查是否已有运行中的循环
      const loops = sessionManager.getLoops(sessionId);
      const runningLoop = loops.find(l => l.status === 'running');
      if (runningLoop) {
        return res.status(400).json({ error: '已有运行中的循环，请先停止' });
      }

      // 创建循环运行
      const run = LoopStore.createRun(def);
      sessionManager.saveLoop(sessionId, run);

      // 启动循环引擎
      if (sessionManager.loopEngine) {
        sessionManager.loopEngine.start(sessionId, run, def).catch((err: any) => {
          console.error('[循环] 执行失败:', err);
        });
      }

      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 获取循环运行列表
   */
  router.get('/sessions/:sessionId/loops', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const loops = sessionManager.getLoops(sessionId);
      res.json({ loops });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 暂停循环
   */
  router.post('/sessions/:sessionId/loops/:loopId/pause', (req: Request, res: Response) => {
    try {
      const { sessionId, loopId } = req.params;
      const run = sessionManager.getLoop(sessionId, loopId);
      if (!run) {
        return res.status(404).json({ error: '循环运行不存在' });
      }
      if (run.status !== 'running') {
        return res.status(400).json({ error: '循环未在运行中' });
      }

      if (sessionManager.loopEngine) {
        sessionManager.loopEngine.pause(sessionId, run);
      }
      sessionManager.saveLoop(sessionId, run);
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 取消循环
   */
  router.post('/sessions/:sessionId/loops/:loopId/cancel', (req: Request, res: Response) => {
    try {
      const { sessionId, loopId } = req.params;
      const run = sessionManager.getLoop(sessionId, loopId);
      if (!run) {
        return res.status(404).json({ error: '循环运行不存在' });
      }
      if (run.status !== 'running' && run.status !== 'paused') {
        return res.status(400).json({ error: '循环未在运行或暂停状态' });
      }

      if (sessionManager.loopEngine) {
        sessionManager.loopEngine.cancel(sessionId, run);
      }
      sessionManager.saveLoop(sessionId, run);
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 重试循环
   */
  router.post('/sessions/:sessionId/loops/:loopId/retry', async (req: Request, res: Response) => {
    try {
      const { sessionId, loopId } = req.params;
      const run = sessionManager.getLoop(sessionId, loopId);
      if (!run) {
        return res.status(404).json({ error: '循环运行不存在' });
      }
      if (run.status !== 'error') {
        return res.status(400).json({ error: '只有错误状态的循环可以重试' });
      }

      // 获取循环定义
      const defs = sessionManager.getLoopDefs(sessionId);
      const def = defs.find(d => d.id === run.defId);
      if (!def) {
        return res.status(404).json({ error: '循环定义不存在' });
      }

      if (sessionManager.loopEngine) {
        await sessionManager.loopEngine.retryIteration(sessionId, run, def);
      }
      sessionManager.saveLoop(sessionId, run);
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 删除循环运行
   */
  router.delete('/sessions/:sessionId/loops/:loopId', (req: Request, res: Response) => {
    try {
      const { sessionId, loopId } = req.params;
      const run = sessionManager.getLoop(sessionId, loopId);
      if (run && run.status === 'running') {
        return res.status(400).json({ error: '不能删除运行中的循环' });
      }

      const success = sessionManager.deleteLoop(sessionId, loopId);
      if (!success) {
        return res.status(404).json({ error: '循环运行不存在' });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== 循环调度 ====================

  /**
   * 创建循环调度
   */
  router.post('/sessions/:sessionId/loop-schedules', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { defId, scheduledAt, recurrence } = req.body;

      if (!defId || !scheduledAt) {
        return res.status(400).json({ error: 'defId 和 scheduledAt 是必需的' });
      }

      if (typeof scheduledAt !== 'number' || scheduledAt <= Date.now()) {
        return res.status(400).json({ error: 'scheduledAt 必须是未来的时间戳' });
      }

      // 验证循环定义存在
      const defs = sessionManager.getLoopDefs(sessionId);
      if (!defs.find(d => d.id === defId)) {
        return res.status(404).json({ error: '循环定义不存在' });
      }

      if (!sessionManager.loopScheduler) {
        return res.status(500).json({ error: '循环调度器未初始化' });
      }

      const schedule = sessionManager.loopScheduler.schedule(sessionId, defId, scheduledAt, recurrence);
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 获取循环调度列表
   */
  router.get('/sessions/:sessionId/loop-schedules', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      if (!sessionManager.loopScheduler) {
        return res.json({ schedules: [] });
      }
      const schedules = sessionManager.loopScheduler.getSchedules(sessionId);
      res.json({ schedules });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 取消循环调度
   */
  router.delete('/sessions/:sessionId/loop-schedules/:scheduleId', (req: Request, res: Response) => {
    try {
      const { scheduleId } = req.params;
      if (!sessionManager.loopScheduler) {
        return res.status(500).json({ error: '循环调度器未初始化' });
      }

      const success = sessionManager.loopScheduler.cancel(scheduleId);
      if (!success) {
        return res.status(404).json({ error: '调度不存在' });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
