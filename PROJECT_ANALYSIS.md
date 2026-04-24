# Agent Hub 项目深度分析

> 生成时间：2026-04-24  
> 基于代码库 commit: `99669d9`（最新）

---

## 1. 项目定位

**Agent Hub** 是一个通用的 CLI Agent Web UI，核心定位是让用户通过一个浏览器界面同时管理多个 AI 编程助手（Claude Code、OpenCode、Codex 等），每个助手在独立的工作目录和会话中运行。支持手机浏览器远程访问。

---

## 2. 技术栈

| 层级 | 技术 |
|---|---|
| **后端** | Node.js 18+, Express 4, WebSocket (`ws`), `sql.js` (SQLite 内存版) |
| **前端** | React 18, Vite 5, Tailwind CSS 3 |
| **数据存储** | SQLite (内存运行，定期导出到 `data/agent-hub.db`) |
| **AI 集成** | Anthropic SDK, 各 CLI 工具子进程调用 |

---

## 3. 后端架构分析

### 3.1 入口与生命周期 (`server.js`)
- 启动顺序：`initDb()` → `TokenTracker` → `SessionManager.init()` → 注册路由 → 启动 WS 服务
- 全局异常捕获：`uncaughtException` / `unhandledRejection` 兜底
- 优雅关闭：`SIGINT` 时调用 `sessionManager.saveData()` 持久化所有会话
- 注意：路由注册**必须在 `initApp()` 之后**，因为多个路由依赖 `sessionManager` 实例

### 3.2 核心模块

| 模块 | 文件 | 职责 | 关键设计 |
|---|---|---|---|
| SessionManager | `backend/sessions.js` | 会话生命周期管理 | 内存 `Map` + SQLite 双写；每次消息/状态变更自动保存 |
| Database | `backend/db.js` | SQLite 初始化与迁移 | `sql.js` 纯内存数据库，通过 `saveToFile()` 导出二进制；包含从旧版 JSON 文件的迁移逻辑 |
| Agent Factory | `backend/agents/factory.js` | Agent 工厂 | 简单映射表，支持 4 种 Agent 类型 |
| Agent Base | `backend/agents/base.js` | Agent 抽象基类 | 继承 `EventEmitter`，子类必须实现 `start()` / `send()` |
| PermissionManager | `backend/permissions.js` | 权限策略 | 基于正则的危险命令拦截（`rm -rf /`, `sudo`, `curl \| sh` 等） |
| TokenTracker | `backend/token-tracker.js` | Token 用量统计 | 独立 SQLite 文件 `token-stats.db`，含历史记录和每日备份 |
| CredentialManager | `backend/credentialManager.js` | Git 凭证管理 | 按 host 存储凭证，自动应用到工作目录 |

### 3.3 Agent 适配器模式

所有 Agent 统一接口：
```js
// 事件：message, error, stopped, token_usage, conversation_id, title_update
class MyAgent extends EventEmitter {
  start()   // 启动进程/SDK连接
  send(msg) // 发送用户输入
  stop()    // 终止进程
}
```

| Agent | 运行模式 | 上下文保持 | 流式输出 | 工具调用 |
|---|---|---|---|---|
| **`claude-code`** | 每次 `send()` 启动新 CLI 进程 | `--resume conversationId` | `--output-format stream-json` 逐行解析 | 由 CLI 内部处理 |
| **`claude-api`** | SDK 直接调用，长期连接 | 内存中维护 `messages[]` | SDK `stream` 事件 | 后端自行实现 (bash, str_replace_editor) |
| **`opencode`** | CLI 子进程 | 进程存活期间 | stdout 实时解析 | 内部处理 |
| **`codex`** | CLI 子进程 | 进程存活期间 | stdout 实时解析 | 内部处理 |

**Claude API 的特殊性**：它是唯一不依赖外部 CLI 的 Agent，自己实现了完整的 agentic loop，但代码复杂度也最高。当前在 `/api/agents` 接口中已被隐藏，项目重心已转向 CLI 模式。

### 3.4 数据持久化机制

- **运行时**：所有数据在 `sql.js` 内存数据库中
- **保存触发时机**：创建/删除会话、消息到达（每 10 条批量保存一次）、状态变更、进程关闭
- **文件位置**：`data/agent-hub.db`（主数据）、`data/token-stats.db`（Token 统计）
- **备份**：Token 统计每日零点自动备份到 `data/backups/`，保留 30 天

### 3.5 WebSocket 协议

