import { EventEmitter } from 'events';
import type {
  LoopRun,
  LoopDefinition,
  LoopIteration,
  LoopStepDef,
  LoopStepResult,
  LoopRunStatus,
  StepMessage,
  AgentType,
} from './types';
import type { AgentBase } from './types';
import { createAgent } from './agents/factory';
import LoopStore from './loop-store';

const MAX_STEP_RESULT_CHARS = 8000;

interface RunningLoop {
  agents: Map<string, AgentBase>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  cancelled: boolean;
  paused: boolean;
}

interface SessionManagerLike {
  getSession(sessionId: string): { workdir: string; agentType: AgentType } | undefined;
  broadcast(sessionId: string, message: Record<string, unknown>): void;
  saveLoop?(sessionId: string, run: LoopRun): LoopRun;
}

export default class LoopEngine {
  private running: Map<string, RunningLoop> = new Map();
  private sessionManager: SessionManagerLike;

  constructor(sessionManager: SessionManagerLike) {
    this.sessionManager = sessionManager;
  }

  isRunning(loopId: string): boolean {
    return this.running.has(loopId);
  }

  /**
   * 启动循环执行
   */
  async start(sessionId: string, run: LoopRun, definition: LoopDefinition): Promise<void> {
    const rl: RunningLoop = {
      agents: new Map(),
      timers: new Map(),
      cancelled: false,
      paused: false,
    };
    this.running.set(run.id, rl);

    run.status = 'running';
    run.startedAt = Date.now();
    this.saveAndBroadcast(sessionId, run);

    try {
      await this.executeIterations(sessionId, run, definition, rl);

      if (!rl.cancelled && !rl.paused) {
        this.checkCompletion(run);
      }
    } catch (err) {
      run.status = 'error';
      run.completedAt = Date.now();
    } finally {
      this.cleanup(run.id);
      this.saveAndBroadcast(sessionId, run);
    }
  }

  /**
   * 暂停循环
   */
  pause(sessionId: string, run: LoopRun): void {
    const rl = this.running.get(run.id);
    if (rl) {
      rl.paused = true;
      rl.cancelled = true;
      for (const agent of rl.agents.values()) {
        agent.stop().catch(() => {});
      }
      for (const timer of rl.timers.values()) {
        clearTimeout(timer);
      }
    }

    run.status = 'paused';
    this.updateCurrentIteration(run, 'error', '用户暂停');
    run.completedAt = Date.now();
    this.saveAndBroadcast(sessionId, run);
  }

  /**
   * 取消循环
   */
  cancel(sessionId: string, run: LoopRun): void {
    const rl = this.running.get(run.id);
    if (rl) {
      rl.cancelled = true;
      for (const agent of rl.agents.values()) {
        agent.stop().catch(() => {});
      }
      for (const timer of rl.timers.values()) {
        clearTimeout(timer);
      }
    }

    run.status = 'cancelled';
    this.updateCurrentIteration(run, 'error', '用户取消');
    run.completedAt = Date.now();
    this.saveAndBroadcast(sessionId, run);
  }

  /**
   * 重试当前迭代
   */
  async retryIteration(sessionId: string, run: LoopRun, definition: LoopDefinition): Promise<void> {
    const rl = this.running.get(run.id);
    if (rl) return; // 已在运行中

    const currentIteration = run.iterations[run.currentIteration];
    if (!currentIteration || (currentIteration.status !== 'error' && currentIteration.status !== 'done')) {
      return;
    }

    // 重置当前迭代
    currentIteration.status = 'pending';
    currentIteration.error = undefined;
    currentIteration.results = [];
    currentIteration.startedAt = null;
    currentIteration.completedAt = null;

    await this.start(sessionId, run, definition);
  }

