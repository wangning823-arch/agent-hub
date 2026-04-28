# Agent Hub

通用的 CLI Agent Web UI，支持多个 AI 编程助手同时工作，可通过手机浏览器远程指挥 AI 干活。

## 功能特性

### 多 Agent 支持

| Agent | 说明 |
|-------|------|
| Claude Code | Anthropic 官方 CLI，功能最全 |
| OpenCode | 内置多个免费模型，零成本使用 |
| Codex | OpenAI Codex CLI |

### 核心功能

- **多会话并行** - 每个会话独立运行，互不阻塞，可同时管理多个项目
- **实时流式输出** - WebSocket 实时推送，看到 AI 思考过程
- **远程访问** - 手机浏览器打开即可使用，无需守在电脑旁

### 项目管理

- **项目 CRUD** - 创建、编辑、删除项目，支持从 Git 仓库克隆导入
- **项目收藏** - 收藏常用项目，快速访问
- **密码保护** - 项目可选设置密码，启动会话需验证密码
- **项目隔离** - 文件管理和 Git 操作限制在项目目录内，防止跨项目访问
- **凭证管理** - 为 Git 项目配置 Token 或 SSH 密钥凭证

### 会话管理

- **按项目过滤** - 会话列表按项目分组，选择项目后显示对应会话
- **会话标签** - 给会话打标签，支持按标签筛选
- **会话归档** - 归档不活跃的会话，保持列表整洁
- **会话置顶** - 置顶重要会话
- **会话导出** - 支持导出/导入会话备份

### 工作流编排

- **可视化编排** - 拖拽式工作流编辑器
- **多步骤执行** - 支持串行/并行步骤组合
- **模板管理** - 保存和复用工作流模板
- **模型选择** - 每个步骤可独立选择 AI 模型

### 文件与 Git

- **文件浏览器** - 右侧栏显示项目文件树，支持查看和编辑文件内容
- **相对路径显示** - 文件管理器显示相对于项目根目录的路径
- **Git 控制** - Pull、Push、Commit、分支管理等常用 Git 操作
- **变更查看** - 显示已修改、已暂存、未跟踪的文件

### 其他功能

- **Token 统计** - 跟踪每个会话的 API Token 使用量和费用
- **技能系统** - 安装和使用 Claude Code 技能插件
- **模型管理** - 配置和切换不同的 AI 模型
- **主题切换** - 支持明暗主题
- **记忆恢复** - 恢复之前的会话上下文

## 快速开始

```bash
# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 启动后端和前端
./start.sh
```

服务启动后：
- 前端：http://localhost:5173
- 后端：http://localhost:3001

## 项目结构

```
agent-hub/
├── backend/                    # Node.js + Express + WebSocket (端口 3001)
│   ├── server.ts              # 入口
│   ├── db.ts                  # SQLite 数据库
│   ├── projects.ts            # ProjectManager 项目管理
│   ├── crypto-utils.ts        # 密码哈希工具
│   ├── credentialManager.ts   # Git 凭证管理
│   ├── workflow-engine.ts     # 工作流引擎
│   ├── summary-service.ts     # 会话摘要服务
│   ├── routes/                # REST API 路由
│   │   ├── sessions.ts       # 会话管理
│   │   ├── projects.ts       # 项目管理
│   │   ├── files.ts          # 文件操作
│   │   ├── git.ts            # Git 操作
│   │   ├── workflows.ts      # 工作流管理
│   │   ├── models.ts         # 模型管理
│   │   ├── credentials.ts    # 凭证管理
│   │   ├── skills.ts         # 技能管理
│   │   └── ...
│   └── agents/                # Agent 适配器
│       ├── base.ts           # Agent 基类
│       ├── claude-code.ts    # Claude Code 适配器
│       ├── opencode.ts       # OpenCode 适配器
│       └── codex.ts          # Codex 适配器
│
├── frontend/                   # React + Vite + Tailwind (端口 5173)
│   └── src/
│       ├── App.tsx            # 主组件
│       └── components/        # UI 组件
│           ├── Sidebar.tsx        # 左侧栏（会话列表、项目选择）
│           ├── ChatPanel.tsx      # 聊天面板
│           ├── RightSidebar.tsx   # 右侧栏（文件管理、Git 控制）
│           ├── ProjectManager.tsx # 项目管理弹窗
│           ├── WorkflowEditor.tsx # 工作流编辑器
│           └── ...
│
└── data/                       # 数据存储
    ├── projects.json          # 项目配置
    ├── sessions.json          # 会话数据
    └── agent-hub.db           # SQLite 数据库
```

## API

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/health | GET | 健康检查 |
| /api/agents | GET | 可用 Agent 列表 |
| /api/sessions | GET/POST | 会话列表/创建 |
| /api/sessions/:id | DELETE | 删除会话 |
| /api/sessions/:id/rename | PUT | 重命名 |
| /api/sessions/:id/resume | POST | 恢复会话 |
| /api/projects | GET/POST | 项目列表/创建 |
| /api/projects/:id | PUT/DELETE | 更新/删除项目 |
| /api/projects/:id/start | POST | 启动项目会话（需密码验证） |
| /api/projects/:id/verify-password | POST | 验证项目密码 |
| /api/files | GET | 文件列表 |
| /api/files/content | GET | 文件内容 |
| /api/git/status | GET | Git 状态 |
| /api/git/command | POST | 执行 Git 命令 |
| /api/git/commit | POST | Git 提交 |
| /api/workflows | GET/POST | 工作流列表/创建 |
| /api/models | GET | 可用模型列表 |
| /api/credentials | GET/POST | 凭证管理 |
| /api/skills/:agentType | GET | 技能列表 |
| /api/tokens/:sessionId | GET | Token 统计 |

WebSocket: `ws://localhost:3001?session=SESSION_ID&token=TOKEN`

发送消息格式:
```json
{"type": "user_input", "content": "xxx"}
```

## 添加新 Agent

实现 `Agent` 接口（继承 EventEmitter）:

```typescript
class MyAgent extends EventEmitter {
  constructor(name: string, workdir: string) {
    super();
    this.name = name;
    this.workdir = workdir;
  }
  start(): void { ... }
  send(message: string): void { ... }
  stop(): void { ... }
}
```

事件: `message`, `error`, `stopped`, `token_usage`, `conversation_id`

然后在 `agents/factory.ts` 中注册。

## License

MIT
