# 工作流系统（串行+并行）实施计划

## 一、需求概述

在现有并行子任务系统基础上，扩展支持**工作流编排**功能：

1. **串行执行**：步骤按顺序执行，上一步完成才启动下一步
2. **并行执行**：多个步骤同时执行
3. **混合模式**：工作流内同时包含串行和并行步骤
4. **跨 Agent 编排**：每步可指定不同 Agent 类型（Claude/OpenCode/Codex）
5. **结果传递**：上一步的输出可作为下一步的输入上下文
6. **工作流模板**：可保存/加载/复用工作流定义

### 典型使用场景

```
场景：全栈代码审查 + 测试 + 提交

工作流：
├─ Step 1: [Claude Code] 执行开发任务 → 输出代码变更
├─ Step 2: [OpenCode] 代码审查 → 输出审查意见
├─ Step 3: [Codex] 运行测试 → 输出测试结果
└─ Step 4: [Claude Code] 汇总结果，提交代码 → 完成
```

---

## 二、数据模型设计

### 2.1 TypeScript 类型定义

```typescript
// backend/types/index.ts 扩展

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface WorkflowStep {
  id: string;                    // 唯一 ID：step_时间戳_索引
  name: string;
  description: string;           // 发送给 Agent 的 prompt
  agentType: AgentType;          // claude-code | opencode | codex
  model?: string;                // 可选：覆盖默认模型
  dependsOn: string[];           // 依赖的步骤 ID（空数组=立即执行）
  status: StepStatus;
  result: string | null;
  messages: WorkflowStepMessage[];
  error: string | null;
  timeout: number;               // 超时时间（毫秒），默认10分钟
  createdAt: number | null;
  completedAt: number | null;
}

export interface WorkflowStepMessage {
  type: string;
  content: string;
  time: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  currentStep: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: Omit<WorkflowStep, 'id' | 'status' | 'result' | 'messages' | 'error' | 'createdAt' | 'completedAt'>[];
  createdAt: number;
  usageCount: number;
}
```

### 2.2 工作流定义示例

```typescript
const workflow: Workflow = {
  id: 'wf_1714000000000',
  name: '开发-审查-测试-提交',
  description: '完整的代码开发工作流',
  createdAt: 1714000000000,
  updatedAt: 1714000000000,

  steps: [
    {
      id: 'step_1714000000000_0',
      name: '执行开发任务',
      description: '根据需求实现功能代码',
      agentType: 'claude-code',
      model: undefined,
      dependsOn: [],
      status: 'pending',
      result: null,
      messages: [],
      error: null,
      timeout: 600000,
      createdAt: null,
      completedAt: null
    },
    {
      id: 'step_1714000000000_1',
      name: '代码审查',
      description: '审查上一步的代码变更，给出改进建议',
      agentType: 'opencode',
      model: undefined,
      dependsOn: ['step_1714000000000_0'],
      status: 'pending',
      result: null,
      messages: [],
      error: null,
      timeout: 600000,
      createdAt: null,
      completedAt: null
    },
    {
      id: 'step_1714000000000_2',
      name: '运行测试',
      description: '运行项目测试套件，验证代码质量',
      agentType: 'codex',
      model: undefined,
      dependsOn: ['step_1714000000000_0'], // 与 Step 1 并行
      status: 'pending',
      result: null,
      messages: [],
      error: null,
      timeout: 600000,
      createdAt: null,
      completedAt: null
    },
    {
      id: 'step_1714000000000_3',
      name: '汇总提交',
      description: '汇总审查和测试结果，提交代码',
      agentType: 'claude-code',
      model: undefined,
      dependsOn: ['step_1714000000000_1', 'step_1714000000000_2'],
      status: 'pending',
      result: null,
      messages: [],
      error: null,
      timeout: 600000,
      createdAt: null,
      completedAt: null
    }
  ],

  status: 'idle',
  currentStep: null,
  startedAt: null,
  completedAt: null
};
```

### 2.3 步骤依赖关系可视化

```
Step 1 (开发) ──┬──> Step 2 (审查) ──┬──> Step 4 (提交)
                │                     │
                └──> Step 3 (测试) ──┘
```

