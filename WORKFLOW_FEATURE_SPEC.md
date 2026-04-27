# 工作流系统功能文档

> 版本: 1.0 | 创建: 2026-04-27

---

## 一、功能概述

在现有并行子任务系统基础上，增加**工作流编排**能力。工作流是一组有序的 Agent 任务，通过 DAG（有向无环图）定义步骤间的依赖关系，支持串行、并行和混合执行模式。

### 核心能力

| 能力 | 说明 |
|------|------|
| 串行执行 | 步骤按依赖顺序依次执行 |
| 并行执行 | 无依赖关系的步骤同时执行 |
| 混合模式 | 一个工作流内同时包含串行和并行 |
| 跨 Agent | 每步可指定不同 Agent 类型 |
| 结果传递 | 前序步骤输出自动注入后续步骤上下文 |
| 模板复用 | 保存/加载/删除工作流模板 |

### 典型场景

```
场景：开发 → 审查 → 测试 → 提交

工作流:
  Step 1 [Claude Code] 实现功能     ─┐
  Step 2 [OpenCode]    代码审查      ├──> Step 4 [Claude Code] 汇总提交
  Step 3 [Codex]       运行测试     ─┘
```

---

## 二、核心概念

### 2.1 工作流定义（Workflow Definition）

工作流的蓝图/模板，描述"做什么"，不包含运行时状态。

```
WorkflowDefinition
├── id: 唯一标识
├── name: 名称
├── description: 描述
├── steps[]: 步骤定义列表
│   ├── id: 步骤唯一标识
│   ├── name: 步骤名称
│   ├── prompt: 发送给 Agent 的指令
│   ├── agentType: 使用的 Agent 类型
│   ├── dependsOn[]: 依赖的步骤 ID 列表
│   └── timeout: 超时时间（毫秒）
└── createdAt: 创建时间
```

### 2.2 工作流实例（Workflow Instance）

工作流的一次执行，包含运行时状态。从定义创建，每次执行产生一个新实例。

```
WorkflowInstance
├── id: 实例唯一标识
├── defId: 关联的定义 ID
├── name: 名称（快照自定义）
├── status: idle | running | paused | done | error | cancelled
├── steps[]: 步骤运行状态列表
│   ├── id: 步骤 ID（与定义一致）
│   ├── name: 步骤名称（快照）
│   ├── status: pending | running | done | error | skipped | cancelled
│   ├── result: 执行结果文本
│   ├── messages[]: 执行过程消息
│   ├── error: 错误信息
│   ├── startedAt: 开始时间
│   └── completedAt: 完成时间
├── startedAt: 工作流开始时间
├── completedAt: 工作流完成时间
└── createdAt: 实例创建时间
```

### 2.3 执行规则

| 规则 | 说明 |
|------|------|
| 入口步骤 | `dependsOn` 为空的步骤，启动时立即执行 |
| 触发条件 | 所有依赖步骤状态为 `done` 后自动触发 |
| 失败处理 | 步骤失败不阻塞无依赖的后续步骤 |
| 结果传递 | 依赖步骤的结果自动注入 prompt 前缀 |
| 循环检测 | 创建时检测，有循环则拒绝 |
| 并发控制 | 最大同时执行 3 个步骤（可配置） |
| 超时处理 | 单步超时后强制停止，标记为 `error` |

---

## 三、数据模型

### 3.1 类型定义

```typescript
// --- 工作流定义 ---

interface WorkflowDefinition {
  id: string;                    // wfdef_时间戳_随机数
  name: string;
  description: string;
  steps: WorkflowStepDef[];
  createdAt: number;
  updatedAt: number;
}

interface WorkflowStepDef {
  id: string;                    // step_时间戳_索引
  name: string;
  prompt: string;                // 发送给 Agent 的指令
  agentType: AgentType;          // claude-code | opencode | codex
  dependsOn: string[];           // 依赖的步骤 ID
  timeout: number;               // 超时毫秒数，默认 600000
}

// --- 工作流实例 ---

type WorkflowStatus = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled';

interface WorkflowInstance {
  id: string;                    // wf_时间戳_随机数
  defId: string;                 // 关联的定义 ID
  name: string;                  // 快照自定义
  description: string;           // 快照自定义
  steps: WorkflowStepRun[];
  status: WorkflowStatus;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

interface WorkflowStepRun {
  id: string;                    // 与 WorkflowStepDef.id 一致
  name: string;                  // 快照
  prompt: string;                // 快照
  agentType: AgentType;          // 快照
  dependsOn: string[];           // 快照
  timeout: number;               // 快照
  status: StepStatus;
  result: string | null;
  messages: StepMessage[];
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

interface StepMessage {
  type: string;
  content: string;
  time: number;
}
```