```
连接: ws://localhost:3001?session=SESSION_ID&token=TOKEN

前端 → 后端:
  {type: 'user_input', content: '...'}
  {type: 'command', command: 'set_mode', params: {mode: 'xxx'}}

后端 → 前端:
  {type: 'text', content: '...'}
  {type: 'status', content: 'task_started|task_done|agent_starting|agent_started|agent_stopped'}
  {type: 'token_usage', content: {...}}
  {type: 'error', content: '...'}
  {type: 'title_update', content: '...'}
```

### 3.6 安全机制

1. **可选 Token 认证**：`.token` 文件存在时启用，通过 `x-access-token` header 或 query param 验证
2. **路径隔离**：`ALLOWED_ROOT` 限制文件操作范围
3. **命令黑名单**：`PermissionManager` 用正则匹配危险命令（`sudo`, `rm -rf /`, `curl | sh` 等）
4. **Git 凭证隔离**：每个工作目录独立配置 `.git/credentials`，权限 `600`

---

## 4. 前端架构分析

### 4.1 状态管理

- **无全局状态库**，全部使用 React `useState` + `useEffect`
- `App.jsx` 作为唯一状态容器，管理：
  - `sessions[]` — 会话列表
  - `activeSession` — 当前活跃会话 ID
  - `sessionOptions` — 每个会话的 mode/model/effort 配置
  - `viewingFile` / `showSearch` / `showSettings` 等 UI 状态

### 4.2 关键组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `App` | `frontend/src/App.jsx` | 全局状态容器，管理会话列表、活跃会话、模态框 |
| `ChatPanel` | `frontend/src/components/ChatPanel.jsx` | WebSocket 客户端核心，管理消息列表、输入框、附件上传、分页加载历史 |
| `Sidebar` | `frontend/src/components/Sidebar.jsx` | 左侧会话列表，支持新建/恢复/删除/置顶/归档 |
| `RightSidebar` | `frontend/src/components/RightSidebar.jsx` | 右侧文件浏览器，支持查看工作目录文件树 |
| `Message` | `frontend/src/components/Message.jsx` | 消息渲染，支持 Markdown、代码高亮、引用回复 |
| `ProjectManager` | `frontend/src/components/ProjectManager.jsx` | 项目管理（创建、导入 Git、收藏） |
| `NewSessionModal` | `frontend/src/components/NewSessionModal.jsx` | 新建会话弹窗，选择 Agent 类型和工作目录 |
| `ContextManager` | `frontend/src/components/ContextManager.jsx` | Token 用量统计面板 |
| `FileViewer` | `frontend/src/components/FileViewer.jsx` | 文件内容查看与编辑 |

### 4.3 网络层

- Vite devServer 代理 `/api` 和 `/ws` 到后端 `localhost:3001`
- 全局 `fetch` 拦截：自动注入 `x-access-token`
- WebSocket 每个 `ChatPanel` 实例独立维护，切换会话时组件重新挂载（`key={activeSession}`）

### 4.4 响应式设计

- 移动端断点：`768px`
- 手机端：侧边栏变为绝对定位覆盖层，带遮罩和手势关闭
- 桌面端：左右双栏固定显示

---

## 5. 数据流时序（发送一条消息的完整路径）

```
[User] 输入消息
  ↓
[ChatPanel] ws.send({type: 'user_input', content})
  ↓
[WS Handler] 解析 sessionId → sessionManager.sendMessage()
  ↓
[SessionManager] 
  ├── 如果 agent 未运行 → _resumeAgent() 重新创建进程
  ├── session.messages.push({role: 'user'}) → 保存到 SQLite
  ├── session.isWorking = true
  └── agent.send(message)
      ↓
[Agent 适配器] 调用具体 CLI/SDK
  ↓
[AI 服务] 流式返回内容
  ↓
[Agent] 逐块解析 → emit('message', {type: 'text', content})
  ↓
[SessionManager.broadcast()] 
  ├── 非元消息 → session.messages.push({role: 'assistant'}) → SQLite
  ├── token_usage → TokenTracker.recordUsage()
  ├── 检查是否生成标题（第1条assistant消息）
  └── wsClients.broadcast() → 推送到所有前端 WS 连接
      ↓
[ChatPanel] 收到 WS message → setMessages() → React 渲染
```

**关键观察**：所有 agent 输出都经过 `SessionManager.broadcast()` 统一处理，这是前后端数据同步的**唯一通道**。

---

## 6. 扩展性