  /**
   * 执行所有迭代
   */
  private async executeIterations(
    sessionId: string,
    run: LoopRun,
    def: LoopDefinition,
    rl: RunningLoop
  ): Promise<void> {
    const maxIter = def.maxIterations > 0 ? def.maxIterations : Infinity;

    while (run.currentIteration < maxIter) {
      if (rl.cancelled || rl.paused) return;

      // 创建新的迭代
      const iteration = LoopStore.createIteration(run.currentIteration);
      run.iterations.push(iteration);

      // 执行迭代
      await this.executeIteration(sessionId, run, def, iteration, rl);

      // 检查退出条件
      if (this.checkExitCondition(def, iteration)) {
        break;
      }

      // 检查是否出错
      if (iteration.status === 'error') {
        break;
      }

      run.currentIteration++;

      // 保存进度
      this.saveAndBroadcast(sessionId, run);

      // 迭代间延迟
      if (def.delayBetweenIterations > 0 && run.currentIteration < maxIter) {
        await this.delay(def.delayBetweenIterations, rl);
      }
    }
  }

  /**
   * 执行单次迭代
   */
  private async executeIteration(
    sessionId: string,
    run: LoopRun,
    def: LoopDefinition,
    iteration: LoopIteration,
    rl: RunningLoop
  ): Promise<void> {
    iteration.status = 'running';
    iteration.startedAt = Date.now();
    this.saveAndBroadcast(sessionId, run);

    try {
      for (const step of def.steps) {
        if (rl.cancelled || rl.paused) return;

        const result = await this.executeStep(sessionId, run, iteration, step, rl);
        iteration.results.push(result);

        // 如果步骤出错，停止迭代
        if (result.status === 'error') {
          iteration.status = 'error';
          iteration.error = result.error || undefined;
          break;
        }
      }

      if (iteration.status === 'running') {
        iteration.status = 'done';
      }
    } catch (err) {
      iteration.status = 'error';
      iteration.error = (err as Error).message;
    } finally {
      iteration.completedAt = Date.now();
      this.saveAndBroadcast(sessionId, run);
    }
  }

  /**
   * 构建前序迭代的上下文
   */
  private buildPreviousContext(run: LoopRun, currentIndex: number): string {
    if (currentIndex === 0) return '';

    const contextParts: string[] = [];
    for (let i = 0; i < currentIndex; i++) {
      const prevIteration = run.iterations[i];
      if (prevIteration && prevIteration.results.length > 0) {
        const stepResults = prevIteration.results
          .map(r => `[步骤 ${r.stepId}]: ${r.result || '(无结果)'}`)
          .join('\n');
        contextParts.push(`## 迭代 ${i + 1} 的结果\n${stepResults}`);
      }
    }

    if (contextParts.length === 0) return '';

    return `以下是前序迭代的执行结果，请参考：\n\n${contextParts.join('\n---\n\n')}\n\n`;
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    sessionId: string,
    run: LoopRun,
    iteration: LoopIteration,
    step: LoopStepDef,
    rl: RunningLoop
  ): Promise<LoopStepResult> {
    const result = LoopStore.createStepResult(step.id);
    result.status = 'running';

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      result.status = 'error';
      result.error = '会话不存在';
      return result;
    }

    const agent = createAgent(session.workdir, step.agentType || session.agentType, {
      model: step.model,
    });
    rl.agents.set(`${iteration.index}_${step.id}`, agent);

    // 构建包含前序迭代结果的提示词
    const previousContext = this.buildPreviousContext(run, iteration.index);
    const fullPrompt = previousContext
      ? `${previousContext}\n请根据上述历史结果完成以下任务：\n${step.prompt}`
      : step.prompt;

    const handler = (msg: { type: string; content: string | Record<string, unknown>; message?: { content: Array<{ type: string; text: string }> } }) => {
      const time = Date.now();
      let entry: StepMessage | null = null;

      if (msg.type === 'text') {
        entry = { type: 'text', content: String(msg.content), time };
      } else if (msg.type === 'assistant') {
        const texts = (msg.message?.content || [])
          .filter(c => c.type === 'text')
          .map(c => c.text);
        if (texts.length > 0) {
          entry = { type: 'assistant', content: texts.join('\n'), time };
        }
      } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
        entry = { type: msg.type, content: String(msg.content || ''), time };
      }

