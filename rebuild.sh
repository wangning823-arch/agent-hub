#!/bin/bash

# Agent Hub Rebuild Script
# 用法: ./rebuild.sh

set -e  # 出错时立即退出

echo "==========================================="
echo "  Agent Hub Rebuild Script"
echo "==========================================="

# 1. 停止 PM2 服务
echo ""
echo ">>> 步骤 1/3: 停止 PM2 服务..."
pm2 stop agent-hub
echo "✅ 服务已停止"

# 2. Build 前端
echo ""
echo ">>> 步骤 2/3: Build 前端..."
cd frontend
npm run build
cd ..
echo "✅ 前端构建完成"

# 3. 启动 PM2 服务
echo ""
echo ">>> 步骤 3/3: 启动 PM2 服务..."
pm2 start agent-hub
echo "✅ 服务已启动"

echo ""
echo "==========================================="
echo "  🎉 Rebuild 完成！"
echo "==========================================="

# 显示服务状态
echo ""
pm2 status agent-hub