### 3.2 数据存储

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| 工作流定义 | `sessions` 表 `workflow_defs` 列 (JSON) | 跟随 session 持久化 |
| 工作流实例 | `sessions` 表 `workflows` 列 (JSON) | 跟随 session 持久化 |
| 工作流模板 | `workflow_templates` 表 (SQLite) | 全局可复用 |

**数据库迁移：**

```sql
-- sessions 表新增列
ALTER TABLE sessions ADD COLUMN workflow_defs TEXT DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN workflows TEXT DEFAULT '[]';

-- 新增模板表
CREATE TABLE IF NOT EXISTS workflow_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  usage_count INTEGER DEFAULT 0
);
```

### 3.3 存储示例

```json
// sessions 表 workflow_defs 列
[
  {
    "id": "wfdef_1714000000000_abc",
    "name": "开发-审查-测试-提交",
    "description": "完整的代码开发工作流",
    "steps": [
      {
        "id": "step_0",
        "name": "执行开发任务",
        "prompt": "根据需求实现功能代码",
        "agentType": "claude-code",
        "dependsOn": [],
        "timeout": 600000
      },
      {
        "id": "step_1",
        "name": "代码审查",
        "prompt": "审查上一步的代码变更，给出改进建议",
        "agentType": "opencode",
        "dependsOn": ["step_0"],
        "timeout": 600000
      },
      {
        "id": "step_2",
        "name": "运行测试",
        "prompt": "运行项目测试套件",
        "agentType": "codex",
        "dependsOn": ["step_0"],
        "timeout": 600000
      },
      {
        "id": "step_3",
        "name": "汇总提交",
        "prompt": "汇总审查和测试结果，提交代码",
        "agentType": "claude-code",
        "dependsOn": ["step_1", "step_2"],
        "timeout": 600000
      }
    ],
    "createdAt": 1714000000000,
    "updatedAt": 1714000000000
  }
]
```

---

## 四、后端规格

### 4.1 新增文件

| 文件 | 职责 |
|------|------|
| `backend/workflow-engine.ts` | 工作流执行引擎 |
| `backend/routes/workflows.ts` | REST API 路由 |

### 4.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `backend/types/index.ts` | 新增 Workflow 相关类型 |
| `backend/sessions.ts` | 新增 workflow CRUD 方法 + broadcast 支持 |
| `backend/db.ts` | 数据库迁移 |
| `backend/server.ts` | 注册 workflow 路由 |

### 4.3 WorkflowEngine 设计

```typescript
class WorkflowEngine {
  // --- 状态 ---
  private running: Map<string, RunningWorkflow>;  // workflowId -> 运行状态

  // --- 公开方法 ---
  start(sessionId, instance): Promise<void>     // 启动执行
  pause(sessionId, workflowId): void            // 暂停（取消当前步骤，标记后续为 skipped）
  resume(sessionId, workflowId): void           // 暂不实现（v2）
  cancel(sessionId, workflowId): void           // 取消（同 pause 但标记为 cancelled）
  retryStep(sessionId, workflowId, stepId): void // 重试失败步骤

  // --- 内部方法 ---
  private resolveReadySteps(workflow): WorkflowStepRun[]  // 解析可执行步骤
  private executeStep(sessionId, workflow, step): Promise<void>  // 执行单步
  private buildContext(workflow, step): string  // 构建上下文 prompt
  private detectCycles(steps): boolean          // 循环依赖检测
  private checkCompletion(workflow): void       // 检查是否完成
}
```

**执行流程：**