- `dependsOn` 定义了执行顺序（DAG 有向无环图）
- 空 `dependsOn` = 入口步骤，工作流启动时立即执行
- 多个步骤依赖同一前置 = 前置完成后并行执行
- 所有依赖完成 = 该步骤自动触发
- **循环依赖检测**：创建/更新工作流时必须检测，如有循环则拒绝执行

---

## 三、后端实现方案

### 3.1 新增模块

| 文件 | 作用 |
|------|------|
| `backend/workflow-engine.ts` | 工作流执行引擎（核心） |
| `backend/routes/workflows.ts` | 工作流 CRUD API |

### 3.2 WorkflowEngine 类设计

```typescript
// backend/workflow-engine.ts

import { EventEmitter } from 'events';
import { Workflow, WorkflowStep, AgentType } from './types';
import { createAgent } from './agents/factory';
import type SessionManager from './sessions';

interface RunningWorkflow {
  agents: EventEmitter[];
  cancelled: boolean;
}

class WorkflowEngine {
  private sessionManager: SessionManager;
  private runningWorkflows: Map<string, RunningWorkflow>;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.runningWorkflows = new Map();
  }

  /**
   * 启动工作流执行
   */
  async start(sessionId: string, workflow: Workflow): Promise<void> {
    if (this._hasCyclicDependency(workflow.steps)) {
      throw new Error('工作流存在循环依赖，无法执行');
    }

    workflow.status = 'running';
    workflow.startedAt = Date.now();

    this.runningWorkflows.set(workflow.id, {
      agents: [],
      cancelled: false
    });

    const entrySteps = workflow.steps.filter(s => s.dependsOn.length === 0);
    await this._executeSteps(sessionId, workflow, entrySteps);
    this._checkCompletion(workflow);
    this.runningWorkflows.delete(workflow.id);
  }

  /**
   * 执行一组步骤（可能是并行）
   */
  private async _executeSteps(
    sessionId: string,
    workflow: Workflow,
    steps: WorkflowStep[]
  ): Promise<void> {
    if (steps.length === 0) return;

    const workflowData = this.runningWorkflows.get(workflow.id);
    if (workflowData?.cancelled) return;

    await Promise.allSettled(
      steps.map(step => this._executeStep(sessionId, workflow, step))
    );

    const nextSteps = workflow.steps.filter(s => {
      if (s.status !== 'pending') return false;
      return s.dependsOn.every(depId => {
        const dep = workflow.steps.find(ss => ss.id === depId);
        return dep?.status === 'done';
      });
    });

    if (nextSteps.length > 0) {
      await this._executeSteps(sessionId, workflow, nextSteps);
    }
  }

  /**
   * 执行单个步骤
   */
  private async _executeStep(
    sessionId: string,
    workflow: Workflow,
    step: WorkflowStep
  ): Promise<void> {
    const workflowData = this.runningWorkflows.get(workflow.id);
    if (workflowData?.cancelled) return;

    step.status = 'running';
    step.createdAt = Date.now();
    workflow.currentStep = step.id;

    this.sessionManager.broadcast(sessionId, {
      type: 'workflow_step_status',
      workflow_id: workflow.id,
      step_id: step.id,
      status: 'running'
    });

    const contextPrompt = this._buildContextPrompt(workflow, step);
    const fullPrompt = `${contextPrompt}\n\n${step.description}`;

    try {
      const agent = createAgent(step.agentType, `wf_${workflow.id}_${step.id}`, {
        model: step.model
      });

      if (workflowData) {
        workflowData.agents.push(agent);
      }

      const messages: WorkflowStepMessage[] = [];
      const handler = (msg: { type: string; content?: string }) => {
        this.sessionManager.broadcast(sessionId, {
          ...msg,
          workflow_id: workflow.id,
          step_id: step.id
        });

        if (['text', 'assistant', 'tool_use', 'tool_result'].includes(msg.type)) {
          messages.push({ type: msg.type, content: msg.content || '', time: Date.now() });
        }
      };

      agent.on('message', handler);
      await agent.send(fullPrompt);
      await this._waitForAgentCompletion(agent, step.timeout);
      agent.removeListener('message', handler);

      if (workflowData) {
        const idx = workflowData.agents.indexOf(agent);
        if (idx > -1) workflowData.agents.splice(idx, 1);
      }

      step.status = 'done';
      step.result = messages.map(m => m.content).filter(Boolean).join('\n');
      step.messages = messages;
      step.completedAt = Date.now();

      this.sessionManager.broadcast(sessionId, {
        type: 'workflow_step_status',
        workflow_id: workflow.id,
        step_id: step.id,
        status: 'done',
        result: step.result
      });

    } catch (err) {
      step.status = 'error';
      step.error = (err as Error).message;
      step.completedAt = Date.now();

      this.sessionManager.broadcast(sessionId, {
        type: 'workflow_step_status',
        workflow_id: workflow.id,
        step_id: step.id,
        status: 'error',
        error: (err as Error).message
      });
    }
  }

  private _waitForAgentCompletion(agent: EventEmitter, timeout = 600000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        (agent as any).stop?.();
        reject(new Error('步骤执行超时'));
      }, timeout);

      agent.once('stopped', () => {
        clearTimeout(timer);
        resolve();
      });

      agent.once('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private _buildContextPrompt(workflow: Workflow, step: WorkflowStep): string {
    const contexts = step.dependsOn
      .map(depId => workflow.steps.find(s => s.id === depId))
      .filter(s => s?.status === 'done')
      .map(s => `## ${s!.name} 的结果\n\n${s!.result}`);

    return contexts.length > 0
      ? `以下是前序步骤的执行结果，请参考：\n\n${contexts.join('\n\n---\n\n')}`
      : '';
  }

  pause(sessionId: string, workflowId: string): void {
    const workflowData = this.runningWorkflows.get(workflowId);
    if (workflowData) {
      workflowData.cancelled = true;
      workflowData.agents.forEach(agent => {
        try { (agent as any).stop?.(); } catch { /* ignore */ }
      });

      const session = (this.sessionManager as any).sessions?.get(sessionId);
      if (session?.workflows) {
        const workflow = session.workflows.find((w: Workflow) => w.id === workflowId);
        if (workflow) {
          workflow.status = 'paused';
          workflow.steps.forEach(s => {
            if (s.status === 'pending') s.status = 'skipped';
          });
        }
      }

      this.runningWorkflows.delete(workflowId);
    }
  }

  private _checkCompletion(workflow: Workflow): void {
    const allDone = workflow.steps.every(s =>
      (['done', 'error', 'skipped'] as StepStatus[]).includes(s.status)
    );
    if (allDone) {
      workflow.status = workflow.steps.some(s => s.status === 'error') ? 'error' : 'done';
      workflow.completedAt = Date.now();
    }
  }

  private _hasCyclicDependency(steps: WorkflowStep[]): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (stepId: string): boolean => {
      visited.add(stepId);
      recursionStack.add(stepId);

      const step = steps.find(s => s.id === stepId);
      if (step) {
        for (const depId of step.dependsOn) {
          if (!visited.has(depId)) {
            if (dfs(depId)) return true;
          } else if (recursionStack.has(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (dfs(step.id)) return true;
      }
    }
    return false;
  }
}

export default WorkflowEngine;
```

### 3.3 API 路由设计

```typescript
// backend/routes/workflows.ts

import { Router, Request, Response } from 'express';
import type SessionManager from '../sessions';
import type WorkflowEngine from '../workflow-engine';

export default function workflowsRouter(
  sessionManager: SessionManager,
  workflowEngine: WorkflowEngine
): Router {
  const router = Router();

  // --- 工作流 CRUD ---

  // 创建工作流
  router.post('/sessions/:sessionId/workflows', (req: Request, res: Response) => {
    // POST /api/sessions/:sessionId/workflows
    // Body: { name, description, steps: [...] }
    // Response: { workflow }
  });

  // 获取工作流列表
  router.get('/sessions/:sessionId/workflows', (req: Request, res: Response) => {
    // GET /api/sessions/:sessionId/workflows
    // Response: { workflows: [...] }
  });

  // 获取单个工作流
  router.get('/sessions/:sessionId/workflows/:workflowId', (req: Request, res: Response) => {
    // GET /api/sessions/:sessionId/workflows/:workflowId
    // Response: { workflow }
  });

  // 更新工作流
  router.put('/sessions/:sessionId/workflows/:workflowId', (req: Request, res: Response) => {
    // PUT /api/sessions/:sessionId/workflows/:workflowId
    // Body: { name, steps, ... }
    // Response: { workflow }
  });

  // 删除工作流
  router.delete('/sessions/:sessionId/workflows/:workflowId', (req: Request, res: Response) => {
    // DELETE /api/sessions/:sessionId/workflows/:workflowId
    // Response: { success: true }
  });

  // --- 工作流执行控制 ---

  // 启动工作流
  router.post('/sessions/:sessionId/workflows/:workflowId/start', (req: Request, res: Response) => {
    // POST /api/sessions/:sessionId/workflows/:workflowId/start
    // Response: { success: true }
  });

  // 暂停工作流
  router.post('/sessions/:sessionId/workflows/:workflowId/pause', (req: Request, res: Response) => {
    // POST /api/sessions/:sessionId/workflows/:workflowId/pause
    // Response: { success: true }
  });

  // 重置工作流
  router.post('/sessions/:sessionId/workflows/:workflowId/reset', (req: Request, res: Response) => {
    // POST /api/sessions/:sessionId/workflows/:workflowId/reset
    // Response: { workflow }
  });

  // --- 工作流模板 ---

  // 保存为模板
  router.post('/workflow-templates', (req: Request, res: Response) => {
    // POST /api/workflow-templates
    // Body: { name, description, steps: [...] }
    // Response: { template }
  });

  // 获取模板列表
  router.get('/workflow-templates', (req: Request, res: Response) => {
    // GET /api/workflow-templates
    // Response: { templates: [...] }
  });

  // 从模板创建工作流
  router.post('/sessions/:sessionId/workflows/from-template/:templateId', (req: Request, res: Response) => {
    // POST /api/sessions/:sessionId/workflows/from-template/:templateId
    // Response: { workflow }
  });

  // 删除模板
  router.delete('/workflow-templates/:templateId', (req: Request, res: Response) => {
    // DELETE /api/workflow-templates/:templateId
    // Response: { success: true }
  });

  return router;
}
```

### 3.4 WebSocket 消息扩展

新增消息类型：

```typescript
// 工作流状态更新
interface WorkflowStatusMessage {
  type: 'workflow_status';
  workflow_id: string;
  status: 'running' | 'paused' | 'done' | 'error';
  currentStep: string | null;
}

// 步骤状态更新
interface WorkflowStepStatusMessage {
  type: 'workflow_step_status';
  workflow_id: string;
  step_id: string;
  status: 'running' | 'done' | 'error';
  result?: string;  // 仅完成时
  error?: string;   // 仅错误时
}

// 步骤消息（带前缀区分）
interface WorkflowStepMessage {
  type: 'text' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  workflow_id: string;
  step_id: string;
}
```

在 `backend/types/index.ts` 的 `AgentMessage.type` 中新增：
```typescript
export type AgentMessage = {
  type: 'text' | 'status' | 'error' | 'token_usage' | 'tool_use' | 'tool_result'
    | 'conversation_id' | 'title_update' | 'context_usage' | 'subtask_status'
    | 'assistant' | 'workflow_status' | 'workflow_step_status';
  // ... 其他字段
};
```

### 3.5 数据持久化

工作流存储在 SQLite 数据库中，与现有的 `subtasks` 字段类似，作为 session 的扩展字段。

**数据库迁移**：在 `sessions` 表添加 `workflows TEXT DEFAULT "[]"` 列

```sql
-- backend/db.ts 增量迁移
ALTER TABLE sessions ADD COLUMN workflows TEXT DEFAULT '[]';
```

**SessionData 类型扩展**（`backend/types/index.ts`）：
```typescript
export interface SessionData {
  // ... 现有字段
  workflows: Workflow[];  // 新增
}
```

**工作流模板存储**：

模板存储在独立的 `workflow_templates.json` 文件中：

```json
{
  "templates": [
    {
      "id": "tmpl_1714000000000",
      "name": "开发-审查-测试-提交",
      "description": "完整的代码开发工作流模板",
      "steps": [...],
      "createdAt": 1714000000000,
      "usageCount": 5
    }
  ]
}
```

**优势**：
- 与现有 `subtasks` 存储方式一致
- 事务性保证，避免数据丢失
- 支持按 sessionId 查询所有工作流
- 模板独立存储，可跨会话复用

---

## 四、前端实现方案

### 4.1 新增组件

| 文件 | 作用 |
|------|------|
| `frontend/src/components/WorkflowPanel.tsx` | 工作流面板（显示步骤列表+状态） |
| `frontend/src/components/WorkflowEditor.tsx` | 工作流编辑器（创建/编辑工作流） |
| `frontend/src/components/WorkflowStepCard.tsx` | 单个步骤卡片 |

### 4.2 WorkflowPanel 组件设计

```tsx
// frontend/src/components/WorkflowPanel.tsx

import React, { useState } from 'react';
import type { Workflow, WorkflowStep } from '../../types';

interface WorkflowPanelProps {
  workflow: Workflow;
  onPause: (workflowId: string) => void;
  onReset: (workflowId: string) => void;
  onClose: () => void;
}

// 功能：
// 1. 显示工作流步骤列表（按依赖关系排序）
// 2. 步骤间用箭头连接，显示执行顺序
// 3. 当前执行步骤高亮
// 4. 每个步骤可展开查看消息详情
// 5. 支持暂停/继续/重置操作

// UI 布局：
// ┌─────────────────────────────────────┐
// │ 工作流: 开发-审查-测试-提交    [暂停] [重置] [关闭] │
// ├─────────────────────────────────────┤
// │  ● Step 1: 执行开发任务    ✅ 完成  │
// │  │                                  │
// │  ├─→ Step 2: 代码审查     🔄 执行中 │
// │  │                                  │
// │  └─→ Step 3: 运行测试     ⏳ 等待   │
// │         │                           │
// │         └─→ Step 4: 汇总提交 ⏳ 等待 │
// ├─────────────────────────────────────┤
// │ [展开 Step 2 查看详情]               │
// └─────────────────────────────────────┘

export default function WorkflowPanel({ workflow, onPause, onReset, onClose }: WorkflowPanelProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="workflow-panel">
      {/* 步骤列表渲染 */}
    </div>
  );
}
```

### 4.3 WorkflowEditor 组件设计

```tsx
// frontend/src/components/WorkflowEditor.tsx

