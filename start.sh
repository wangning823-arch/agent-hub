#!/bin/bash

# Agent Hub 启动脚本
# 默认模式：构建前端 + 后端统一提供服务（单端口）
# 开发模式：./start.sh dev （前端热更新 + 后端，需要两个端口）

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-prod}"

# 检查依赖是否安装
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
  echo "📦 安装后端依赖..."
  (cd "$PROJECT_ROOT/backend" && npm install)
fi

if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
  echo "📦 安装前端依赖..."
  (cd "$PROJECT_ROOT/frontend" && npm install)
fi

if [ "$MODE" = "dev" ]; then
  # ===== 开发模式：前后端分离，Vite 代理 API =====
  echo "🚀 启动 Agent Hub (开发模式)..."

  (cd "$PROJECT_ROOT/backend" && npm run dev) &
  BACKEND_PID=$!
  sleep 2

  (cd "$PROJECT_ROOT/frontend" && npm run dev) &
  FRONTEND_PID=$!

  echo ""
  echo "┌─────────────────────────────────────────┐"
  echo "│     Agent Hub 已启动 (开发模式)          │"
  echo "│─────────────────────────────────────────│"
  echo "│  前端: http://localhost:5173             │"
  echo "│  后端: http://localhost:3001             │"
  echo "│─────────────────────────────────────────│"
  echo "│  按 Ctrl+C 停止服务                      │"
  echo "└─────────────────────────────────────────┘"
  echo ""

  trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
  wait
else
  # ===== 生产模式：构建前端 + 后端单端口 =====
  echo "🚀 启动 Agent Hub..."

  echo "🔨 构建前端..."
  (cd "$PROJECT_ROOT/frontend" && npm run build)

  echo "🔧 启动后端服务..."
  (cd "$PROJECT_ROOT/backend" && node dist/server.js) &
  BACKEND_PID=$!

  echo ""
  echo "┌─────────────────────────────────────────┐"
  echo "│         Agent Hub 已启动!                │"
  echo "│─────────────────────────────────────────│"
  echo "│  访问: http://localhost:3001             │"
  echo "│─────────────────────────────────────────│"
  echo "│  按 Ctrl+C 停止服务                      │"
  echo "└─────────────────────────────────────────┘"
  echo ""

  trap "kill $BACKEND_PID 2>/dev/null; exit" SIGINT SIGTERM
  wait
fi