```
start()
  ├── 检测循环依赖
  ├── 设置 workflow.status = 'running'
  ├── 解析入口步骤（dependsOn 为空）
  └── executeSteps(entrySteps)
        ├── 限制并发数（maxConcurrent=3）
        ├── 并行执行所有就绪步骤
        │   ├── createAgent(agentType)
        │   ├── buildContext() → 注入前序结果
        │   ├── agent.send(fullPrompt)
        │   └── 等待 agent 完成/超时
        ├── 更新步骤状态
        ├── 广播状态变更
        └── 递归执行下一波就绪步骤
```

**并发控制：**

```typescript
private async executeSteps(steps: WorkflowStepRun[]): Promise<void> {
  // 分批执行，每批最多 maxConcurrent 个
  const BATCH_SIZE = 3;
  for (let i = 0; i < steps.length; i += BATCH_SIZE) {
    const batch = steps.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(s => this.executeStep(s)));
  }
}
```

**上下文构建规则：**

```
输入: step.dependsOn = ["step_0", "step_1"]

构建:
  以下是前序步骤的执行结果，请参考：

  ## step_0: 执行开发任务 的结果
  <step_0.result>

  ---

  ## step_1: 代码审查 的结果
  <step_1.result>

  ---

  请根据上述信息完成以下任务：
  <step.prompt>
```

### 4.4 API 路由

#### 工作流定义 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sessions/:sid/workflow-defs` | 创建定义 |
| `GET` | `/api/sessions/:sid/workflow-defs` | 获取所有定义 |
| `GET` | `/api/sessions/:sid/workflow-defs/:did` | 获取单个定义 |
| `PUT` | `/api/sessions/:sid/workflow-defs/:did` | 更新定义 |
| `DELETE` | `/api/sessions/:sid/workflow-defs/:did` | 删除定义 |

#### 工作流实例控制

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sessions/:sid/workflows` | 从定义创建实例并启动 |
| `GET` | `/api/sessions/:sid/workflows` | 获取所有实例 |
| `GET` | `/api/sessions/:sid/workflows/:wid` | 获取单个实例 |
| `POST` | `/api/sessions/:sid/workflows/:wid/pause` | 暂停 |
| `POST` | `/api/sessions/:sid/workflows/:wid/cancel` | 取消 |
| `POST` | `/api/sessions/:sid/workflows/:wid/retry` | 重试失败步骤 |
| `DELETE` | `/api/sessions/:sid/workflows/:wid` | 删除实例 |

#### 工作流模板

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/workflow-templates` | 保存为模板 |
| `GET` | `/api/workflow-templates` | 获取所有模板 |
| `POST` | `/api/workflow-templates/:tid/use` | 从模板创建定义 |
| `DELETE` | `/api/workflow-templates/:tid` | 删除模板 |

### 4.5 WebSocket 消息扩展

```typescript
// 工作流实例状态变更
interface WorkflowStatusMsg {
  type: 'workflow_status';
  workflow_id: string;
  status: WorkflowStatus;
  current_steps: string[];  // 当前正在执行的步骤 ID
}

// 步骤状态变更
interface WorkflowStepStatusMsg {
  type: 'workflow_step_status';
  workflow_id: string;
  step_id: string;
  status: StepStatus;
  result?: string;
  error?: string;
}

// 步骤实时消息（Agent 输出）
interface WorkflowStepMessageMsg {
  type: 'workflow_step_message';
  workflow_id: string;
  step_id: string;
  content: string;
  content_type: 'text' | 'tool_use' | 'tool_result';
}
```

### 4.6 SessionManager 扩展

```typescript
// 新增方法
class SessionManager {
  // 工作流定义 CRUD
  getWorkflowDefs(sessionId): WorkflowDefinition[]
  saveWorkflowDef(sessionId, def): WorkflowDefinition
  updateWorkflowDef(sessionId, defId, updates): WorkflowDefinition
  deleteWorkflowDef(sessionId, defId): boolean

  // 工作流实例 CRUD
  getWorkflows(sessionId): WorkflowInstance[]
  getWorkflow(sessionId, workflowId): WorkflowInstance | null
  saveWorkflow(sessionId, instance): WorkflowInstance
  deleteWorkflow(sessionId, workflowId): boolean

  // broadcast 扩展
  broadcast(sessionId, message): void  // 已支持，新增 workflow_status / workflow_step_status 类型
}
```

