import type { LoopDefinition, LoopRun } from './types';
import LoopStore from './loop-store';
import type LoopEngine from './loop-engine';

interface SessionManagerLike {
  getSession(sessionId: string): any;
  getLoopDefs(sessionId: string): LoopDefinition[];
  saveLoop(sessionId: string, run: LoopRun): LoopRun;
}

function getDb(): any {
  return require('./db').getDb();
}

function saveToFile(): void {
  return require('./db').saveToFile();
}

export interface LoopSchedule {
  id: string;
  sessionId: string;
  loopDefId: string;
  scheduledAt: number;
  recurrence?: string;
  status: 'pending' | 'executed' | 'cancelled';
  createdAt: number;
}

export default class LoopScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private sessionManager: SessionManagerLike;
  private loopEngine: LoopEngine;

  constructor(sessionManager: SessionManagerLike, loopEngine: LoopEngine) {
    this.sessionManager = sessionManager;
    this.loopEngine = loopEngine;
  }

  /**
   * 加载待执行的定时任务
   */
  loadPending(): void {
    const db = getDb();
    const rows = db.exec(
      "SELECT id, session_id, loop_def_id, scheduled_at, recurrence, status, created_at FROM loop_schedules WHERE status = 'pending'"
    );
    if (rows.length === 0) return;

    for (const row of rows[0].values) {
      const schedule: LoopSchedule = {
        id: row[0] as string,
        sessionId: row[1] as string,
        loopDefId: row[2] as string,
        scheduledAt: row[3] as number,
        recurrence: row[4] as string | undefined,
        status: row[5] as 'pending',
        createdAt: row[6] as number,
      };
      this.setTimer(schedule);
    }
    console.log(`[循环调度器] 已加载 ${rows[0].values.length} 个待执行的定时任务`);
  }

  /**
   * 调度循环执行
   */
  schedule(sessionId: string, defId: string, scheduledAt: number, recurrence?: string): LoopSchedule {
    const db = getDb();
    const id = `lousch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const schedule: LoopSchedule = {
      id,
      sessionId,
      loopDefId: defId,
      scheduledAt,
      recurrence,
      status: 'pending',
      createdAt: Date.now(),
    };

    db.run(
      'INSERT INTO loop_schedules (id, session_id, loop_def_id, scheduled_at, recurrence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [schedule.id, schedule.sessionId, schedule.loopDefId, schedule.scheduledAt, schedule.recurrence || null, schedule.status, schedule.createdAt]
    );
    saveToFile();
    this.setTimer(schedule);
    return schedule;
  }

  /**
   * 取消调度
   */
  cancel(scheduleId: string): boolean {
    const db = getDb();
    const rows = db.exec('SELECT id FROM loop_schedules WHERE id = ?', [scheduleId]);
    if (rows.length === 0 || rows[0].values.length === 0) return false;

    db.run("UPDATE loop_schedules SET status = 'cancelled' WHERE id = ?", [scheduleId]);
    saveToFile();

    const timer = this.timers.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(scheduleId);
    }
    return true;
  }

  /**
   * 获取会话的调度列表
   */
  getSchedules(sessionId: string): LoopSchedule[] {
    const db = getDb();
    const rows = db.exec(
      'SELECT id, session_id, loop_def_id, scheduled_at, recurrence, status, created_at FROM loop_schedules WHERE session_id = ? ORDER BY scheduled_at DESC',
      [sessionId]
    );
    if (rows.length === 0) return [];

    return rows[0].values.map((row: any[]): LoopSchedule => ({
      id: row[0] as string,
      sessionId: row[1] as string,
      loopDefId: row[2] as string,
      scheduledAt: row[3] as number,
      recurrence: row[4] as string | undefined,
      status: row[5] as LoopSchedule['status'],
      createdAt: row[6] as number,
    }));
  }

  /**
   * 设置定时器
   */
  private setTimer(schedule: LoopSchedule): void {
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

  /**
   * 执行调度
   */
  private async executeSchedule(schedule: LoopSchedule): Promise<void> {
    const db = getDb();
    db.run("UPDATE loop_schedules SET status = 'executed' WHERE id = ?", [schedule.id]);
    saveToFile();

    const session = this.sessionManager.getSession(schedule.sessionId);
    if (!session) {
      console.error(`[循环调度器] 会话 ${schedule.sessionId} 不存在，跳过定时任务 ${schedule.id}`);
      return;
    }

    const defs = this.sessionManager.getLoopDefs(schedule.sessionId);
    const def = defs.find(d => d.id === schedule.loopDefId);
    if (!def) {
      console.error(`[循环调度器] 循环定义 ${schedule.loopDefId} 不存在，跳过定时任务 ${schedule.id}`);
      return;
    }

    const run = LoopStore.createRun(def);
    this.sessionManager.saveLoop(schedule.sessionId, run);
    console.log(`[循环调度器] 定时任务 ${schedule.id} 到期，开始执行循环 ${def.name}`);

    this.loopEngine.start(schedule.sessionId, run, def).catch((err: any) => {
      console.error('[循环调度器] 定时循环执行失败:', err);
    });
  }
}
