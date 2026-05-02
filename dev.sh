#!/bin/bash

# Agent Hub User Mgmt 开发环境启动脚本
# 后端: PM2 管理 (端口 3002)
# 前端: Vite dev server (端口 5173)

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# 1. 编译并启动后端 (PM2)
echo ">>> 编译后端..."
cd "$PROJECT_ROOT/backend"
npx tsc
cd "$PROJECT_ROOT"

pm2 restart agent-hub-mgmt 2>/dev/null || pm2 start ecosystem.config.js
echo "✅ 后端已启动: http://localhost:3002"

# 2. 启动前端 (如果没在运行)
if ! lsof -i :5173 >/dev/null 2>&1; then
  echo ">>> 启动前端..."
  cd "$PROJECT_ROOT/frontend"
  npm run dev &
  echo "✅ 前端已启动: http://localhost:5173"
else
  echo "✅ 前端已在运行: http://localhost:5173"
fi

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│       开发环境已就绪!                    │"
echo "│─────────────────────────────────────────│"
echo "│  前端: http://localhost:5173             │"
echo "│  后端: http://localhost:3002             │"
echo "└─────────────────────────────────────────┘"
