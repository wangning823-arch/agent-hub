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
// 安全上限：防止无限循环
const MAX_ITERATIONS_HARD_LIMIT = 1000;

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
      // 只停止当前正在运行的 agent 和定时器，不设置 cancelled
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
   * 继续执行暂停的循环
   */
  async resume(sessionId: string, run: LoopRun, definition: LoopDefinition): Promise<void> {
    // 如果循环已经在运行，直接返回
    if (this.running.has(run.id)) return;

    // 恢复运行状态
    run.status = 'running';
    run.completedAt = null;

    // 如果当前迭代处于错误或暂停状态，重置为 pending
    const currentIteration = run.iterations[run.currentIteration];
    if (currentIteration && (currentIteration.status === 'error' || currentIteration.status === 'skipped')) {
      currentIteration.status = 'pending';
      currentIteration.error = undefined;
      currentIteration.completedAt = null;
    }

    this.saveAndBroadcast(sessionId, run);

    // 重新启动循环执行
    await this.start(sessionId, run, definition);
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
    // 使用硬性上限防止无限循环
    const maxIter = def.maxIterations > 0
      ? Math.min(def.maxIterations, MAX_ITERATIONS_HARD_LIMIT)
      : MAX_ITERATIONS_HARD_LIMIT;

    // 获取会话信息
    const session = this.sessionManager.getSession(sessionId);
    const agentType = def.steps[0]?.agentType || session?.agentType || 'mimo';
    const workdir = session?.workdir || process.env.HOME || '/root';

    while (run.currentIteration < maxIter) {
      if (rl.cancelled || rl.paused) return;

      // 创建新的迭代
      const iteration = LoopStore.createIteration(run.currentIteration);
      run.iterations.push(iteration);

      // 执行迭代（出错时继续下一步，不中断）
      await this.executeIteration(sessionId, run, def, iteration, rl);

      // 检查退出条件
      if (await this.checkExitCondition(def, iteration, agentType, workdir)) {
        break;
      }

      // 迭代出错时记录日志但继续下一步（不中断循环）
      if (iteration.status === 'error') {
        console.log(`[循环] 迭代 ${run.currentIteration + 1} 出错: ${iteration.error}，继续下一步`);
      }

      run.currentIteration++;

      // 只广播状态，不保存迭代过程中的详细数据到数据库
      this.broadcastLoopStatus(sessionId, run);

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
    // 只广播状态，不保存到数据库
    this.broadcastLoopStatus(sessionId, run);

    try {
      for (const step of def.steps) {
        if (rl.cancelled || rl.paused) return;

        const result = await this.executeStep(sessionId, run, iteration, step, rl, def);
        iteration.results.push(result);

        // 步骤出错时记录日志但继续执行下一步（不中断迭代）
        if (result.status === 'error') {
          console.log(`[循环] 步骤 ${step.id} 出错: ${result.error}，继续执行下一步`);
        }
      }

      // 如果有任何步骤出错，迭代标记为 error，否则为 done
      const hasError = iteration.results.some(r => r.status === 'error');
      iteration.status = hasError ? 'error' : 'done';
      if (hasError) {
        iteration.error = iteration.results.find(r => r.status === 'error')?.error || '部分步骤执行失败';
      }
    } catch (err) {
      iteration.status = 'error';
      iteration.error = (err as Error).message;
    } finally {
      iteration.completedAt = Date.now();
      // 只广播状态，不保存到数据库
      this.broadcastLoopStatus(sessionId, run);
    }
  }

  /**
   * 构建前序迭代的上下文（带压缩）
   */
  private buildPreviousContext(
    run: LoopRun,
    currentIndex: number,
    def: LoopDefinition
  ): string {
    if (currentIndex === 0) return '';

    // 从定义中获取配置，使用默认值
    const config = def.contextConfig || {};
    const maxFullIterations = config.maxFullIterations ?? 10;
    const maxResultChars = config.maxResultChars ?? 50000;
    const maxTotalChars = config.maxTotalChars ?? 200000;
    const enableCompression = config.enableCompression ?? true;

    // 如果禁用压缩，使用简单模式（只保留最近3轮完整结果）
    if (!enableCompression) {
      const recentIterations = run.iterations.slice(-3);
      if (recentIterations.length === 0) return '';

      const contextParts = recentIterations.map((iter, idx) => {
        const iterationNum = iter.index + 1;
        const stepResults = iter.results
          .map(r => `[步骤 ${r.stepId}]: ${r.result || '(无结果)'}`)
          .join('\n');
        return `## 迭代 ${iterationNum} 的结果\n${stepResults}`;
      });

      return `以下是最近的迭代结果：\n\n${contextParts.join('\n---\n\n')}\n\n`;
    }

    const contextParts: string[] = [];
    let totalChars = 0;

    for (let i = 0; i < currentIndex; i++) {
      const prevIteration = run.iterations[i];
      if (!prevIteration || prevIteration.results.length === 0) continue;

      // 计算这是第几个迭代（从1开始）
      const iterationNum = i + 1;
      const isRecent = i >= currentIndex - maxFullIterations;

      if (isRecent) {
        // 保留完整结果（但截断单个结果）
        const stepResults = prevIteration.results
          .map(r => {
            let resultText = r.result || '(无结果)';
            if (resultText.length > maxResultChars) {
              resultText = resultText.substring(0, maxResultChars) + `... [已截断，原始长度 ${resultText.length} 字符]`;
            }
            return `[步骤 ${r.stepId}]: ${resultText}`;
          })
          .join('\n');

        const part = `## 迭代 ${iterationNum} 的结果\n${stepResults}`;
        if (totalChars + part.length > maxTotalChars) {
          // 超过总长度限制，跳过更早的
          break;
        }
        contextParts.push(part);
        totalChars += part.length;
      } else {
        // 较早的迭代只保留摘要
        const summary = prevIteration.results
          .map(r => {
            const result = r.result || '';
            // 只保留前100个字符作为摘要
            return result.length > 100 ? result.substring(0, 100) + '...' : result;
          })
          .join(', ');

        const part = `## 迭代 ${iterationNum} (摘要): ${summary || '(无结果)'}`;
        if (totalChars + part.length > maxTotalChars) {
          break;
        }
        contextParts.push(part);
        totalChars += part.length;
      }
    }

    if (contextParts.length === 0) return '';

    // 反转顺序，让最近的迭代在前面
    contextParts.reverse();

    return `以下是前序迭代的执行结果（共 ${currentIndex} 轮，请参考最新结果）：\n\n${contextParts.join('\n---\n\n')}\n\n`;
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    sessionId: string,
    run: LoopRun,
    iteration: LoopIteration,
    step: LoopStepDef,
    rl: RunningLoop,
    def: LoopDefinition
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
    const previousContext = this.buildPreviousContext(run, iteration.index, def);
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
        // 只广播消息到前端显示，不保存到数据库
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
  private async checkExitCondition(def: LoopDefinition, iteration: LoopIteration, agentType: AgentType, workdir: string): Promise<boolean> {
    if (!def.exitCondition) return false;

    // 基于退出条件类型检查
    if (def.exitConditionType === 'success') {
      // 成功条件：所有步骤都完成
      return iteration.status === 'done';
    } else if (def.exitConditionType === 'failure') {
      // 失败条件：任何步骤出错
      return iteration.status === 'error';
    }

    // 自定义条件：使用 Agent 判断
    if (def.exitCondition && iteration.results.length > 0) {
      try {
        const resultText = iteration.results
          .map(r => `[${r.stepId}]: ${r.result || '(无结果)'}`)
          .join('\n')
          .substring(0, 4000); // 限制长度

        const shouldExit = await this.evaluateExitConditionWithLlm(def.exitCondition, resultText, agentType, workdir);
        console.log(`[循环] Agent 退出条件判断: ${shouldExit ? '满足，停止循环' : '不满足，继续迭代'}`);
        return shouldExit;
      } catch (err) {
        console.error('[循环] Agent 退出条件判断失败，继续迭代:', (err as Error).message);
        return false;
      }
    }

    return false;
  }

  /**
   * 使用 Agent 评估退出条件
   */
  private async evaluateExitConditionWithLlm(exitCondition: string, resultText: string, agentType: AgentType, workdir: string): Promise<boolean> {
    const prompt = `你是一个任务完成度判断助手。请根据以下退出条件和任务执行结果，判断任务是否应该停止。

退出条件：${exitCondition}

执行结果：
${resultText}

请只回答 "是" 或 "否"，不需要解释。如果任务已经满足退出条件，回答"是"；如果不满足，回答"否"。`;

    // 创建一个临时 agent 来判断
    const agent = createAgent(workdir, agentType, {});

    return new Promise<boolean>((resolve) => {
      let response = '';
      let finished = false;

      const handler = (msg: { type: string; content: string | Record<string, unknown> }) => {
        if (finished) return;
        if (msg.type === 'text') {
          response += String(msg.content);
        } else if (msg.type === 'assistant') {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            response += content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
          }
        } else if (msg.type === 'result' || msg.type === 'completed') {
          finished = true;
          agent.removeListener('message', handler);
          // 将 agent 的自然语言回答归一化为「是否达到退出条件」的布尔判定
          const trimmed = response.trim();
          const lower = trimmed.toLowerCase();
          resolve(lower.includes('是') || lower.includes('yes'));
        }
      };

      agent.on('message', handler);

      // 兜底超时：若 30 秒内未收到 agent 的完成事件，则强制终止并据此判定
      setTimeout(() => {
        if (!finished) {
          finished = true;
          agent.removeListener('message', handler);
          agent.stop().catch(() => {});
          const trimmed = response.trim();
          const lower = trimmed.toLowerCase();
          resolve(lower.includes('是') || lower.includes('yes'));
        }
      }, 30000);

      agent.start().then(() => {
        agent.send(prompt);
      }).catch((err) => {
        finished = true;
        agent.removeListener('message', handler);
        console.error('[循环] 启动退出条件判断 agent 失败:', err);
        resolve(false);
      });
    });
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

    const reachedMax = run.currentIteration >= run.maxIterations - 1;

    // 循环正常完成（出错时继续下一步，不再因为错误而中断整个循环）
    if (reachedMax) {
      run.status = 'completed';
    } else {
      // 通过退出条件正常停止
      run.status = 'completed';
    }

    run.completedAt = Date.now();
  }

  /**
   * 延迟（可取消）
   */
  private delay(ms: number, rl: RunningLoop): Promise<void> {
    return new Promise(resolve => {
      // 使用唯一 key 防止多个延迟任务冲突
      const timerKey = `_delay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const timer = setTimeout(() => {
        rl.timers.delete(timerKey);
        resolve();
      }, ms);
      rl.timers.set(timerKey, timer);
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
   * 保存并广播循环状态（用于重要状态变更：开始、完成、错误、取消）
   */
  private saveAndBroadcast(sessionId: string, run: LoopRun): void {
    // 保存到数据库（loop-store 会自动清理迭代数据）
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
