import type { LoopDefinition, LoopRun, LoopStepDef, LoopIteration, LoopStepResult } from './types';

function getDb(): any {
  return require('./db').getDb();
}

function saveToFile(): void {
  return require('./db').saveToFile();
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 最大保存的循环运行数量
const MAX_RUNS_PER_SESSION = 20;

export default class LoopStore {
  /**
   * 获取会话的所有循环定义
   */
  getLoopDefs(sessionId: string): LoopDefinition[] {
    const db = getDb();
    const rows = db.exec('SELECT loop_defs FROM sessions WHERE id = ?', [sessionId]);
    if (rows.length === 0 || rows[0].values.length === 0) return [];

    const loopDefsJson = rows[0].values[0][0] as string;
    try {
      return JSON.parse(loopDefsJson || '[]');
    } catch {
      return [];
    }
  }

  /**
   * 保存循环定义
   */
  saveLoopDef(sessionId: string, def: LoopDefinition): LoopDefinition {
    const db = getDb();
    const defs = this.getLoopDefs(sessionId);
    const existingIndex = defs.findIndex(d => d.id === def.id);

    if (existingIndex >= 0) {
      defs[existingIndex] = def;
    } else {
      defs.push(def);
    }

    db.run('UPDATE sessions SET loop_defs = ? WHERE id = ?', [
      JSON.stringify(defs),
      sessionId
    ]);
    saveToFile();
    return def;
  }

  /**
   * 更新循环定义
   */
  updateLoopDef(sessionId: string, defId: string, updates: Partial<LoopDefinition>): LoopDefinition | null {
    const db = getDb();
    const defs = this.getLoopDefs(sessionId);
    const def = defs.find(d => d.id === defId);
    if (!def) return null;

    Object.assign(def, updates, { updatedAt: Date.now() });

    db.run('UPDATE sessions SET loop_defs = ? WHERE id = ?', [
      JSON.stringify(defs),
      sessionId
    ]);
    saveToFile();
    return def;
  }

  /**
   * 删除循环定义
   */
  deleteLoopDef(sessionId: string, defId: string): boolean {
    const db = getDb();
    const defs = this.getLoopDefs(sessionId);
    const newDefs = defs.filter(d => d.id !== defId);

    if (newDefs.length === defs.length) return false;

    db.run('UPDATE sessions SET loop_defs = ? WHERE id = ?', [
      JSON.stringify(newDefs),
      sessionId
    ]);
    saveToFile();
    return true;
  }

  /**
   * 获取会话的所有循环运行（从独立表）
   */
  getLoops(sessionId: string): LoopRun[] {
    const db = getDb();
    const rows = db.exec(
      'SELECT id, def_id, name, description, status, current_iteration, max_iterations, iterations, started_at, completed_at, created_at FROM loop_runs WHERE session_id = ? ORDER BY created_at DESC',
      [sessionId]
    );
    if (rows.length === 0) return [];

    return rows[0].values.map((row: any[]): LoopRun => {
      const iterations = this.parseIterations(row[7] as string);
      return {
        id: row[0] as string,
        defId: row[1] as string,
        name: row[2] as string,
        description: row[3] as string,
        status: row[4] as LoopRun['status'],
        currentIteration: row[5] as number,
        maxIterations: row[6] as number,
        iterations,
        startedAt: row[8] as number | null,
        completedAt: row[9] as number | null,
        createdAt: row[10] as number,
      };
    });
  }

  /**
   * 安全解析 iterations JSON
   */
  private parseIterations(json: string): LoopIteration[] {
    try {
      return JSON.parse(json || '[]');
    } catch {
      return [];
    }
  }

  /**
   * 获取单个循环运行
   */
  getLoop(sessionId: string, loopId: string): LoopRun | null {
    const loops = this.getLoops(sessionId);
    return loops.find(l => l.id === loopId) || null;
  }

  /**
   * 保存循环运行（使用独立表，只保留最近 N 条）
   */
  saveLoop(sessionId: string, run: LoopRun): LoopRun {
    const db = getDb();

    // 清理迭代数据，只保留状态信息，减少存储
    const runToSave = this.sanitizeRunForStorage(run);

    // 检查是否已存在
    const existing = db.exec('SELECT id FROM loop_runs WHERE id = ?', [runToSave.id]);
    const exists = existing.length > 0 && existing[0].values.length > 0;

    if (exists) {
      // 更新现有记录
      db.run(
        `UPDATE loop_runs SET status = ?, current_iteration = ?, iterations = ?, started_at = ?, completed_at = ? WHERE id = ?`,
        [
          runToSave.status,
          runToSave.currentIteration,
          JSON.stringify(runToSave.iterations),
          runToSave.startedAt,
          runToSave.completedAt,
          runToSave.id
        ]
      );
    } else {
      // 插入新记录
      db.run(
        `INSERT INTO loop_runs (id, session_id, def_id, name, description, status, current_iteration, max_iterations, iterations, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runToSave.id,
          sessionId,
          runToSave.defId,
          runToSave.name,
          runToSave.description,
          runToSave.status,
          runToSave.currentIteration,
          runToSave.maxIterations,
          JSON.stringify(runToSave.iterations),
          runToSave.startedAt,
          runToSave.completedAt,
          runToSave.createdAt
        ]
      );
    }

    // 清理旧数据，只保留最近 N 条
    this.cleanupOldRuns(sessionId);

    saveToFile();
    return run;
  }

  /**
   * 清理旧的循环运行，只保留最近 N 条
   */
  private cleanupOldRuns(sessionId: string): void {
    const db = getDb();

    // 获取当前会话的运行数量
    const countResult = db.exec('SELECT COUNT(*) FROM loop_runs WHERE session_id = ?', [sessionId]);
    const count = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

    if (count > MAX_RUNS_PER_SESSION) {
      // 删除超出限制的旧记录（按 created_at 排序，删除最旧的）
      const deleteCount = count - MAX_RUNS_PER_SESSION;
      db.run(
        `DELETE FROM loop_runs WHERE id IN (SELECT id FROM loop_runs WHERE session_id = ? ORDER BY created_at ASC LIMIT ?)`,
        [sessionId, deleteCount]
      );
      console.log(`[LoopStore] 清理了 ${deleteCount} 条旧的循环运行记录`);
    }
  }

  /**
   * 删除循环运行
   */
  deleteLoop(sessionId: string, loopId: string): boolean {
    const db = getDb();
    const result = db.run('DELETE FROM loop_runs WHERE id = ? AND session_id = ?', [loopId, sessionId]);
    saveToFile();
    return result.changes > 0;
  }

  /**
   * 清理循环运行数据，移除迭代过程中的详细输出，只保留状态信息
   */
  private sanitizeRunForStorage(run: LoopRun): LoopRun {
    // 深拷贝避免修改原始数据
    const sanitized = JSON.parse(JSON.stringify(run)) as LoopRun;

    // 清理每个迭代的详细数据，只保留状态和错误信息
    sanitized.iterations = sanitized.iterations.map(iter => ({
      ...iter,
      results: iter.results.map(result => ({
        ...result,
        messages: [], // 清空消息记录，减少存储
        result: result.error ? result.error : (result.status === 'done' ? '成功' : null),
      })),
    }));

    return sanitized;
  }

  /**
   * 创建循环定义对象
   */
  static createDefinition(data: {
    name: string;
    description: string;
    steps: LoopStepDef[];
    maxIterations?: number;
    exitCondition?: string;
    exitConditionType?: 'success' | 'failure' | 'custom';
    delayBetweenIterations?: number;
  }): LoopDefinition {
    return {
      id: generateId('loopdef'),
      name: data.name,
      description: data.description,
      steps: data.steps,
      maxIterations: data.maxIterations ?? 10,
      exitCondition: data.exitCondition,
      exitConditionType: data.exitConditionType ?? 'custom',
      delayBetweenIterations: data.delayBetweenIterations ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 创建循环运行对象
   */
  static createRun(def: LoopDefinition): LoopRun {
    return {
      id: generateId('looprun'),
      defId: def.id,
      name: def.name,
      description: def.description,
      status: 'idle',
      currentIteration: 0,
      maxIterations: def.maxIterations,
      iterations: [],
      startedAt: null,
      completedAt: null,
      createdAt: Date.now(),
    };
  }

  /**
   * 创建迭代对象
   */
  static createIteration(index: number): LoopIteration {
    return {
      index,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      results: [],
    };
  }

  /**
   * 创建步骤结果对象
   */
  static createStepResult(stepId: string): LoopStepResult {
    return {
      stepId,
      status: 'pending',
      result: null,
      messages: [],
      error: null,
    };
  }
}
