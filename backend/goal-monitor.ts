/**
 * GoalMonitor - 目标监控自动恢复系统
 * 监控 agent 任务执行，当 agent 提前退出时自动重启并继续
 */
import { EventEmitter } from 'events';
import type { Goal, GoalJSON, GoalStatus, AgentType, SessionMessage } from './types';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_MAX_ATTEMPTS = 10;
const RESTART_DELAY_MS = 30000; // 30秒重启间隔
const COMPLETION_CHECK_TIMEOUT_MS = 60000; // 1分钟超时判断

interface SessionManagerLike {
  getSession(sessionId: string): any;
  sendMessage(sessionId: string, message: string): Promise<void>;
  broadcast(sessionId: string, message: Record<string, unknown>): void;
}

interface SummaryServiceLike {
  summarizeSession(messages: SessionMessage[], agentType: AgentType, workdir?: string): Promise<{ summary: string }>;
}

// 完成关键词列表（需要在独立声明中匹配，避免误判普通输出中的词汇）
const COMPLETION_KEYWORDS = [
  '任务已完成', '任务完成', '已完成任务', '已完成所有',
  'all tasks done', 'task completed', 'successfully completed',
  '实现完成', '功能已完成', '代码已完成', '开发已完成',
];

// 失败/错误关键词列表
const FAILURE_KEYWORDS = [
  '失败', '错误', 'error', 'failed', 'crash',
  '无法', '不能', 'exception', 'fatal',
];

export default class GoalMonitor extends EventEmitter {
  private goals: Map<string, Goal> = new Map();
  private sessionGoalMap: Map<string, string> = new Map(); // sessionId -> goalId
  private restartTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private sessionManager: SessionManagerLike;
  private summaryService: SummaryServiceLike | null = null;
  private llmJudgeFn: ((prompt: string) => Promise<string>) | null = null;

  constructor(sessionManager: SessionManagerLike) {
    super();
    this.sessionManager = sessionManager;
  }

  /**
   * 获取 SessionManager 实例
   */
  getSessionManager(): SessionManagerLike {
    return this.sessionManager;
  }

  /**
   * 设置摘要服务（延迟注入，避免循环依赖）
   */
  setSummaryService(summaryService: SummaryServiceLike): void {
    this.summaryService = summaryService;
  }

  /**
   * 设置 LLM 判断函数（延迟注入）
   */
  setLlmJudgeFn(fn: (prompt: string) => Promise<string>): void {
    this.llmJudgeFn = fn;
  }

