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
import { getDb } from './db';

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

    // 获取会话信息
    const session = this.sessionManager.getSession(sessionId);
    const agentType = def.steps[0]?.agentType || session?.agentType || 'mimo';
    const workdir = session?.workdir || process.env.HOME || '/root';

    while (run.currentIteration < maxIter) {
      if (rl.cancelled || rl.paused) return;

      // 创建新的迭代
      const iteration = LoopStore.createIteration(run.currentIteration);
      run.iterations.push(iteration);

      // 执行迭代
      await this.executeIteration(sessionId, run, def, iteration, rl);

      // 检查退出条件
      if (await this.checkExitCondition(def, iteration, agentType, workdir)) {
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

        const result = await this.executeStep(sessionId, run, iteration, step, rl, def);
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
          const trimmed = response.trim();
          const lower = trimmed.toLowerCase();
          console.log(`[循环] Agent 退出条件判断原始回答: "${trimmed}"`);
          resolve(lower.includes('是') || lower.includes('yes'));
        }
      };

      agent.on('message', handler);

      // 设置超时
      setTimeout(() => {
        if (!finished) {
          finished = true;
          agent.removeListener('message', handler);
          agent.stop().catch(() => {});
          const trimmed = response.trim();
          const lower = trimmed.toLowerCase();
          console.log(`[循环] Agent 退出条件判断原始回答: "${trimmed}"`);
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

    const hasError = run.iterations.some(i => i.status === 'error');
    const reachedMax = run.currentIteration >= run.maxIterations - 1;

    if (hasError) {
      run.status = 'error';
    } else if (reachedMax) {
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
      console.log(`[循环] 保存循环状态: ${run.id}, 状态: ${run.status}`);
      this.sessionManager.saveLoop(sessionId, run);
    } else {
      console.log('[循环] 警告: sessionManager.saveLoop 未定义');
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