---

## 五、前端规格

### 5.1 新增组件

| 文件 | 职责 |
|------|------|
| `frontend/src/components/WorkflowPanel.tsx` | 工作流执行面板（步骤列表 + 状态） |
| `frontend/src/components/WorkflowEditor.tsx` | 工作流定义编辑器（创建/编辑） |
| `frontend/src/components/WorkflowStepCard.tsx` | 单个步骤卡片（状态 + 展开详情） |

### 5.2 WorkflowPanel

工作流执行状态的展示面板，类似现有的 SubtaskPanel。

```
┌──────────────────────────────────────────┐
│ 工作流: 开发-审查-测试-提交               │
│ 状态: 执行中 (2/4 完成)        [暂停] [取消] │
├──────────────────────────────────────────┤
│ ● Step 1: 执行开发任务      ✅ 完成  12s  │
│ │                                        │
│ ├─→ Step 2: 代码审查        🔄 执行中     │
│ │   [展开查看详情]                         │
│ │                                        │
│ └─→ Step 3: 运行测试        ⏳ 等待       │
│         │                                │
│         └─→ Step 4: 汇总提交  ⏳ 等待     │
└──────────────────────────────────────────┘
```

**交互：**
- 点击步骤名称展开/收起详情（显示 Agent 实时输出）
- 暂停按钮：停止当前执行，标记后续为 skipped
- 取消按钮：同暂停，但标记为 cancelled
- 失败步骤显示重试按钮

### 5.3 WorkflowEditor

工作流定义的创建/编辑界面。

```
┌──────────────────────────────────────────┐
│ 工作流编辑器                              │
│                                          │
│ 名称: [开发-审查-测试-提交________]        │
│ 描述: [完整的代码开发工作流____________]    │
│                                          │
│ ┌─ 步骤 1 ──────────────────────────┐    │
│ │ 名称: [执行开发任务________]        │    │
│ │ Agent: [Claude Code ▼]            │    │
│ │ 指令: [根据需求实现功能代码____]    │    │
│ │ 依赖: [无]                         │    │
│ │ 超时: [600] 秒                     │    │
│ │                          [删除]    │    │
│ └────────────────────────────────────┘    │
│                                          │
│ ┌─ 步骤 2 ──────────────────────────┐    │
│ │ ...                                │    │
│ └────────────────────────────────────┘    │
│                                          │
│ [+ 添加步骤]                              │
│                                          │
│ [取消]  [保存为模板]  [保存]  [保存并执行]  │
└──────────────────────────────────────────┘
```

**交互：**
- 依赖选择：复选框列表，显示所有其他步骤，自动排除循环
- Agent 类型：下拉选择 claude-code / opencode / codex
- 步骤可拖拽排序（视觉顺序，不影响执行逻辑）
- "保存为模板"弹出名称/描述输入框
- "保存并执行"保存定义后立即创建实例并启动

### 5.4 ChatPanel 集成

**发送模式扩展：**

```
底部工具栏:
  [普通] [并行拆分] [工作流 ▼]
                        ├── 新建工作流...
                        └── 模板列表...
```

- 选择"新建工作流..."：打开 WorkflowEditor 空白页
- 选择模板：打开 WorkflowEditor 并填充模板数据
- 工作流执行中时，Tab 栏显示"工作流"Tab

**Tab 栏扩展：**

```
[主任务] [子任务(2)] [工作流(1)]
```

- 工作流 Tab 显示正在执行的工作流数量
- 点击切换到 WorkflowPanel 视图

### 5.5 App.tsx 状态扩展

```typescript
// 新增状态
const [workflowDefs, setWorkflowDefs] = useState<WorkflowDefinition[]>([]);
const [workflows, setWorkflows] = useState<WorkflowInstance[]>([]);
const [activeWorkflow, setActiveWorkflow] = useState<WorkflowInstance | null>(null);
const [showWorkflowEditor, setShowWorkflowEditor] = useState(false);
const [editingWorkflowDef, setEditingWorkflowDef] = useState<WorkflowDefinition | null>(null);
```

