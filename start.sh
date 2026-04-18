#!/bin/bash

# Agent Hub 启动脚本

echo "🚀 启动 Agent Hub..."

# 记录项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# 检查依赖是否安装
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
  echo "📦 安装后端依赖..."
  (cd "$PROJECT_ROOT/backend" && npm install)
fi

if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
  echo "📦 安装前端依赖..."
  (cd "$PROJECT_ROOT/frontend" && npm install)
fi

# 启动后端（子shell，不影响父目录）
echo "🔧 启动后端服务..."
(cd "$PROJECT_ROOT/backend" && node server.js) &
BACKEND_PID=$!

# 等待后端启动
sleep 2

# 启动前端（子shell，不影响父目录）
echo "🎨 启动前端服务..."
(cd "$PROJECT_ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

# 等待前端启动
sleep 3

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│         Agent Hub 已启动!                │"
echo "│─────────────────────────────────────────│"
echo "│  前端: http://localhost:5173             │"
echo "│  后端: http://localhost:3001             │"
echo "│─────────────────────────────────────────│"
echo "│  按 Ctrl+C 停止服务                      │"
echo "└─────────────────────────────────────────┘"
echo ""

# 捕获退出信号
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM

# 等待进程
wait