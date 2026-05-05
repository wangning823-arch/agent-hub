const dotenv = require('dotenv');
const { resolve } = require('path');

dotenv.config({ path: resolve(__dirname, '.env') });

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