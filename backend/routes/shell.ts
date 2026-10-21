import { Router, Request, Response } from 'express';
import path from 'path';
import { spawn } from 'child_process';

const MAX_OUTPUT_BYTES = 200 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 5 * 60 * 1000;

export default (ALLOWED_ROOT: string, permissionManager: any, projectManager?: any) => { // TODO: type this
  const router = Router();

  function getUserRoot(req: Request): string {
    return (req.user && req.user.role !== 'admin')
      ? req.user.homeDir
      : ALLOWED_ROOT;
  }

  // 解析并校验工作目录：必须在用户根目录内，且（若指定项目）在项目目录内
  function resolveWorkdir(req: Request): { workdir: string; error?: string } {
    const userRoot = getUserRoot(req);
    const requested = (req.body?.workdir as string | undefined) || userRoot;
    const resolved = path.resolve(requested);

    if (!resolved.startsWith(userRoot)) {
      return { workdir: '', error: '路径不在允许的范围内' };
    }

    const projectId = req.headers['x-project-id'] as string | undefined;
    if (projectId && projectManager) {
      const project = projectManager.getProject(projectId);
      if (!project) {
        return { workdir: '', error: '项目不存在' };
      }
      if (!resolved.startsWith(path.resolve(project.workdir))) {
        return { workdir: '', error: '无权访问此项目目录外的路径' };
      }
    }

    return { workdir: resolved };
  }

  router.post('/exec', (req: Request, res: Response) => {
    const { command, confirm } = req.body || {};
    if (!command || typeof command !== 'string' || !command.trim()) {
      return res.status(400).json({ error: 'command参数是必需的' });
    }

    const scope = resolveWorkdir(req);
    if (scope.error) {
      return res.status(403).json({ error: scope.error });
    }

    const decision = permissionManager.checkPermission('shell_exec', { command });
    if (decision === 'deny') {
      return res.status(403).json({ error: '命令被权限策略拒绝' });
    }
    // 危险命令需要前端二次确认（携带 confirm=true 重发）
    if (decision === 'ask_user' && !confirm) {
      return res.status(403).json({
        error: '该命令命中危险模式，需要确认后才能执行',
        needsConfirm: true
      });
    }

    const timeoutMs = Math.min(
      parseInt(req.body?.timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );

    const child = spawn('/bin/sh', ['-c', command], {
      cwd: scope.workdir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const append = (buf: Buffer) => {
      if (truncated) return;
      const room = MAX_OUTPUT_BYTES - size;
      if (buf.length >= room) {
        chunks.push(buf.subarray(0, room));
        size = MAX_OUTPUT_BYTES;
        truncated = true;
        child.kill('SIGTERM');
      } else {
        chunks.push(buf);
        size += buf.length;
      }
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 3000).unref();
    }, timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      let output = Buffer.concat(chunks).toString('utf8');
      if (truncated) {
        output += `\n...（输出超过 ${MAX_OUTPUT_BYTES / 1024}KB，已截断）`;
      }
      if (timedOut) {
        output += `\n...（命令超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已终止）`;
      }
      res.json({
        output: output.trim(),
        exitCode: timedOut ? null : exitCode,
        timedOut,
        truncated
      });
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      res.status(500).json({ error: err.message });
    });

    child.on('close', (code) => finish(code));
  });

  return router;
};
