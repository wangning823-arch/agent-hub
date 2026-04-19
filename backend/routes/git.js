const express = require('express');
const router = express.Router();
const path = require('path');
const { execFileSync } = require('child_process');
const permissionManager = require('../permissions');

module.exports = (ALLOWED_ROOT, permissionManager) => {
  router.get('/status', async (req, res) => {
    const workdir = req.query.path;
    if (!workdir) {
      return res.status(400).json({ error: 'path参数是必需的' });
    }

    const resolved = path.resolve(workdir);
    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }

    try {
      let branch = 'main';
      try {
        branch = execFileSync('git', ['branch', '--show-current'], { cwd: workdir, encoding: 'utf8' }).trim();
      } catch (e) {}

      let modified = [];
      let staged = [];
      let untracked = [];

      try {
        const status = execFileSync('git', ['status', '--porcelain'], { cwd: workdir, encoding: 'utf8' });
        status.split('\n').filter(Boolean).forEach(line => {
          const statusChar = line.slice(0, 2);
          const file = line.slice(3);

          if (statusChar[0] === 'M' || statusChar[0] === 'A') {
            staged.push(file);
          } else if (statusChar[1] === 'M') {
            modified.push(file);
          } else if (statusChar === '??') {
            untracked.push(file);
          }
        });
      } catch (e) {}

      res.json({ branch, modified, staged, untracked });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/command', async (req, res) => {
    const { workdir, command } = req.body;
    if (!workdir || !command) {
      return res.status(400).json({ error: 'workdir和command是必需的' });
    }

    const resolved = path.resolve(workdir);
    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }

    const allowedSubCommands = ['pull', 'push', 'status', 'log', 'diff', 'stash', 'fetch', 'branch'];
    const parts = command.replace(/^git\s+/, '').split(/\s+/);
    const subCmd = parts[0];

    if (!allowedSubCommands.includes(subCmd)) {
      return res.status(403).json({ error: '不允许的命令' });
    }

    const decision = permissionManager.checkPermission('shell_exec', { command });
    if (decision === 'deny') {
      return res.status(403).json({ error: '命令被权限策略拒绝' });
    }

    try {
      const output = execFileSync('git', [subCmd, ...parts.slice(1)], {
        cwd: workdir,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      });
      res.json({ output: output.trim() });
    } catch (error) {
      res.status(500).json({ error: error.message, output: (error.stderr ? error.stderr.toString() : error.message) });
    }
  });

  router.post('/commit', async (req, res) => {
    const { workdir, message, files } = req.body;
    if (!workdir || !message) {
      return res.status(400).json({ error: 'workdir和message是必需的' });
    }

    const resolved = path.resolve(workdir);
    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }

    try {
      if (files && files.length > 0) {
        execFileSync('git', ['add', ...files], { cwd: workdir });
      } else {
        execFileSync('git', ['add', '-A'], { cwd: workdir });
      }

      const output = execFileSync('git', ['commit', '-m', message], {
        cwd: workdir,
        encoding: 'utf8'
      });

      res.json({ success: true, output: output.trim() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};