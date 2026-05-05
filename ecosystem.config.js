const { resolve } = require('path');
const fs = require('fs');

// 手动解析 .env 文件，避免依赖 dotenv
const envPath = resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

module.exports = {
  apps: [{
    name: 'agent-pilot',
    script: 'dist/server.js',
    cwd: resolve(__dirname, 'backend'),
    env: {
      NODE_ENV: 'production',
      PORT: parseInt(process.env.PORT || '3003', 10)
    },
    max_memory_restart: '512M',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '30s'
  }]
};
