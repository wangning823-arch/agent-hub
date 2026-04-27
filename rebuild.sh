#!/bin/bash

# Agent Hub Rebuild Script
# 用法: ./rebuild.sh

set -e  # 出错时立即退出

echo "==========================================="
echo "  Agent Hub Rebuild Script"
echo "==========================================="

# 1. 停止 PM2 服务
echo ""
echo ">>> 步骤 1/4: 停止 PM2 服务..."
pm2 stop agent-hub || true
echo "✅ 服务已停止"

# 2. 安装依赖并编译后端 TypeScript
echo ""
echo ">>> 步骤 2/4: 安装后端依赖并编译 TypeScript..."
cd backend
npm install
npx tsc
cd ..
echo "✅ 后端编译完成"

# 3. 安装依赖并构建前端
echo ""
echo ">>> 步骤 3/4: 安装前端依赖并构建..."
cd frontend
npm install
npm run build
cd ..
echo "✅ 前端构建完成"

# 4. 启动 PM2 服务
echo ""
echo ">>> 步骤 4/4: 启动 PM2 服务..."
pm2 start agent-hub || pm2 start ecosystem.config.js
echo "✅ 服务已启动"

echo ""
echo "==========================================="
echo "  🎉 Rebuild 完成！"
echo "==========================================="

# 显示服务状态
echo ""
pm2 status agent-hub
