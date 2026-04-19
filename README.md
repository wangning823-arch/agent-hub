# Agent Hub

一个通用的 CLI Agent Web UI，支持多个 AI 编程助手同时工作。手机浏览器打开就能远程指挥 AI 干活。

## 支持的 Agent

| Agent | 状态 | 说明 |
|-------|------|------|
| Claude Code | ✅ 已支持 | Anthropic 官方 CLI，功能最全 |
| OpenCode | ✅ 已支持 | 内置多个免费模型，零成本使用 |
| Codex | ✅ 已支持 | OpenAI Codex CLI |

## 亮点

### 🆓 OpenCode 免费模型

OpenCode 内置多个免费模型（cost=0），开箱即用：

| 模型 | 上下文 | 特点 |
|------|--------|------|
| GPT-5 Nano | 400K | 支持推理，速度快 |
| Big Pickle | 200K | 支持推理 |
| MiniMax M2.5 Free | 204K | 轻量高效 |
| Nemotron 3 Super Free | 204K | 支持推理强度调节 |

另外通过配置还可使用 Bailian（阿里百炼）、MiMo 等模型。

### 🔄 多会话并行

- 每个会话独立运行，互不阻塞
- 可以同时给多个项目下任务
- 切换会话不影响其他任务执行

### 📱 远程访问

- 手机浏览器打开即可使用
- 实时流式输出，看到 AI 思考过程
- 不用守在电脑旁

## 特性

- 💬 对话式 UI，一个窗口对应一个项目
- 🔄 多项目并行，每个项目独立 Agent 进程
- 🏷️ 会话标签和置顶
- 📎 文件上传和上下文管理
- 🔌 模块化设计，轻松添加新 Agent 适配器
- 📱 兼容 Termux (Android)
- 🚀 零 native 依赖，npm install 即用

## 快速开始

```bash
# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 启动
cd ../backend && npm start      # 后端：http://localhost:3001
cd ../frontend && npm run dev   # 前端：http://localhost:5173
```

## 项目结构

```
agent-hub/
├── backend/           # Node.js + Express + WebSocket
│   ├── agents/        # Agent 适配器 (claude-code, opencode, codex)
│   ├── sessions/      # 会话管理
│   └── server.js      # 入口
├── frontend/          # React + Vite
│   └── src/
│       ├── components/
│       └── hooks/
└── README.md
```

## 添加新 Agent

实现 `Agent` 接口即可：

```javascript
class MyAgent {
  constructor(name, workdir) { ... }
  start() { ... }
  send(message) { ... }
  onMessage(callback) { ... }
  stop() { ... }
}
```

## License

MIT

Note: Phase0 design and scaffolding committed under docs/phase0-design.md and scaffolding files under backend/ and frontend/phase0-*, enabling staged, risk-minimized refactors. Phase1 will implement actual modularization of backend routes, WS hub, and persistence layers.
