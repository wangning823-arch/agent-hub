# Agent Hub

一个通用的 CLI Agent Web UI，支持多个 AI 编程助手同时工作。手机浏览器打开就能远程指挥 AI 干活。

## 支持的 Agent

| Agent | 状态 | 说明 |
|-------|------|------|
| Claude Code | ✅ | Anthropic 官方 CLI，功能最全 |
| OpenCode | ✅ | 内置多个免费模型，零成本使用 |
| Codex | ✅ | OpenAI Codex CLI |
| Claude API | ✅ | 直接调用 Anthropic API |

### 多会话并行

- 每个会话独立运行，互不阻塞
- 可以同时给多个项目下任务
- 切换会话不影响其他任务执行

### 远程访问

- 手机浏览器打开即可使用
- 实时流式输出，看到 AI 思考过程
- 不用守在电脑旁

## 快速开始

```bash
# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 启动
./start.sh
```

服务启动后：
- 前端：http://localhost:5173
- 后端：http://localhost:3001

## 数据存储

采用 SQLite 存储，支持两种数据库：

| 数据库 | 用途 |
|--------|------|
| agent-hub.db | 会话、消息、项目 |
| token-stats.db | Token 统计（独立存储） |

数据文件位置：`data/`

### 备份机制

- `token-stats.db` 每天凌晨自动备份
- 备份保留在 `data/backups/token-stats-YYYY-MM-DD.db`
- 默认保留 30 天

## 项目结构

```
agent-hub/
├── backend/           # Node.js + Express + WebSocket
│   ├── agents/        # Agent 适配器
│   ├── routes/       # API 路由
│   ├── middleware/   # 中间件
│   ├── db.js        # SQLite 数据库
│   └── server.js    # 入口
├── frontend/          # React + Vite + Tailwind
│   └── src/
│       ├── components/
│       └── hooks/
├── data/            # 数据存储
│   ├── agent-hub.db
│   ├── token-stats.db
│   └── backups/
└── README.md
```

## API

| 接口 | 说明 |
|------|------|
| GET /api/sessions | 获取会话列表 |
| POST /api/sessions | 创建会话 |
| DELETE /api/sessions/:id | 删除会话 |
| GET /api/projects | 获取项目列表 |
| GET /api/tokens/:sessionId | Token 统计 |

WebSocket：`ws://localhost:3001?session=SESSION_ID`

## 添加新 Agent

实现 `Agent` 接口（继承 EventEmitter）：

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

## License

MIT