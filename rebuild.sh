#!/bin/bash

# Agent Hub Rebuild Script
# 用法: ./rebuild.sh

set -e

echo "==========================================="
echo "  Agent Hub Rebuild Script"
echo "==========================================="

# 加载 .env 配置
if [ -f .env ]; then
  set -a
  . .env
  set +a
fi

SERVICE_NAME="agent-pilot"

# 1. 停止 PM2 服务
echo ""
echo ">>> 步骤 1/5: 停止 PM2 服务..."
pm2 stop "$SERVICE_NAME" || true
pm2 delete "$SERVICE_NAME" || true
echo "✅ 服务已停止"

# 2. 拉取最新代码
echo ""
echo ">>> 步骤 2/5: 拉取最新代码..."
REMOTE_URL="${GIT_REMOTE_URL:-https://github.com/wangning823-arch/agent-hub.git}"
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [ "$CURRENT_REMOTE" != "$REMOTE_URL" ]; then
  echo "  配置远程仓库: $REMOTE_URL"
  git remote set-url origin "$REMOTE_URL" 2>/dev/null || git remote add origin "$REMOTE_URL"
fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if timeout 30 git pull origin "$BRANCH"; then
  echo "✅ 代码已更新"
else
  echo "⚠️  git pull 超时或失败，跳过更新，使用当前代码继续构建"
fi

# 3. 安装后端依赖并编译
echo ""
echo ">>> 步骤 3/5: 安装后端依赖并编译 TypeScript..."
cd backend
npm install
npx tsc
cd ..
echo "✅ 后端编译完成"

# 4. 安装前端依赖并构建
echo ""
echo ">>> 步骤 4/5: 安装前端依赖并构建..."
cd frontend
npm install
npm run build
cd ..
echo "✅ 前端构建完成"

# 5. 启动 PM2 服务
echo ""
echo ">>> 步骤 5/5: 启动 PM2 服务..."
pm2 start ecosystem.config.js
echo "✅ 服务已启动"

echo ""
echo "==========================================="
echo "  Rebuild 完成！"
echo "==========================================="

pm2 status "$SERVICE_NAME"
