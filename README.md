# Agent Hub

一个通用的CLI Agent Web UI，支持多个AI编程助手同时工作。

## 支持的Agent

- [x] Claude Code
- [ ] OpenCode
- [ ] Codex

## 特性

- 💬 对话式UI，一个窗口对应一个项目
- 🔄 多项目并行，每个项目独立Agent进程
- 🔌 模块化设计，轻松添加新Agent适配器
- 📱 兼容Termux (Android)
- 🚀 零native依赖，npm install即用

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
│   ├── agents/        # Agent适配器
│   ├── sessions/      # 会话管理
│   └── server.js      # 入口
├── frontend/          # React + Vite
│   └── src/
│       ├── components/
│       └── hooks/
└── README.md
```

## 添加新Agent

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