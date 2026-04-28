import { EventEmitter } from 'events';
import type {
  WorkflowInstance,
  WorkflowStepRun,
  WorkflowStatus,
  StepStatus,
  StepMessage,
  AgentType,
} from './types';
import type { AgentBase } from './types';
import { createAgent } from './agents/factory';

const MAX_CONCURRENT = 3;

interface RunningWorkflow {
  agents: Map<string, AgentBase>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  cancelled: boolean;
}

interface SessionManagerLike {
  getSession(sessionId: string): { workdir: string; agentType: AgentType } | undefined;
  broadcast(sessionId: string, message: Record<string, unknown>): void;
}

class WorkflowEngine {
  private running: Map<string, RunningWorkflow> = new Map();
  private sessionManager: SessionManagerLike;

  constructor(sessionManager: SessionManagerLike) {
    this.sessionManager = sessionManager;
  }

  isRunning(workflowId: string): boolean {
    return this.running.has(workflowId);
  }

  async start(sessionId: string, instance: WorkflowInstance): Promise<void> {
    if (this.detectCycles(instance.steps)) {
      instance.status = 'error';
      instance.steps.forEach(s => {
        s.status = 'error';
        s.error = '检测到循环依赖';
        s.completedAt = Date.now();
      });
      instance.completedAt = Date.now();
      this.broadcastWorkflow(sessionId, instance);
      return;
    }

    const rw: RunningWorkflow = {
      agents: new Map(),
      timers: new Map(),
      cancelled: false,
    };
    this.running.set(instance.id, rw);

    instance.status = 'running';
    instance.startedAt = Date.now();
    this.broadcastWorkflow(sessionId, instance);

    try {
      await this.executeSteps(sessionId, instance);
      if (!rw.cancelled) {
        this.checkCompletion(instance);
      }
    } catch (err) {
      instance.status = 'error';
      instance.completedAt = Date.now();
    } finally {
      this.cleanup(instance.id);
      this.broadcastWorkflow(sessionId, instance);
    }
  }

  pause(sessionId: string, instance: WorkflowInstance): void {
    const rw = this.running.get(instance.id);
    if (rw) {
      rw.cancelled = true;
      for (const agent of rw.agents.values()) {
        agent.stop().catch(() => {});
      }
      for (const timer of rw.timers.values()) {
        clearTimeout(timer);
      }
    }

    instance.status = 'paused';
    for (const step of instance.steps) {
      if (step.status === 'running') {
        step.status = 'error';
        step.error = '用户暂停';
        step.completedAt = Date.now();
      } else if (step.status === 'pending') {
        step.status = 'skipped';
      }
    }
    instance.completedAt = Date.now();
    this.broadcastWorkflow(sessionId, instance);
  }

  cancel(sessionId: string, instance: WorkflowInstance): void {
    const rw = this.running.get(instance.id);
    if (rw) {
      rw.cancelled = true;
      for (const agent of rw.agents.values()) {
        agent.stop().catch(() => {});
      }
      for (const timer of rw.timers.values()) {
        clearTimeout(timer);
      }
    }

    instance.status = 'cancelled';
    for (const step of instance.steps) {
      if (step.status === 'running') {
        step.status = 'cancelled';
        step.error = '用户取消';
        step.completedAt = Date.now();
      } else if (step.status === 'pending') {
        step.status = 'cancelled';
      }
    }
    instance.completedAt = Date.now();
    this.broadcastWorkflow(sessionId, instance);
  }

  retryStep(sessionId: string, instance: WorkflowInstance, stepId: string): void {
    const step = instance.steps.find(s => s.id === stepId);
    if (!step) return;
    if (step.status !== 'error' && step.status !== 'cancelled') return;

    step.status = 'pending';
    step.result = null;
    step.error = null;
    step.messages = [];
    step.startedAt = null;
    step.completedAt = null;

    for (const s of instance.steps) {
      if (s.status === 'skipped') {
        const allDeps = s.dependsOn.every(depId => {
          const dep = instance.steps.find(x => x.id === depId);
          return dep && (dep.status === 'done' || dep.status === 'pending' || dep.status === 'running');
        });
        if (allDeps) {
          s.status = 'pending';
          s.error = null;
        }
      }
    }

    this.broadcastWorkflow(sessionId, instance);

    if (!this.running.has(instance.id)) {
      const rw: RunningWorkflow = {
        agents: new Map(),
        timers: new Map(),
        cancelled: false,
      };
      this.running.set(instance.id, rw);
      instance.status = 'running';
      this.broadcastWorkflow(sessionId, instance);

      this.executeSteps(sessionId, instance).then(() => {
        if (!rw.cancelled) {
          this.checkCompletion(instance);
        }
      }).catch(() => {
        instance.status = 'error';
        instance.completedAt = Date.now();
      }).finally(() => {
        this.cleanup(instance.id);
        this.broadcastWorkflow(sessionId, instance);
      });
    }
  }

  private async executeSteps(sessionId: string, instance: WorkflowInstance): Promise<void> {
    const rw = this.running.get(instance.id);
    if (!rw || rw.cancelled) return;

    const readySteps = this.resolveReadySteps(instance);
    if (readySteps.length === 0) return;

    for (let i = 0; i < readySteps.length; i += MAX_CONCURRENT) {
      if (rw.cancelled) return;
      const batch = readySteps.slice(i, i + MAX_CONCURRENT);
      await Promise.allSettled(batch.map(s => this.executeStep(sessionId, instance, s)));
      if (rw.cancelled) return;
      await this.executeSteps(sessionId, instance);
    }
  }