添加新 Agent 的步骤：
1. 在 `backend/agents/` 下新建文件，继承 `Agent` 基类
2. 实现 `start()` / `send()` / `stop()`
3. 在 `factory.js` 的 `AGENT_CLASSES` 中注册
4. 在 `server.js` `/api/agents` 接口中添加返回项
5. （可选）在 `backend/routes/options.js` 中添加 mode/model/effort 选项

整个扩展流程不超过 5 个文件修改。

---

## 7. 项目成熟度评估

| 维度 | 评分 | 说明 |
|---|---|---|
| **功能完整性** | ★★★★☆ | 多Agent、会话管理、项目管理、权限控制、Token追踪、移动端适配，功能覆盖全面 |
| **代码质量** | ★★★☆☆ | 结构清晰但缺少测试、lint、类型检查；部分错误处理不够完善 |
| **可维护性** | ★★★★☆ | 模块化良好，Agent 扩展简单，数据库迁移有 backward compatible 设计 |
| **性能** | ★★★☆☆ | SQLite 内存数据库全量写入有瓶颈；前端无虚拟滚动，消息多时可能卡顿 |
| **安全性** | ★★★★☆ | Token 认证、路径隔离、命令过滤都有，但凭证明文存储在 `.git/credentials` |
| **文档** | ★★★★☆ | README + CLAUDE.md 覆盖了架构和扩展指南 |

**总体定位**：一个**功能成熟、设计合理**的 MVP 级产品，已具备生产使用的基本条件，但在工程化（测试、监控、性能优化）方面还有提升空间。

---

## 8. 潜在问题 / 技术债

| 问题 | 影响 | 位置 |
|---|---|---|
| `sql.js` 纯内存数据库，进程崩溃会丢失**自上次 `saveToFile()` 之后**的数据 | 中 | `db.js` |
| `saveSession()` 每次消息都写全量 `DELETE + INSERT`，消息量大时性能下降 | 中 | `sessions.js:235-274` |
| 前端状态全在 `App.jsx`，继续增长会成瓶颈 | 低 | `App.jsx` |
| `ClaudeCodeAgent` 每次 `send()` 都启动新子进程，高并发场景资源消耗大 | 低 | `claude-code.js` |
| `sessionManager.broadcast()` 中同步执行 `saveSession()` 可能阻塞事件循环 | 中 | `sessions.js:459-509` |
| 无测试框架 | 中 | 整个项目 |
| 无 Lint/Format | 低 | 整个项目 |

---

## 9. 建议的改进方向（按优先级）

### 高优先级
1. **引入测试框架**（Jest + React Testing Library），至少覆盖核心流程（创建会话、发送消息、WebSocket 通信）
2. **消息保存优化**：从 `DELETE + INSERT` 全量替换改为增量 `INSERT`，或引入 write-ahead log 机制
3. **前端虚拟滚动**：`ChatPanel` 使用 `react-window` 或类似方案，解决长会话渲染性能问题

### 中优先级
4. **进程池管理**：Claude Code 每次消息都 `spawn()` 新进程，可考虑进程复用或连接池
5. **WebSocket 心跳与重连**：当前无自动重连机制，网络波动会导致连接断开
6. **配置 ESLint + Prettier**：统一代码风格，减少 review 成本

### 低优先级
7. **TypeScript 迁移**：核心模块（`sessions.js`, `agents/base.js`）类型化，提升可维护性
8. **API 文档自动生成**：基于 Express 路由生成 OpenAPI/Swagger 文档
9. **多用户支持**：当前是单用户设计，Token 认证只是简单的访问控制

---

## 10. 关键文件速查表

| 功能 | 文件 |
|---|---|
| 后端入口 | `backend/server.js` |
| 会话管理 | `backend/sessions.js` |
| 数据库 | `backend/db.js` |
| Agent 基类 | `backend/agents/base.js` |
| Agent 工厂 | `backend/agents/factory.js` |
| Claude Code 适配器 | `backend/agents/claude-code.js` |
| Claude API 适配器 | `backend/agents/claude-api.js` |
| 权限管理 | `backend/permissions.js` |
| Token 追踪 | `backend/token-tracker.js` |
| WebSocket 处理 | `backend/websocket/handler.js` |
| 前端入口 | `frontend/src/App.jsx` |
| 聊天面板 | `frontend/src/components/ChatPanel.jsx` |
| 侧边栏 | `frontend/src/components/Sidebar.jsx` |
| 消息渲染 | `frontend/src/components/Message.jsx` |
| 数据目录 | `data/agent-hub.db`, `data/token-stats.db` |

---

*本文件为本地备忘，不提交到 GitHub。*
