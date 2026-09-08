# 循环控制问题分析报告

## 系统概述

系统中存在两个主要的循环/工作流执行引擎：
1. **LoopEngine** (`loop-engine.ts`) - 处理重复迭代的循环任务
2. **WorkflowEngine** (`workflow-engine.ts`) - 处理有依赖关系的步骤工作流

---

## 发现的问题

### 问题 1: WorkflowEngine 中的潜在无限循环

**位置**: `workflow-engine.ts:186-199`

```typescript
while (true) {
  if (rw.cancelled) return;
  const readySteps = this.resolveReadySteps(instance);
  if (readySteps.length === 0) return;
  // ... 执行步骤
}
```

**问题描述**:
- `while (true)` 循环依赖 `resolveReadySteps()` 返回空数组来退出
- 如果 `resolveReadySteps()` 逻辑出现 bug（例如某些步骤状态永远无法转换为 `done`），循环将永远运行
- 缺少最大迭代次数保护

**风险等级**: 高

**建议修复**:
```typescript
let iterations = 0;
const MAX_ITERATIONS = 1000; // 安全上限

while (iterations++ < MAX_ITERATIONS) {
  if (rw.cancelled) return;
  const readySteps = this.resolveReadySteps(instance);
  if (readySteps.length === 0) return;
  // ...
}

if (iterations >= MAX_ITERATIONS) {
  console.error('[WorkflowEngine] 达到最大迭代次数，可能存在死循环');
  instance.status = 'error';
  instance.completedAt = Date.now();
}
```

---

### 问题 2: LoopEngine 的 retryIteration 递归调用

**位置**: `loop-engine.ts:121-138`

```typescript
async retryIteration(sessionId: string, run: LoopRun, definition: LoopDefinition): Promise<void> {
  const rl = this.running.get(run.id);
  if (rl) return; // 已在运行中
  
  // ... 重置迭代
  
  await this.start(sessionId, run, definition); // 递归调用
}
```

**问题描述**:
- `retryIteration()` 调用 `start()`，而 `start()` 可能触发新的迭代
- 如果用户频繁点击重试，可能导致多个并发的循环执行
- 虽然有 `if (rl) return` 的检查，但在异步环境中存在竞态条件

**风险等级**: 中

**建议修复**:
- 添加互斥锁或使用状态机模式
- 在 `start()` 方法中检查是否已有运行中的相同 run

---

### 问题 3: LoopEngine 的 pause/cancel 状态管理混乱

**位置**: `loop-engine.ts:78-116`

```typescript
pause(sessionId: string, run: LoopRun): void {
  const rl = this.running.get(run.id);
  if (rl) {
    rl.paused = true;
    rl.cancelled = true;  // 同时设置两个标志
    // ...
  }
  run.status = 'paused';
}

cancel(sessionId: string, run: LoopRun): void {
  const rl = this.running.get(run.id);
  if (rl) {
    rl.cancelled = true;
    // 没有设置 rl.paused
  }
  run.status = 'cancelled';
}
```

**问题描述**:
- `pause()` 同时设置 `paused=true` 和 `cancelled=true`，语义不清晰
- 在 `executeIterations()` 中检查的是 `rl.cancelled || rl.paused`，但 `pause()` 已经设置了 `cancelled`
- 这导致 `paused` 标志实际上从未被独立使用

**风险等级**: 低

**建议修复**:
- 明确区分 pause 和 cancel 的语义
- pause 应该只设置 `paused=true`，不设置 `cancelled=true`
- 或者移除 `paused` 标志，统一使用 `cancelled` 表示停止

---

### 问题 4: 缺少循环定义的循环依赖检测

**位置**: `loop-engine.ts` 和 `loop-scheduler.ts`

**问题描述**:
- `WorkflowEngine` 有 `detectCycles()` 方法检测步骤间的循环依赖
- 但 `LoopEngine` 没有类似的检测机制
- 如果循环定义的退出条件依赖于自身的结果，可能导致逻辑上的无限循环

