#!/bin/bash

# Agent Hub User Mgmt 快速重启脚本
# 只重启后端，前端保持不变

echo "🔄 重新编译后端..."

# 重新编译后端
cd "$(dirname "$0")/backend"
npx tsc
cd ..

# 重启 PM2 后端服务
pm2 restart agent-hub-mgmt 2>/dev/null || pm2 start ecosystem.config.js

echo ""
pm2 status agent-hub-mgmt
echo ""
echo "✅ 后端重启完成！http://localhost:3002"
