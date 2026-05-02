module.exports = {
  apps: [{
    name: 'agent-hub-mgmt',
    script: 'dist/server.js',
    cwd: '/home/root1/projects/agent-hub-user-mgmt/backend',
    env: {
      NODE_ENV: 'production',
      PORT: 3002
    },
    max_memory_restart: '512M',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '30s'
  }]
};