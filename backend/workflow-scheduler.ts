import type { WorkflowDefinition, WorkflowInstance, WorkflowStepDef, WorkflowStepRun } from './types';
import type WorkflowEngine from './workflow-engine';

interface SessionManagerLike {
  getSession(sessionId: string): any;
  getWorkflowDefs(sessionId: string): WorkflowDefinition[];
  saveWorkflow(sessionId: string, instance: WorkflowInstance): WorkflowInstance;
}

function getDb(): any {
  return require('./db').getDb();
}

function saveToFile(): void {
  return require('./db').saveToFile();
}

export interface WorkflowSchedule {
  id: string;
  sessionId: string;
  workflowDefId: string;
  scheduledAt: number;
  status: 'pending' | 'executed' | 'cancelled';
  createdAt: number;
}

export default class WorkflowScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private sessionManager: SessionManagerLike;
  private workflowEngine: WorkflowEngine;

  constructor(sessionManager: SessionManagerLike, workflowEngine: WorkflowEngine) {
    this.sessionManager = sessionManager;
    this.workflowEngine = workflowEngine;
  }

  loadPending(): void {
    const db = getDb();
    const rows = db.exec(
      "SELECT id, session_id, workflow_def_id, scheduled_at, status, created_at FROM workflow_schedules WHERE status = 'pending'"
    );
    if (rows.length === 0) return;

    for (const row of rows[0].values) {
      const schedule: WorkflowSchedule = {
        id: row[0] as string,
        sessionId: row[1] as string,
        workflowDefId: row[2] as string,
        scheduledAt: row[3] as number,
        status: row[4] as 'pending',
        createdAt: row[5] as number,
      };
      this.setTimer(schedule);
    }
    console.log(`[调度器] 已加载 ${rows[0].values.length} 个待执行的定时任务`);
  }

  schedule(sessionId: string, defId: string, scheduledAt: number): WorkflowSchedule {
    const db = getDb();
    const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const schedule: WorkflowSchedule = {
      id,
      sessionId,
      workflowDefId: defId,
      scheduledAt,
      status: 'pending',
      createdAt: Date.now(),
    };

    db.run(
      'INSERT INTO workflow_schedules (id, session_id, workflow_def_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [schedule.id, schedule.sessionId, schedule.workflowDefId, schedule.scheduledAt, schedule.status, schedule.createdAt]
    );
    saveToFile();
    this.setTimer(schedule);
    return schedule;
  }

  cancel(scheduleId: string): boolean {
    const db = getDb();
    const rows = db.exec('SELECT id FROM workflow_schedules WHERE id = ?', [scheduleId]);
    if (rows.length === 0 || rows[0].values.length === 0) return false;

    db.run("UPDATE workflow_schedules SET status = 'cancelled' WHERE id = ?", [scheduleId]);
    saveToFile();

    const timer = this.timers.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(scheduleId);
    }
    return true;
  }

  getSchedules(sessionId: string): WorkflowSchedule[] {
    const db = getDb();
    const rows = db.exec(
      'SELECT id, session_id, workflow_def_id, scheduled_at, status, created_at FROM workflow_schedules WHERE session_id = ? ORDER BY scheduled_at DESC',
      [sessionId]
    );
    if (rows.length === 0) return [];

    return rows[0].values.map((row: any[]): WorkflowSchedule => ({
      id: row[0] as string,
      sessionId: row[1] as string,
      workflowDefId: row[2] as string,
      scheduledAt: row[3] as number,
      status: row[4] as WorkflowSchedule['status'],
      createdAt: row[5] as number,
    }));
  }

  private setTimer(schedule: WorkflowSchedule): void {
    const delay = schedule.scheduledAt - Date.now();
    if (delay <= 0) {
      this.executeSchedule(schedule);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(schedule.id);
      this.executeSchedule(schedule);
    }, delay);

    this.timers.set(schedule.id, timer);
  }

  private async executeSchedule(schedule: WorkflowSchedule): Promise<void> {
    const db = getDb();
    db.run("UPDATE workflow_schedules SET status = 'executed' WHERE id = ?", [schedule.id]);
    saveToFile();

    const session = this.sessionManager.getSession(schedule.sessionId);
    if (!session) {
      console.error(`[调度器] 会话 ${schedule.sessionId} 不存在，跳过定时任务 ${schedule.id}`);
      return;
    }

    const defs = this.sessionManager.getWorkflowDefs(schedule.sessionId);
    const def = defs.find(d => d.id === schedule.workflowDefId);
    if (!def) {
      console.error(`[调度器] 工作流定义 ${schedule.workflowDefId} 不存在，跳过定时任务 ${schedule.id}`);
      return;
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
        timeout: (s.timeout || 600) * 1000,
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

    this.sessionManager.saveWorkflow(schedule.sessionId, instance);
    console.log(`[调度器] 定时任务 ${schedule.id} 到期，开始执行工作流 ${def.name}`);

    this.workflowEngine.start(schedule.sessionId, instance).catch((err: any) => {
      console.error('[调度器] 定时工作流执行失败:', err);
    });
  }
}