      if (entry) {
        result.messages.push(entry);
        if (result.messages.length > 100) {
          result.messages = result.messages.slice(-100);
        }
        result.result = result.messages.map(m => m.content).filter(Boolean).join('\n');
        this.broadcastIterationMessage(sessionId, run.id, iteration.index, step.id, entry);
      }
    };

    agent.on('message', handler);

    const timer = setTimeout(() => {
      result.status = 'error';
      result.error = '执行超时';
      agent.stop().catch(() => {});
    }, step.timeout);
    rl.timers.set(`${iteration.index}_${step.id}`, timer);

    let settled = false;
    const donePromise = new Promise<void>(resolve => {
      agent.once('stopped', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rl.timers.delete(`${iteration.index}_${step.id}`);
          resolve();
        }
      });
    });

    try {
      await agent.start();
      await agent.send(fullPrompt);
      await donePromise;

      if (result.status === 'running') {
        result.status = 'done';
      }
    } catch (err) {
      if (result.status === 'running') {
        result.status = 'error';
        result.error = (err as Error).message;
      }
    } finally {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rl.timers.delete(`${iteration.index}_${step.id}`);
      }
      agent.removeListener('message', handler);
      agent.stop().catch(() => {});
      rl.agents.delete(`${iteration.index}_${step.id}`);
    }

    return result;
  }

  /**
   * 检查退出条件
   */
  private checkExitCondition(def: LoopDefinition, iteration: LoopIteration): boolean {
    if (!def.exitCondition) return false;

    // 基于退出条件类型检查
    if (def.exitConditionType === 'success') {
      // 成功条件：所有步骤都完成
      return iteration.status === 'done';
    } else if (def.exitConditionType === 'failure') {
      // 失败条件：任何步骤出错
      return iteration.status === 'error';
    }

    // 自定义条件：目前简单检查步骤结果
    // 未来可以通过 LLM 判断自然语言条件
    return false;
  }

  /**
   * 更新当前迭代状态
   */
  private updateCurrentIteration(run: LoopRun, status: LoopIteration['status'], error?: string): void {
    const currentIteration = run.iterations[run.currentIteration];
    if (currentIteration && currentIteration.status === 'running') {
      currentIteration.status = status;
      currentIteration.error = error;
      currentIteration.completedAt = Date.now();
    }
  }

  /**
   * 检查完成状态
   */
  private checkCompletion(run: LoopRun): void {
    if (run.status !== 'running') return;

    const hasError = run.iterations.some(i => i.status === 'error');
    const reachedMax = run.currentIteration >= run.maxIterations - 1;

    if (hasError) {
      run.status = 'error';
    } else if (reachedMax) {
      run.status = 'completed';
    }

    run.completedAt = Date.now();
  }

  /**
   * 延迟（可取消）
   */
  private delay(ms: number, rl: RunningLoop): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        rl.timers.delete('_delay');
        resolve();
      }, ms);
      rl.timers.set('_delay', timer);
    });
  }

  /**
   * 清理资源
   */
  private cleanup(loopId: string): void {
    const rl = this.running.get(loopId);
    if (rl) {
      for (const timer of rl.timers.values()) {
        clearTimeout(timer);
      }
      this.running.delete(loopId);
    }
  }

  /**
   * 保存并广播循环状态
   */
  private saveAndBroadcast(sessionId: string, run: LoopRun): void {
    // 保存到数据库
    if (this.sessionManager.saveLoop) {
      this.sessionManager.saveLoop(sessionId, run);
    }
    // 广播状态
    this.broadcastLoopStatus(sessionId, run);
  }

  /**
   * 广播循环状态
   */
  private broadcastLoopStatus(sessionId: string, run: LoopRun): void {
    this.sessionManager.broadcast(sessionId, {
      type: 'loop_status',
      loop_id: run.id,
      status: run.status,
      run,
    });
  }

  /**
   * 广播迭代状态
   */
  private broadcastIterationStatus(sessionId: string, run: LoopRun, iteration: LoopIteration): void {
    this.sessionManager.broadcast(sessionId, {
      type: 'loop_iteration_status',
      loop_id: run.id,
      iteration_index: iteration.index,
      status: iteration.status,
      error: iteration.error,
    });
  }

  /**
   * 广播迭代消息
   */
  private broadcastIterationMessage(
    sessionId: string,
    loopId: string,
    iterationIndex: number,
    stepId: string,
    entry: StepMessage
  ): void {
    this.sessionManager.broadcast(sessionId, {
      type: 'loop_iteration_message',
      loop_id: loopId,
      iteration_index: iterationIndex,
      step_id: stepId,
      content: entry.content,
      content_type: entry.type,
    });
  }
}
