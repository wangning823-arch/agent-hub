# Agent Hub

通用的 CLI Agent Web UI，支持多个 AI 编程助手同时工作，可通过手机浏览器远程指挥 AI 干活。

## 功能特性

### 多 Agent 支持

| Agent | 说明 |
|-------|------|
| Claude Code | Anthropic 官方 CLI，功能最全 |
| OpenCode | 内置多个免费模型，零成本使用 |
| Codex | OpenAI Codex CLI |
| Claude API | 直接调用 Anthropic API 流的式对话 |

### 核心功能

- **多会话并行** - 每个会话独立运行，互不阻塞，可同时管理多个项目
- **实时流式输出** - WebSocket 实时推送，看到 AI 思考过程
- **远程访问** - 手机浏览器打开即可使用，无需守在电脑旁
- **项目管理** - 保存常用项目，快速切换工作目录
- **上下文管理** - 管理和查看 Token 使用量
- **权限控制** - 支持命令白名单/黑名单

### 前后端架构

```
backend/                 # Node.js + Express + WebSocket (端口 3001)
├── server.js           # 入口
├── sessions.js        # SessionManager 会话管理
├── projects.js        # ProjectManager 项目管理
├── permissions.js    # 权限策略管理
├── token-tracker.js  # Token 统计
├── db.js             # SQLite 数据库
├── routes/           # REST API 路由
├── agents/           # Agent 适配器
└── websocket/       # WebSocket 处理

frontend/              # React + Vite + Tailwind (端口 5173)
└── src/
    ├── App.jsx      # 主组件
    └── components/  # UI 组件
```

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

## 数据存储

```
data/
├── agent-hub.db        # 会话、消息、项目
├── token-stats.db      # Token 统计
└── backups/           # 每日备份（保留30天）
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
| /api/projects | GET | 项目列表 |
| /api/files | GET | 文件列表 |
| /api/files/content | GET | 文件内容 |
| /api/git | GET | Git 操作 |
| /api/search | GET | 搜索 |
| /api/permissions | GET/PUT | 权限管理 |
| /api/tokens/:sessionId | GET | Token 统计 |
| /api/auth/check | GET | 认证检查 |

WebSocket: `ws://localhost:3001?session=SESSION_ID&token=TOKEN`

发送消息格式:
```json
{"type": "user_input", "content": "xxx"}
```

## 添加新 Agent

实现 `Agent` 接口（继承 EventEmitter）:

```javascript
class MyAgent extends EventEmitter {
  constructor(name, workdir) {
    super();
    this.name = name;
    this.workdir = workdir;
  }
  start() { ... }
  send(message) { ... }
  stop() { ... }
}
```

事件: `message`, `error`, `stopped`, `token_usage`, `conversation_id`

## License

MIT