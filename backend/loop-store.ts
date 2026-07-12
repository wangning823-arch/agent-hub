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
   * 获取会话的所有循环运行
   */
  getLoops(sessionId: string): LoopRun[] {
    const db = getDb();
    const rows = db.exec('SELECT loops FROM sessions WHERE id = ?', [sessionId]);
    if (rows.length === 0 || rows[0].values.length === 0) return [];

    const loopsJson = rows[0].values[0][0] as string;
    if (!loopsJson || loopsJson === '[]') return [];
    
    try {
      const parsed = JSON.parse(loopsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[LoopStore] 解析 loops 数据失败:', e);
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
   * 保存循环运行
   */
  saveLoop(sessionId: string, run: LoopRun): LoopRun {
    const db = getDb();
    const loops = this.getLoops(sessionId);
    const existingIndex = loops.findIndex(l => l.id === run.id);

    if (existingIndex >= 0) {
      loops[existingIndex] = run;
    } else {
      loops.push(run);
    }

    // 只保留最近 50 个运行记录
    const trimmedLoops = loops.slice(-50);

    console.log(`[LoopStore] 保存循环: sessionId=${sessionId}, runId=${run.id}, status=${run.status}, loopsCount=${trimmedLoops.length}`);
    
    db.run('UPDATE sessions SET loops = ? WHERE id = ?', [
      JSON.stringify(trimmedLoops),
      sessionId
    ]);
    
    // 验证保存是否成功
    const verifyResult = db.exec('SELECT loops FROM sessions WHERE id = ?', [sessionId]);
    if (verifyResult.length > 0 && verifyResult[0].values.length > 0) {
      const savedLoops = verifyResult[0].values[0][0] as string;
      console.log(`[LoopStore] 验证保存: loops长度=${savedLoops ? savedLoops.length : 0}`);
    }
    
    saveToFile();
    return run;
  }

  /**
   * 删除循环运行
   */
  deleteLoop(sessionId: string, loopId: string): boolean {
    const db = getDb();
    const loops = this.getLoops(sessionId);
    const newLoops = loops.filter(l => l.id !== loopId);

    if (newLoops.length === loops.length) return false;

    db.run('UPDATE sessions SET loops = ? WHERE id = ?', [
      JSON.stringify(newLoops),
      sessionId
    ]);
    saveToFile();
    return true;
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
