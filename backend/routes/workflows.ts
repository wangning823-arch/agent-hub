import { Router, Request, Response } from 'express';
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowStepRun,
  WorkflowStepDef,
  WorkflowTemplate,
} from '../types';
import type WorkflowEngine from '../workflow-engine';

interface SessionManagerLike {
  getSession(sessionId: string): any;
  getWorkflowDefs(sessionId: string): WorkflowDefinition[];
  saveWorkflowDef(sessionId: string, def: WorkflowDefinition): WorkflowDefinition;
  updateWorkflowDef(sessionId: string, defId: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition;
  deleteWorkflowDef(sessionId: string, defId: string): boolean;
  getWorkflows(sessionId: string): WorkflowInstance[];
  getWorkflow(sessionId: string, workflowId: string): WorkflowInstance | null;
  saveWorkflow(sessionId: string, instance: WorkflowInstance): WorkflowInstance;
  deleteWorkflow(sessionId: string, workflowId: string): boolean;
}

function getDb(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../db').getDb();
}

function saveToFile(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../db').saveToFile();
}

export default (sessionManager: SessionManagerLike, workflowEngine: WorkflowEngine) => {
  const router = Router();

  router.post('/sessions/:sessionId/workflow-defs', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const { name, description, steps } = req.body;
      if (!name || !steps || !Array.isArray(steps)) {
        return res.status(400).json({ error: '名称和步骤列表是必需的' });
      }

      const def: WorkflowDefinition = {
        id: `wfdef_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        description: description || '',
        steps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const saved = sessionManager.saveWorkflowDef(sessionId, def);
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/sessions/:sessionId/workflow-defs', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }
      res.json({ defs: sessionManager.getWorkflowDefs(sessionId) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/sessions/:sessionId/workflow-defs/:defId', (req: Request, res: Response) => {
    try {
      const { sessionId, defId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const updated = sessionManager.updateWorkflowDef(sessionId, defId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/sessions/:sessionId/workflow-defs/:defId', (req: Request, res: Response) => {
    try {
      const { sessionId, defId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      sessionManager.deleteWorkflowDef(sessionId, defId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sessions/:sessionId/workflows', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const { defId } = req.body;
      if (!defId) {
        return res.status(400).json({ error: 'defId 是必需的' });
      }

      const defs = sessionManager.getWorkflowDefs(sessionId);
      const def = defs.find(d => d.id === defId);
      if (!def) {
        return res.status(404).json({ error: '工作流定义不存在' });
      }

      const instance: WorkflowInstance = {
        id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        defId: def.id,
        name: def.name,
        description: def.description,
        steps: def.steps.map((s: WorkflowStepDef): WorkflowStepRun => ({
          id: s.id,
          name: s.name,
          prompt: s.prompt,
          agentType: s.agentType || 'claude-code',
          model: s.model,
          dependsOn: s.dependsOn,
          timeout: (s.timeout || 600) * 1000,  // 前端传秒，转为毫秒
          status: 'pending',
          result: null,
          messages: [],
          error: null,
          startedAt: null,
          completedAt: null,
        })),
        status: 'idle',
        startedAt: null,
        completedAt: null,
        createdAt: Date.now(),
      };

      sessionManager.saveWorkflow(sessionId, instance);
      workflowEngine.start(sessionId, instance).catch((err: any) => {
        console.error('工作流执行失败:', err);
      });

      res.json(instance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/sessions/:sessionId/workflows', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }
      res.json({ workflows: sessionManager.getWorkflows(sessionId) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sessions/:sessionId/workflows/:workflowId/pause', (req: Request, res: Response) => {
    try {
      const { sessionId, workflowId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const instance = sessionManager.getWorkflow(sessionId, workflowId);
      if (!instance) {
        return res.status(404).json({ error: '工作流实例不存在' });
      }

      if (instance.status !== 'running') {
        return res.status(400).json({ error: '工作流未在运行中' });
      }

      workflowEngine.pause(sessionId, instance);
      sessionManager.saveWorkflow(sessionId, instance);
      res.json(instance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sessions/:sessionId/workflows/:workflowId/cancel', (req: Request, res: Response) => {
    try {
      const { sessionId, workflowId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const instance = sessionManager.getWorkflow(sessionId, workflowId);
      if (!instance) {
        return res.status(404).json({ error: '工作流实例不存在' });
      }

      if (instance.status !== 'running') {
        return res.status(400).json({ error: '工作流未在运行中' });
      }

      workflowEngine.cancel(sessionId, instance);
      sessionManager.saveWorkflow(sessionId, instance);
      res.json(instance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/sessions/:sessionId/workflows/:workflowId/retry', (req: Request, res: Response) => {
    try {
      const { sessionId, workflowId } = req.params;
      const { stepId } = req.body;
      if (!stepId) {
        return res.status(400).json({ error: 'stepId 是必需的' });
      }

      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const instance = sessionManager.getWorkflow(sessionId, workflowId);
      if (!instance) {
        return res.status(404).json({ error: '工作流实例不存在' });
      }

      workflowEngine.retryStep(sessionId, instance, stepId);
      sessionManager.saveWorkflow(sessionId, instance);
      res.json(instance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/sessions/:sessionId/workflows/:workflowId', (req: Request, res: Response) => {
    try {
      const { sessionId, workflowId } = req.params;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const instance = sessionManager.getWorkflow(sessionId, workflowId);
      if (instance && instance.status === 'running') {
        workflowEngine.cancel(sessionId, instance);
      }

      sessionManager.deleteWorkflow(sessionId, workflowId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Workflow Templates ====================

  router.post('/workflow-templates', (req: Request, res: Response) => {
    try {
      const { name, description, steps } = req.body;
      if (!name || !steps || !Array.isArray(steps)) {
        return res.status(400).json({ error: '名称和步骤列表是必需的' });
      }

      const db = getDb();
      const id = `wftpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const template: WorkflowTemplate = {
        id,
        name,
        description: description || '',
        steps,
        createdAt: Date.now(),
        usageCount: 0,
      };

      db.run(
        'INSERT INTO workflow_templates (id, name, description, steps, created_at, usage_count) VALUES (?, ?, ?, ?, ?, ?)',
        [template.id, template.name, template.description, JSON.stringify(template.steps), template.createdAt, 0],
      );
      saveToFile();
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workflow-templates', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.exec('SELECT id, name, description, steps, created_at, usage_count FROM workflow_templates ORDER BY created_at DESC');
      if (rows.length === 0) {
        return res.json([]);
      }
      const templates = rows[0].values.map((row: any[]): WorkflowTemplate => ({
        id: row[0] as string,
        name: row[1] as string,
        description: row[2] as string,
        steps: JSON.parse(row[3] as string),
        createdAt: row[4] as number,
        usageCount: row[5] as number,
      }));
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/workflow-templates/:templateId/use', (req: Request, res: Response) => {
    try {
      const { templateId } = req.params;
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId 是必需的' });
      }

      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: '会话不存在' });
      }

      const db = getDb();
      const rows = db.exec('SELECT id, name, description, steps, created_at, usage_count FROM workflow_templates WHERE id = ?', [templateId]);
      if (rows.length === 0 || rows[0].values.length === 0) {
        return res.status(404).json({ error: '模板不存在' });
      }

      const row = rows[0].values[0];
      const template: WorkflowTemplate = {
        id: row[0] as string,
        name: row[1] as string,
        description: row[2] as string,
        steps: JSON.parse(row[3] as string),
        createdAt: row[4] as number,
        usageCount: row[5] as number,
      };

      db.run('UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE id = ?', [templateId]);
      saveToFile();

      const def: WorkflowDefinition = {
        id: `wfdef_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: template.name,
        description: template.description,
        steps: template.steps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const saved = sessionManager.saveWorkflowDef(sessionId, def);
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/workflow-templates/:templateId', (req: Request, res: Response) => {
    try {
      const { templateId } = req.params;
      const db = getDb();
      db.run('DELETE FROM workflow_templates WHERE id = ?', [templateId]);
      saveToFile();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