**风险等级**: 中

**建议修复**:
- 在 LoopEngine 中添加退出条件的合理性检查
- 验证退出条件不会导致逻辑死循环

---

### 问题 5: 定时器清理不完整

**位置**: `loop-engine.ts:561-569`

```typescript
private delay(ms: number, rl: RunningLoop): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      rl.timers.delete('_delay');
      resolve();
    }, ms);
    rl.timers.set('_delay', timer);
  });
}
```

**问题描述**:
- `delay()` 使用固定的 key `_delay` 存储定时器
- 如果在延迟期间调用 `cleanup()`，定时器会被清理，但 Promise 不会被 resolve
- 这可能导致 `start()` 方法永远挂起

**风险等级**: 中

**建议修复**:
```typescript
private delay(ms: number, rl: RunningLoop): Promise<void> {
  return new Promise(resolve => {
    const timerKey = `_delay_${Date.now()}`;
    const timer = setTimeout(() => {
      rl.timers.delete(timerKey);
      resolve();
    }, ms);
    rl.timers.set(timerKey, timer);
  });
}
```

---

### 问题 6: LoopStore 的数据一致性问题

**位置**: `loop-store.ts:122-152`

```typescript
saveLoop(sessionId: string, run: LoopRun): LoopRun {
  const db = getDb();
  const loops = this.getLoops(sessionId);
  // ... 更新 loops
  
  db.run('UPDATE sessions SET loops = ? WHERE id = ?', [
    JSON.stringify(trimmedLoops),
    sessionId
  ]);
  
  // 验证保存是否成功
  const verifyResult = db.exec('SELECT loops FROM sessions WHERE id = ?', [sessionId]);
  // ...
}
```

**问题描述**:
- 每次保存都会读取整个 sessions 表并更新 JSON 字段
- 在高并发场景下可能导致数据覆盖
- 验证查询增加了不必要的数据库负载

**风险等级**: 低

**建议修复**:
- 使用数据库事务确保原子性
- 移除验证查询（除非有特殊需求）
- 考虑使用更高效的存储方案

---

### 问题 7: exitCondition 的 LLM 判断不可靠

**位置**: `loop-engine.ts:464-523`

```typescript
private async evaluateExitConditionWithLlm(exitCondition: string, resultText: string, agentType: AgentType, workdir: string): Promise<boolean> {
  // 使用 LLM 判断是否退出
  const trimmed = response.trim();
  const lower = trimmed.toLowerCase();
  resolve(lower.includes('是') || lower.includes('yes'));
}
```

**问题描述**:
- 依赖 LLM 的自然语言判断来决定是否退出循环
- LLM 的回答可能不稳定，导致循环行为不可预测
- 30 秒超时后使用部分响应判断，可能不准确

**风险等级**: 高

**建议修复**:
- 提供更结构化的退出条件格式（如 JSON schema）
- 添加重试机制
- 考虑使用确定性规则替代 LLM 判断

---

## 总结

| 问题 | 风险等级 | 影响范围 | 修复优先级 |
|------|----------|----------|------------|
| WorkflowEngine 无限循环 | 高 | 整个系统 | P0 |
| exitCondition LLM 判断不可靠 | 高 | 循环功能 | P0 |
| retryIteration 递归调用 | 中 | 循环功能 | P1 |
| 定时器清理不完整 | 中 | 循环功能 | P1 |
| 缺少循环依赖检测 | 中 | 循环功能 | P2 |
| pause/cancel 状态混乱 | 低 | 循环功能 | P2 |
| LoopStore 数据一致性 | 低 | 数据持久化 | P3 |

---

## 建议的修复顺序

1. **立即修复**: WorkflowEngine 的无限循环保护
2. **短期修复**: 改进 exitCondition 的判断机制
3. **中期修复**: 重构 LoopEngine 的状态管理
4. **长期优化**: 改进数据存储和并发控制