  /**
   * 创建新的监控目标
   */
  async createGoal(params: {
    sessionId: string;
    originalPrompt: string;
    maxAttempts?: number;
    agentType: AgentType;
    workdir: string;
  }): Promise<Goal> {
    const { sessionId, originalPrompt, maxAttempts = DEFAULT_MAX_ATTEMPTS, agentType, workdir } = params;

    // 检查是否已有活跃目标
    const existingGoalId = this.sessionGoalMap.get(sessionId);
    if (existingGoalId) {
      const existing = this.goals.get(existingGoalId);
      if (existing && existing.status === 'active') {
        throw new Error('该会话已有活跃的监控目标');
      }
    }

    const goal: Goal = {
      id: `goal_${uuidv4().slice(0, 8)}`,
      sessionId,
      originalPrompt,
      status: 'active',
      attemptCount: 1,
      maxAttempts,
      progress: '',
      startedAt: Date.now(),
      lastAttemptAt: Date.now(),
      agentType,
      workdir,
    };

    this.goals.set(goal.id, goal);
    this.sessionGoalMap.set(sessionId, goal.id);

    console.log(`[GoalMonitor] 创建目标 ${goal.id}, 会话 ${sessionId}, 最大尝试 ${maxAttempts}`);
    this.emit('goal_created', goal);
    this.broadcastGoal(goal);

    // 发送初始消息给 agent 执行任务
    const sendInitialMessage = async () => {
      try {
        console.log(`[GoalMonitor] 准备发送初始任务给会话 ${sessionId}`);
        console.log(`[GoalMonitor] sessionManager 类型:`, typeof this.sessionManager);
        console.log(`[GoalMonitor] sessionManager.getSession 方法:`, typeof this.sessionManager.getSession);
        
        const session = this.sessionManager.getSession(sessionId);
        console.log(`[GoalMonitor] 获取会话结果:`, session ? '存在' : '不存在');
        
        if (session) {
          console.log(`[GoalMonitor] 会话属性:`, {
            id: session.id,
            isWorking: session.isWorking,
            hasAgent: !!session.agent,
            agentType: session.agentType
          });
        }
        
        if (!session) {
          console.error(`[GoalMonitor] 会话 ${sessionId} 不存在`);
          return;
        }
        
        if (!session.isWorking) {
          console.log(`[GoalMonitor] 会话空闲，发送初始任务`);
          console.log(`[GoalMonitor] 调用 sendMessage...`);
          await this.sessionManager.sendMessage(sessionId, originalPrompt);
          console.log(`[GoalMonitor] sendMessage 完成`);
        } else {
          console.log(`[GoalMonitor] 会话 ${sessionId} 正在工作中，等待完成后发送`);
          // 等待当前任务完成后再发送
          const waitForCompletion = () => {
            return new Promise<void>((resolve) => {
              const checkInterval = setInterval(() => {
                const s = this.sessionManager.getSession(sessionId);
                if (s && !s.isWorking) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 1000);
            });
          };
          await waitForCompletion();
          console.log(`[GoalMonitor] 等待完成，现在发送初始任务`);
          await this.sessionManager.sendMessage(sessionId, originalPrompt);
          console.log(`[GoalMonitor] 等待后已发送初始任务给会话 ${sessionId}`);
        }
      } catch (err) {
        console.error(`[GoalMonitor] 发送初始任务失败:`, (err as Error).message);
        console.error(`[GoalMonitor] 错误堆栈:`, (err as Error).stack);
      }
    };
    
    // 异步发送，不阻塞目标创建
    sendInitialMessage();

    return goal;
  }

  /**
   * 获取目标
   */
  getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * 获取会话关联的目标
   */
  getGoalBySession(sessionId: string): Goal | undefined {
    const goalId = this.sessionGoalMap.get(sessionId);
    return goalId ? this.goals.get(goalId) : undefined;
  }

  /**
   * 列出所有目标
   */
  listGoals(status?: GoalStatus): Goal[] {
    const all = Array.from(this.goals.values());
    if (status) {
      return all.filter(g => g.status === status);
    }
    return all;
  }

  /**
   * 取消监控目标
   */
  cancelGoal(goalId: string): boolean {
    const goal = this.goals.get(goalId);
    if (!goal) return false;

    goal.status = 'cancelled';
    goal.completedAt = Date.now();

    // 清除重启定时器
    const timer = this.restartTimers.get(goalId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(goalId);
    }

    console.log(`[GoalMonitor] 取消目标 ${goalId}`);
    this.emit('goal_cancelled', goal);
    this.broadcastGoal(goal);

    return true;
  }

  /**
   * 更新目标最大重试次数
   */
  updateGoal(goalId: string, updates: Partial<Pick<Goal, 'maxAttempts'>>): boolean {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== 'active') return false;

    if (updates.maxAttempts !== undefined) {
      goal.maxAttempts = updates.maxAttempts;
    }

    this.broadcastGoal(goal);
    return true;
  }

  /**
   * 当 agent 停止时调用，检查是否需要重启
   */
  async onAgentStopped(sessionId: string, exitCode?: number): Promise<void> {
    const goalId = this.sessionGoalMap.get(sessionId);
    if (!goalId) return;

    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== 'active') return;

    console.log(`[GoalMonitor] Agent 停止, 会话 ${sessionId}, 退出码 ${exitCode}, 目标 ${goalId}`);

    // 1. 判断任务是否完成
    const isComplete = await this.checkCompletion(goal, exitCode);

    if (isComplete) {
      goal.status = 'completed';
      goal.completedAt = Date.now();
      console.log(`[GoalMonitor] 任务完成 ${goalId}`);
      this.emit('goal_completed', goal);
      this.broadcastGoal(goal);
      return;
    }

