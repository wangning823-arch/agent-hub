import { Router, Request, Response } from 'express';
import path from 'path';
import { execFileSync } from 'child_process';

export default (ALLOWED_ROOT: string, permissionManager: any, projectManager?: any) => { // TODO: type this
  const router = Router();

  function requireProjectScope(req: Request, res: Response, next: Function) {
    const workdir = (req.query.path || req.body?.workdir) as string;
    const projectId = req.headers['x-project-id'] as string;

    if (!projectId || !workdir || !projectManager) {
      const resolved = path.resolve(workdir || '');
      if (!resolved.startsWith(ALLOWED_ROOT)) {
        return res.status(403).json({ error: '路径不在允许的范围内' });
      }
      return next();
    }

    const project = projectManager.getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: '项目不存在' });
    }

    const resolved = path.resolve(workdir);
    if (!resolved.startsWith(ALLOWED_ROOT) || !resolved.startsWith(project.workdir)) {
      return res.status(403).json({ error: '无权访问此项目目录外的文件' });
    }

    next();
  }

  router.get('/status', requireProjectScope, async (req: Request, res: Response) => {
    const workdir = req.query.path as string;
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

      let modified: string[] = [];
      let staged: string[] = [];
      let untracked: string[] = [];

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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/command', requireProjectScope, async (req: Request, res: Response) => {
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
    } catch (error: any) {
      res.status(500).json({ error: error.message, output: (error.stderr ? error.stderr.toString() : error.message) });
    }
  });

  router.post('/commit', requireProjectScope, async (req: Request, res: Response) => {
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