  private resolveReadySteps(instance: WorkflowInstance): WorkflowStepRun[] {
    const ready: WorkflowStepRun[] = [];
    for (const step of instance.steps) {
      if (step.status !== 'pending') continue;
      const allDepsDone = step.dependsOn.every(depId => {
        const dep = instance.steps.find(s => s.id === depId);
        return dep && dep.status === 'done';
      });
      if (allDepsDone) {
        ready.push(step);
      }
    }
    return ready;
  }

  private async executeStep(sessionId: string, instance: WorkflowInstance, step: WorkflowStepRun): Promise<void> {
    const rw = this.running.get(instance.id);
    if (!rw || rw.cancelled) return;

    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    step.status = 'running';
    step.startedAt = Date.now();
    this.broadcastStepStatus(sessionId, instance.id, step);
    this.broadcastWorkflow(sessionId, instance);

    const fullPrompt = this.buildContext(instance, step);
    const agent = createAgent(session.workdir, session.agentType as AgentType, { model: step.model });
    rw.agents.set(step.id, agent);

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
        step.messages.push(entry);
        if (step.messages.length > 100) {
          step.messages = step.messages.slice(-100);
        }
        step.result = step.messages.map(m => m.content).filter(Boolean).join('\n');
        this.broadcastStepMessage(sessionId, instance.id, step.id, entry);
      }
    };

    agent.on('message', handler);

    const timer = setTimeout(() => {
      step.status = 'error';
      step.error = '执行超时';
      step.completedAt = Date.now();
      agent.stop().catch(() => {});
    }, step.timeout);
    rw.timers.set(step.id, timer);

    let settled = false;
    const donePromise = new Promise<void>(resolve => {
      agent.once('stopped', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rw.timers.delete(step.id);
          resolve();
        }
      });
    });

    try {
      await agent.start();
      await agent.send(fullPrompt);
      await donePromise;

      if (step.status === 'running') {
        step.status = 'done';
        step.completedAt = Date.now();
      }
    } catch (err) {
      if (step.status === 'running') {
        step.status = 'error';
        step.error = (err as Error).message;
        step.completedAt = Date.now();
      }
    } finally {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rw.timers.delete(step.id);
      }
      agent.removeListener('message', handler);
      agent.stop().catch(() => {});
      rw.agents.delete(step.id);
    }

    this.broadcastStepStatus(sessionId, instance.id, step);
    this.broadcastWorkflow(sessionId, instance);
  }

  private buildContext(instance: WorkflowInstance, step: WorkflowStepRun): string {
    if (step.dependsOn.length === 0) {
      return step.prompt;
    }

    const contextParts: string[] = [];
    for (const depId of step.dependsOn) {
      const depStep = instance.steps.find(s => s.id === depId);
      if (depStep) {
        const result = depStep.result || '(无结果)';
        contextParts.push(`## ${depStep.name} 的结果\n${result}\n`);
      }
    }

    if (contextParts.length === 0) {
      return step.prompt;
    }

    return `以下是前序步骤的执行结果，请参考：\n\n${contextParts.join('---\n\n')}\n请根据上述信息完成以下任务：\n${step.prompt}`;
  }

  private detectCycles(steps: WorkflowStepRun[]): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (stepId: string): boolean => {
      if (inStack.has(stepId)) return true;
      if (visited.has(stepId)) return false;

      visited.add(stepId);
      inStack.add(stepId);

      const step = steps.find(s => s.id === stepId);
      if (step) {
        for (const depId of step.dependsOn) {
          if (dfs(depId)) return true;
        }
      }

      inStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (dfs(step.id)) return true;
    }
    return false;
  }

  private checkCompletion(instance: WorkflowInstance): void {
    if (instance.status !== 'running') return;

    const allDone = instance.steps.every(s => s.status === 'done');
    const hasError = instance.steps.some(s => s.status === 'error' || s.status === 'cancelled');

    if (allDone) {
      instance.status = 'done';
      instance.completedAt = Date.now();
    } else if (hasError) {
      instance.status = 'error';
      instance.completedAt = Date.now();
    }
  }

  private cleanup(workflowId: string): void {
    const rw = this.running.get(workflowId);
    if (rw) {
      for (const timer of rw.timers.values()) {
        clearTimeout(timer);
      }
      this.running.delete(workflowId);
    }
  }

  private broadcastWorkflow(sessionId: string, instance: WorkflowInstance): void {
    this.sessionManager.broadcast(sessionId, {
      type: 'workflow_status',
      workflow_id: instance.id,
      status: instance.status,
      instance,
    });
  }

  private broadcastStepStatus(sessionId: string, workflowId: string, step: WorkflowStepRun): void {
    this.sessionManager.broadcast(sessionId, {
      type: 'workflow_step_status',
      workflow_id: workflowId,
      step_id: step.id,
      status: step.status,
      result: step.result,
      error: step.error,
    });
  }

  private broadcastStepMessage(sessionId: string, workflowId: string, stepId: string, entry: StepMessage): void {
    this.sessionManager.broadcast(sessionId, {
      type: 'workflow_step_message',
      workflow_id: workflowId,
      step_id: stepId,
      content: entry.content,
      content_type: entry.type,
    });
  }
}

export default WorkflowEngine;