    // 2. 检查重试次数
    if (goal.attemptCount >= goal.maxAttempts) {
      goal.status = 'error';
      goal.error = `达到最大重试次数 (${goal.maxAttempts})`;
      goal.completedAt = Date.now();
      console.log(`[GoalMonitor] 达到最大重试 ${goalId}`);
      this.emit('goal_failed', goal);
      this.broadcastGoal(goal);
      return;
    }

    // 3. 安排重启
    console.log(`[GoalMonitor] 安排 ${RESTART_DELAY_MS / 1000}秒后重启, 目标 ${goalId}`);
    this.scheduleRestart(goal);
  }

  /**
   * 判断任务是否完成
   */
  private async checkCompletion(goal: Goal, exitCode?: number): Promise<boolean> {
    const session = this.sessionManager.getSession(goal.sessionId);
    if (!session) return false;

    // 策略1: 退出码检查 - 非零退出码通常意味着崩溃
    if (exitCode !== undefined && exitCode !== 0) {
      console.log(`[GoalMonitor] 非零退出码 ${exitCode}，可能未完成`);
      // 不直接返回 false，继续其他检查
    }

    // 策略2: LLM 判断（优先使用，更准确）
    if (this.llmJudgeFn && this.summaryService) {
      try {
        return await this.llmJudgeCompletion(goal, session);
      } catch (err) {
        console.error(`[GoalMonitor] LLM 判断失败:`, (err as Error).message);
      }
    }

    // 策略3: 启发式关键词检测（仅在最后一条消息中检查，且需要更严格的匹配）
    const lastMessages = this.getRecentMessages(session, 3);
    const lastAssistantText = lastMessages
      .filter((m: any) => m.role === 'assistant')
      .map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join('\n');

    // 检查完成关键词 - 需要在最后一行或独立声明中匹配
    const hasCompletionKeyword = COMPLETION_KEYWORDS.some(kw => {
      // 检查是否在最后一行
      const lines = lastAssistantText.split('\n');
      const lastLine = lines[lines.length - 1]?.trim() || '';
      if (lastLine.includes(kw)) return true;
      // 检查是否是独立的完成声明（前后有换行或标点）
      const regex = new RegExp(`(?:^|[\\n。！？])\\s*${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[\\n。！？]|$)`);
      return regex.test(lastAssistantText);
    });

    // 检查失败关键词
    const hasFailureKeyword = FAILURE_KEYWORDS.some(kw =>
      lastAssistantText.includes(kw)
    );

    if (hasCompletionKeyword && !hasFailureKeyword) {
      console.log(`[GoalMonitor] 检测到完成关键词`);
      return true;
    }

    // 默认: 退出码为0且有完成关键词时认为完成
    if (exitCode === 0 && hasCompletionKeyword) {
      return true;
    }

    return false;
  }

  /**
   * 使用 LLM 判断任务是否完成
   */
  private async llmJudgeCompletion(goal: Goal, session: any): Promise<boolean> {
    if (!this.llmJudgeFn || !this.summaryService) return false;

    const { summary } = await this.summaryService.summarizeSession(
      session.messages.slice(-50), // 最近50条消息
      goal.agentType,
      goal.workdir
    );

    const judgePrompt = `你是一个任务完成度判断器。请根据以下信息判断任务是否已完成。

原始任务: ${goal.originalPrompt}

执行摘要: ${summary}

之前的进度: ${goal.progress || '(无)'}

请只回答 "已完成" 或 "未已完成"，不要有其他内容。`;

    const result = await this.llmJudgeFn(judgePrompt);
    const isComplete = result.includes('已完成') && !result.includes('未已完成');

    console.log(`[GoalMonitor] LLM 判断结果: ${result.trim()}, isComplete=${isComplete}`);
    return isComplete;
  }

  /**
   * 获取最近的消息
   */
  private getRecentMessages(session: any, count: number): any[] {
    if (!session.messages) return [];
    return session.messages.slice(-count);
  }

  /**
   * 安排重启
   */
  private scheduleRestart(goal: Goal): void {
    const timer = setTimeout(async () => {
      this.restartTimers.delete(goal.id);
      await this.performRestart(goal);
    }, RESTART_DELAY_MS);

    this.restartTimers.set(goal.id, timer);
    console.log(`[GoalMonitor] 已安排重启定时器, 目标 ${goal.id}`);
  }

  /**
   * 执行重启
   */
  private async performRestart(goal: Goal): Promise<void> {
    if (goal.status !== 'active') return;

    const session = this.sessionManager.getSession(goal.sessionId);
    if (!session) {
      goal.status = 'error';
      goal.error = '会话不存在';
      this.broadcastGoal(goal);
      return;
    }

    goal.attemptCount++;
    goal.lastAttemptAt = Date.now();

    // 生成进度摘要
    const progressSummary = await this.generateProgressSummary(goal, session);
    goal.progress = progressSummary;

    console.log(`[GoalMonitor] 第 ${goal.attemptCount} 次重启, 目标 ${goal.id}`);

    // 构建恢复消息
    const resumeMessage = this.buildResumeMessage(goal, progressSummary);

    // 发送消息给 agent（会自动创建新 agent 进程）
    try {
      await this.sessionManager.sendMessage(goal.sessionId, resumeMessage);
    } catch (err) {
      console.error(`[GoalMonitor] 重启发送消息失败:`, (err as Error).message);
      // 发送失败，安排下一次重试
      if (goal.attemptCount < goal.maxAttempts) {
        this.scheduleRestart(goal);
      } else {
        goal.status = 'error';
        goal.error = `重启失败: ${(err as Error).message}`;
        this.broadcastGoal(goal);
      }
    }
  }

  /**
   * 生成进度摘要
   */
  private async generateProgressSummary(goal: Goal, session: any): Promise<string> {
    if (!this.summaryService) {
      // 没有摘要服务，用简单的方式
      return this.generateSimpleProgressSummary(goal, session);
    }

    try {
      const { summary } = await this.summaryService.summarizeSession(
        session.messages.slice(-100),
        goal.agentType,
        goal.workdir
      );
      return summary;
    } catch (err) {
      console.error(`[GoalMonitor] 生成摘要失败:`, (err as Error).message);
      return this.generateSimpleProgressSummary(goal, session);
    }
  }

  /**
   * 生成简单的进度摘要（不依赖 LLM）
   */
  private generateSimpleProgressSummary(goal: Goal, session: any): string {
    const messages = session.messages || [];
    const assistantMessages = messages
      .filter((m: any) => m.role === 'assistant')
      .slice(-10);

    if (assistantMessages.length === 0) {
      return '尚无进展';
    }

    // 提取最近的工具调用和文本输出
    const recentActivity: string[] = [];
    for (const msg of assistantMessages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      // 截取关键信息
      const lines = content.split('\n').filter((l: string) => l.trim());
      recentActivity.push(lines.slice(0, 5).join('\n'));
    }

    return `最近活动:\n${recentActivity.join('\n---\n')}`;
  }

  /**
   * 构建恢复消息
   */
  private buildResumeMessage(goal: Goal, progressSummary: string): string {
    return `[任务进度摘要 - 第${goal.attemptCount}次尝试]
原始任务: ${goal.originalPrompt}
已完成的工作:
${progressSummary}

[说明]
之前的 agent 因为上下文溢出或其他原因退出了。请根据上述进度继续完成任务。
如果你认为任务已经完成，请明确说明"任务已完成"。
如果没有完成，请继续执行剩余的工作。`;
  }

  /**
   * 广播目标状态给前端
   */
  private broadcastGoal(goal: Goal): void {
    const goalJson: GoalJSON = {
      id: goal.id,
      sessionId: goal.sessionId,
      originalPrompt: goal.originalPrompt,
      status: goal.status,
      attemptCount: goal.attemptCount,
      maxAttempts: goal.maxAttempts,
      progress: goal.progress,
      startedAt: goal.startedAt,
      lastAttemptAt: goal.lastAttemptAt,
      completedAt: goal.completedAt,
      error: goal.error,
      agentType: goal.agentType,
      workdir: goal.workdir,
    };

    this.sessionManager.broadcast(goal.sessionId, {
      type: 'goal_status',
      goal: goalJson,
    });
  }

  /**
   * 清理所有定时器（用于关闭时）
   */
  cleanup(): void {
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
  }
}