import React, { useState } from 'react';
import type { AgentType, WorkflowStep } from '../../types';

interface WorkflowEditorProps {
  onSave: (name: string, description: string, steps: WorkflowStep[]) => void;
  onCancel: () => void;
}

// 功能：
// 1. 可视化创建工作流
// 2. 添加/删除/拖拽排序步骤
// 3. 为每步选择 Agent 类型
// 4. 配置步骤间依赖关系
// 5. 保存为模板

// UI 布局：
// ┌─────────────────────────────────────┐
// │ 工作流编辑器                [保存模板] │
// ├─────────────────────────────────────┤
// │ 步骤 1:                             │
// │   名称: [________]                  │
// │   Agent: [Claude Code ▼]           │
// │   描述: [________________]          │
// │   依赖: [无]                        │
// │   [删除]                            │
// │                                     │
// │ + 添加步骤                           │
// ├─────────────────────────────────────┤
// │ [取消]  [保存]  [执行]               │
// └─────────────────────────────────────┘

export default function WorkflowEditor({ onSave, onCancel }: WorkflowEditorProps) {
  const [steps, setSteps] = useState<Partial<WorkflowStep>[]>([]);

  return (
    <div className="workflow-editor">
      {/* 步骤编辑表单 */}
    </div>
  );
}
```

### 4.4 ChatPanel 集成

在 ChatPanel 中新增"工作流"发送模式：

```tsx
// 输入区域底部工具栏扩展
<div className="send-modes">
  <label>
    <input type="radio" name="sendMode" value="normal" /> 普通
  </label>
  <label>
    <input type="radio" name="sendMode" value="split" /> 并行拆分
  </label>
  <label>
    <input type="radio" name="sendMode" value="workflow" /> 工作流  // 新增
  </label>