### 5.6 WebSocket 消息处理

```typescript
// ChatPanel 中新增消息类型处理
case 'workflow_status':
  // 更新 workflow 列表中对应实例的状态
  break;

case 'workflow_step_status':
  // 更新对应工作流实例中步骤的状态
  break;

case 'workflow_step_message':
  // 追加到对应步骤的消息列表（实时显示 Agent 输出）
  break;
```

---

## 六、用户流程

### 6.1 创建并执行工作流

```
1. 用户在 ChatPanel 底部选择 [工作流] → [新建工作流...]
2. 打开 WorkflowEditor
3. 用户填写名称、描述
4. 用户添加步骤：填写名称、选择 Agent、编写指令、设置依赖
5. 点击 [保存并执行]
6. 后端：保存定义 → 创建实例 → 启动引擎
7. 前端：切换到工作流 Tab，显示 WorkflowPanel
8. 引擎按 DAG 顺序执行，WebSocket 实时推送状态
9. 全部完成 → 状态显示 ✅
```

### 6.2 使用模板

```
1. 用户在 ChatPanel 底部选择 [工作流] → [模板列表]
2. 显示可用模板，用户选择一个
3. 打开 WorkflowEditor，预填充模板步骤
4. 用户可修改后 [保存并执行]
```

### 6.3 处理失败

```
1. 某步骤执行失败，状态显示 ❌
2. 无依赖的后续步骤继续执行
3. 有依赖的后续步骤标记为 skipped
4. 用户可点击 [重试] 重新执行失败步骤
5. 重试成功后，自动触发下游步骤
```

---

## 七、与现有系统的关系

| 维度 | 并行子任务 | 工作流 |
|------|-----------|--------|
| 触发方式 | AI 拆分 + 用户确认 | 用户手动/AI 辅助创建 |
| 执行模型 | `Promise.allSettled` 并行 | DAG 依赖驱动 |
| 步骤依赖 | 无依赖，全部并行 | 支持串行/并行/混合 |
| 结果传递 | 无 | 自动注入上下文 |
| Agent 选择 | 统一 Agent 类型 | 每步可选不同 Agent |
| 数据存储 | `subtasks` 列 | `workflow_defs` + `workflows` 列 |
| UI 面板 | SubtaskPanel | WorkflowPanel |

**共享：**
- Agent 创建工厂（`createAgent`）
- WebSocket 广播机制（`broadcast`）
- Agent 基类接口（`AgentBase`）

---

## 八、实施计划

### 阶段一：后端核心（预计 1-1.5 天）

1. `types/index.ts` — 新增 Workflow 相关类型定义
2. `db.ts` — 数据库迁移（新增列 + 模板表）
3. `workflow-engine.ts` — 工作流执行引擎
4. `routes/workflows.ts` — REST API 路由
5. `sessions.ts` — 新增 workflow CRUD 方法
6. `server.ts` — 注册路由

### 阶段二：前端界面（预计 1-1.5 天）

1. `WorkflowStepCard.tsx` — 步骤卡片组件
2. `WorkflowPanel.tsx` — 执行面板
3. `WorkflowEditor.tsx` — 编辑器
4. `ChatPanel.tsx` — 集成发送模式 + Tab 栏
5. `App.tsx` — 状态管理 + 头部按钮

### 阶段三：模板与优化（预计 0.5 天）

1. 模板 API 实现
2. 模板 UI（保存/加载/删除）
3. WebSocket 消息处理完善

---

## 九、风险与约束

| 风险 | 应对 |
|------|------|
| 长工作流内存占用 | 限制最大 10 步 |
| 并发 Agent 过多 | 最大同时执行 3 个 |
| Agent 完成检测不可靠 | 监听 `stopped` 事件 + 超时兜底 |
| 大量消息广播 | 步骤消息仅保留最后 100 条 |
| 数据库迁移失败 | 迁移前备份，使用 ALTER TABLE IF NOT EXISTS |

**v1 不包含：**
- 条件分支（if/else 执行）
- 循环执行
- 工作流输入参数化
- 可视化节点编辑器
- AI 自动生成工作流
- 工作流跨 session 执行
