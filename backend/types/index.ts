import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { Request, Response, NextFunction } from 'express';

// ==================== Agent Types ====================

export type AgentType = 'claude-code' | 'opencode' | 'codex' | 'mimo';

export interface AgentMessage {
  type: 'text' | 'status' | 'error' | 'token_usage' | 'tool_use' | 'tool_result' | 'conversation_id' | 'title_update' | 'context_usage' | 'subtask_status' | 'assistant';
  content: string | Record<string, unknown>;
  conversationId?: string;
  subtask_id?: string;
  replace?: boolean;
  message?: {
    content: Array<{ type: string; text: string }>;
  };
}

export interface AgentOptions {
  sessionId?: string;
  conversationId?: string;
  model?: string;
  userId?: string;
  userRole?: 'admin' | 'user';
  [key: string]: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface TokenRecord {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

// ==================== Session Types ====================

export interface SubtaskMessage {
  type: string;
  content: string;
  time: number;
}

export interface Subtask {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'error';
  model?: string;
  messages?: SubtaskMessage[];
  result?: string;
  error?: string;
  completedAt?: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string | AgentMessage;
  time: number;
}

export interface SessionOptions {
  model?: string;
  [key: string]: unknown;
}

export interface SessionData {
  id: string;
  workdir: string;
  agentType: AgentType;
  agentName: string;
  conversationId: string | null;
  title: string | null;
  options: SessionOptions;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  isWorking?: boolean;
  isStarting?: boolean;
  messages: SessionMessage[];
  lastSavedMessageCount: number;
  subtasks: Subtask[];
  agent?: AgentBase;
}

export interface SessionJSON {
  id: string;
  agentType: AgentType;
  agentName: string;
  workdir: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  options: SessionOptions;
  isActive: boolean;
  isWorking?: boolean;
  isStarting?: boolean;
  conversationId: string | null;
  lastMessageAt: Date | undefined;
  title: string | null;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  contextUsage?: { inputTokens: number; contextWindow: number; percentage: number } | null;
}

// ==================== Agent Base ====================

export interface AgentBase extends EventEmitter {
  name: string;
  workdir: string;
  process: ChildProcess | null;
  isRunning: boolean;
  activeProc?: ChildProcess | null;
  pendingHistory?: string;
  start(): Promise<void>;
  send(message: string): Promise<void>;
  stop(): Promise<void>;
  interrupt(): Promise<void>;
  updateOptions(newOptions: Record<string, unknown>): void;
  parseOutput(data: Buffer): AgentMessage;
}

// ==================== Project Types ====================

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectData {
  projects: Project[];
  recentProjects: string[];
}

// ==================== Permission Types ====================

export type PermissionAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  pattern: string;
  action: PermissionAction;
  description?: string;
}

export interface PermissionConfig {
  commands: PermissionRule[];
  files: PermissionRule[];
}

// ==================== Token Tracker Types ====================

export interface TokenStats {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  sessionStats: Record<string, TokenRecord>;
}

// ==================== Credential Types ====================

export type CredentialType = 'token' | 'ssh';

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  host: string;
  username?: string;
  secret?: string;
  keyData?: string;
  createdAt: Date;
}

// ==================== WebSocket Types ====================

export interface WSMessage {
  type: string;
  content?: string;
  sessionId?: string;
  subtask_id?: string;
  conversationId?: string;
  [key: string]: unknown;
}

export interface WSClient {
  sessionId: string;
  ws: WebSocket;
}

// ==================== Express Types ====================

export type ExpressHandler = (req: Request, res: Response, next?: NextFunction) => void | Promise<void>;

export type RouterFactory = (...args: unknown[]) => ExpressHandler;

// ==================== Database Types ====================

export interface DBRow {
  columns: string[];
  values: unknown[][];
}

export interface DBExecResult {
  columns: string[];
  values: unknown[][];
}

// ==================== Skill Types ====================

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Workflow Types ====================

export interface WorkflowStepDef {
  id: string;
  name: string;
  prompt: string;
  agentType?: AgentType;
  model?: string;
  dependsOn: string[];
  timeout: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepDef[];
  createdAt: number;
  updatedAt: number;
}

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled';

export interface WorkflowStepRun {
  id: string;
  name: string;
  prompt: string;
  agentType: AgentType;
  model?: string;
  dependsOn: string[];
  timeout: number;
  status: StepStatus;
  result: string | null;
  messages: StepMessage[];
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface StepMessage {
  type: string;
  content: string;
  time: number;
}

export interface WorkflowInstance {
  id: string;
  defId: string;
  name: string;
  description: string;
  steps: WorkflowStepRun[];
  status: WorkflowStatus;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

// ==================== Workflow Template Types ====================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepDef[];
  createdAt: number;
  usageCount: number;
}

// ==================== Loop Types ====================

export interface LoopStepDef {
  id: string;
  name: string;
  prompt: string;
  agentType?: AgentType;
  model?: string;
  timeout: number;
}

export interface LoopDefinition {
  id: string;                    // "loopdef_{timestamp}_{random6}"
  name: string;
  description: string;
  steps: LoopStepDef[];          // 每次迭代执行的步骤
  maxIterations: number;         // 最大迭代次数（0 = 无限）
  exitCondition?: string;        // 自然语言退出条件
  exitConditionType?: 'success' | 'failure' | 'custom';
  delayBetweenIterations: number; // 迭代间延迟（毫秒）
  createdAt: number;
  updatedAt: number;
}

export type LoopRunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled';
export type LoopIterationStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface LoopIteration {
  index: number;
  status: LoopIterationStatus;
  startedAt: number | null;
  completedAt: number | null;
  results: LoopStepResult[];
  error?: string;
}

export interface LoopStepResult {
  stepId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result: string | null;
  messages: StepMessage[];
  error: string | null;
}

export interface LoopRun {
  id: string;                    // "looprun_{timestamp}_{random6}"
  defId: string;
  name: string;
  description: string;
  status: LoopRunStatus;
  currentIteration: number;
  maxIterations: number;
  iterations: LoopIteration[];
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

// ==================== Goal Monitor Types ====================

export type GoalStatus = 'active' | 'completed' | 'cancelled' | 'error';

export interface Goal {
  id: string;
  sessionId: string;
  originalPrompt: string;
  status: GoalStatus;
  attemptCount: number;
  maxAttempts: number;
  progress: string;
  startedAt: number;
  lastAttemptAt: number;
  completedAt?: number;
  error?: string;
  agentType: AgentType;
  workdir: string;
}

export interface GoalJSON {
  id: string;
  sessionId: string;
  originalPrompt: string;
  status: GoalStatus;
  attemptCount: number;
  maxAttempts: number;
  progress: string;
  startedAt: number;
  lastAttemptAt: number;
  completedAt?: number;
  error?: string;
  agentType: AgentType;
  workdir: string;
}

// ==================== User Management Types ====================

export interface UserContext {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  homeDir: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}