</div>
```

点击"工作流"后：
1. 打开 WorkflowEditor 预定义步骤
2. 或让 AI 分析任务自动生成工作流草稿
3. 用户确认后执行

### 4.5 App.tsx 状态扩展

```tsx
// 新增状态
interface WorkflowInfo {
  id: string | null;
  name: string;
  status: WorkflowStatus;
  totalSteps: number;
  runningSteps: number;
  completedSteps: number;
}

const [workflowInfo, setWorkflowInfo] = useState<WorkflowInfo>({
  id: null,
  name: '',
  status: 'idle',
  totalSteps: 0,
  runningSteps: 0,
  completedSteps: 0
});
const [showWorkflowFromHeader, setShowWorkflowFromHeader] = useState(false);

// 头部按钮（与并行任务图标并列）
{workflowInfo.totalSteps > 0 && (
  <button onClick={() => setShowWorkflowFromHeader(prev => !prev)}
          className="btn-icon" style={{ position: 'relative' }}>
    {/* 流程图图标 */}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/>
      <circle cx="12" cy="18" r="3"/>
      <line x1="7" y1="8" x2="10" y2="16"/>
      <line x1="17" y1="8" x2="14" y2="16"/>
    </svg>
    {workflowInfo.runningSteps > 0 && (
      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
            style={{ background: 'var(--warning)' }}></span>
    )}
  </button>
)}
```

### 4.6 Tab 栏扩展

```tsx
// Tab 栏从 2 个扩展为 3 个
{subtasks.length > 0 || workflowSteps.length > 0 && (
  <div className="flex border-b" style={{ borderColor: 'var(--border-subtle)' }}>
    <button onClick={() => setActiveTab('main')}
            className={`tab-btn ${activeTab === 'main' ? 'active' : ''}`}>
      主任务
    </button>
    {subtasks.length > 0 && (
      <button onClick={() => setActiveTab('subtasks')}
              className={`tab-btn ${activeTab === 'subtasks' ? 'active' : ''}`}>
        并行任务
      </button>
    )}
    {workflowSteps.length > 0 && (
      <button onClick={() => setActiveTab('workflow')}
              className={`tab-btn ${activeTab === 'workflow' ? 'active' : ''}`}>
        工作流
        {workflowInfo.runningSteps > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
                style={{ background: 'var(--warning)', color: 'white' }}>
            {workflowInfo.runningSteps}
          </span>
        )}
      </button>
    )}
  </div>
)}
```

---

## 五、与现有系统的兼容性

### 5.1 并行子任务系统保持不变

- 现有的"拆分"功能完全保留
- `subtasks` 数据结构不变
- `SubtaskPanel` 组件不变
- 并行执行逻辑不变

### 5.2 工作流作为独立模块

- 工作流引擎与子任务系统完全解耦
- 共享 Agent 创建工厂（`createAgent` from `backend/agents/factory.ts`）
- 共享 WebSocket 广播机制（`broadcast` from `backend/sessions.ts`）
- 共享消息格式（通过 `workflow_id` 和 `step_id` 字段区分）

### 5.3 用户选择入口

用户在发送消息时可以选择三种模式：

| 模式 | 说明 | 执行方式 |
|------|------|----------|
| 普通 | 单 Agent 执行 | 直接发送到当前会话 |
| 并行拆分 | AI 自动拆分为并行子任务 | `Promise.allSettled` |
| 工作流 | 手动/AI 辅助创建步骤 | 依赖链递归执行 |

---

## 六、实施步骤（分阶段）

### 阶段一：工作流引擎核心（后端）

1. 在 `backend/types/index.ts` 中添加 Workflow 相关类型定义
2. 创建 `backend/workflow-engine.ts` - 工作流执行引擎
3. 创建 `backend/routes/workflows.ts` - CRUD API
4. 在 `backend/server.ts` 中注册路由
5. 扩展 WebSocket 消息类型
6. 数据库迁移：添加 `workflows` 列

### 阶段二：工作流编辑器（前端）

1. 创建 `WorkflowEditor.tsx` - 可视化编辑器
2. 创建 `WorkflowPanel.tsx` - 执行状态面板
3. 创建 `WorkflowStepCard.tsx` - 步骤卡片组件
4. 在 ChatPanel.tsx 中添加"工作流"发送模式

### 阶段三：集成与优化

1. App.tsx 状态管理扩展
2. Tab 栏集成
3. 工作流模板 API 实现
4. 工作流模板 UI（保存/加载/删除）
5. AI 辅助生成工作流（可选）

---

## 七、风险与注意事项

### 7.1 复杂度

- 工作流引擎需要处理循环依赖检测、超时控制、错误恢复
- 前端 UI 需要清晰展示步骤依赖关系
- Agent 完成检测需要监听 `stopped` 事件，不同 Agent 类型行为可能不同

### 7.2 性能

- 长工作流（>10 步）需要考虑内存占用
- 大量消息广播需要优化 WebSocket 带宽
- 同时运行多个步骤时，每个步骤创建独立 Agent，需要控制并发数

### 7.3 错误恢复策略

| 错误类型 | 处理方式 |
|----------|----------|
| 单步执行失败 | 标记该步骤为 `error`，继续执行无依赖的后续步骤 |
| 超时 | 强制停止 Agent，标记为 `error` |
| 循环依赖 | 创建/更新时检测，拒绝执行 |
| 全局暂停 | 取消当前执行，标记未执行步骤为 `skipped` |

**建议**：初期实现"单步失败不阻塞"策略，后续可扩展为"失败重试"或"人工干预"模式。

### 7.4 向后兼容

- 现有并行子任务系统完全不受影响
- 数据库需要迁移（添加 `workflows` 列），但不影响现有数据

### 7.5 设计决策

**步骤 Agent 隔离策略**：每个步骤创建独立的 Agent 实例

| 方案 | 优点 | 缺点 |
|------|------|------|
| 独立 Agent（采用） | 状态隔离、支持跨 Agent 类型、与现有系统一致 | 内存占用稍高 |
| 复用 Agent | 内存占用低 | 状态污染风险、不支持跨 Agent 类型 |

**结论**：采用独立 Agent 策略，与现有并行子任务系统保持一致。

### 7.6 建议

- 优先实现阶段一和阶段二，确保核心功能可用
- AI 辅助生成工作流可以作为后续优化
- 初期可以限制最大步骤数（如 10 步）避免复杂度失控
- 每个步骤应有独立的超时控制，避免单步卡住影响整个工作流

---

## 八、文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/workflow-engine.ts` | 工作流执行引擎 |
| `backend/routes/workflows.ts` | 工作流 API 路由 |
| `frontend/src/components/WorkflowPanel.tsx` | 工作流面板 |
| `frontend/src/components/WorkflowEditor.tsx` | 工作流编辑器 |
| `frontend/src/components/WorkflowStepCard.tsx` | 步骤卡片 |
| `data/workflow-templates.json` | 工作流模板存储（运行时创建） |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `backend/types/index.ts` | 添加 Workflow 相关类型定义 |
| `backend/server.ts` | 注册工作流路由 |
| `backend/sessions.ts` | 添加 broadcast 支持 workflow_id + workflows 字段 |
| `backend/db.ts` | 数据库迁移：添加 `workflows` 列 |
| `frontend/src/App.tsx` | 添加 workflowInfo 状态 + 头部按钮 |
| `frontend/src/components/ChatPanel.tsx` | 添加 workflow tab + 发送模式 |

---

## 九、总结

本方案基于现有并行子任务系统的架构，通过新增独立的工作流引擎模块实现串行/并行混合执行。核心思路是：

1. **依赖驱动执行**：通过 `dependsOn` 数组定义步骤间依赖，引擎自动解析执行顺序
2. **结果上下文传递**：前序步骤的结果自动注入后续步骤的 prompt
3. **与现有系统解耦**：工作流完全独立于并行子任务，通过 `workflow_id` 区分
4. **渐进式实现**：分三个阶段实施，降低风险
5. **TypeScript 类型安全**：所有模块使用 TypeScript，提供完整的类型定义和接口约束

预计开发工作量：**中等**（约 2-3 天）

---
*文档版本: 2.0*
*创建时间: 2026-04-26*
*更新时间: 2026-04-27*
*更新内容: 适配 TypeScript 迁移，所有代码示例和文件引用更新为 .ts/.tsx 格式*
