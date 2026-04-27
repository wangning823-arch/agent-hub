import { Router, Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { exec, execSync } from 'child_process';

export default (projectManager: any, sessionManager: any) => { // TODO: type this
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(projectManager.listProjects());
  });

  router.get('/recent', (_req: Request, res: Response) => {
    res.json(projectManager.getRecentProjects());
  });

  router.get('/favorites', (_req: Request, res: Response) => {
    res.json(projectManager.getFavoriteProjects());
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, workdir } = req.body;

      if (!name || !workdir) {
        return res.status(400).json({ error: 'name和workdir是必需的' });
      }

      const project = projectManager.addProject(name, workdir);
      res.json(project);
    } catch (error: any) {
      console.error('创建项目失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/import-git', async (req: Request, res: Response) => {
    try {
      const { gitUrl } = req.body;

      if (!gitUrl) {
        return res.status(400).json({ error: 'gitUrl 是必需的' });
      }

      let repoName = '';
      let cloneUrl = gitUrl.trim();

      const patterns = [
        /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/,
        /gitlab\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/,
        /bitbucket\.org[:/]([^/]+)\/([^/.]+)(?:\.git)?$/,
        /([^/:]+)\/([^/.]+)(?:\.git)?$/
      ];

      let owner = '';
      for (const pattern of patterns) {
        const match = cloneUrl.match(pattern);
        if (match) {
          owner = match[1];
          repoName = match[2];
          break;
        }
      }

      if (!repoName) {
        return res.status(400).json({ error: '无法解析 Git URL，请检查格式' });
      }

      const existingProject = projectManager.listProjects().find((p: any) => { // TODO: type this
        const dirName = p.workdir.split('/').pop();
        return dirName === repoName || p.workdir.includes(`/${repoName}`);
      });

      if (existingProject) {
        console.log(`项目 ${repoName} 已存在于 ${existingProject.workdir}`);
        return res.json({
          project: existingProject,
          status: 'existing',
          message: `项目 ${repoName} 已存在`
        });
      }

      const baseDir = path.join(os.homedir(), 'projects');
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }

      const workdir = path.join(baseDir, repoName);

      if (fs.existsSync(workdir)) {
        console.log(`目录 ${workdir} 已存在，导入项目`);
        const project = projectManager.addProject(repoName, workdir);
        return res.json({
          project,
          status: 'imported',
          message: `目录已存在，已导入项目 ${repoName}`
        });
      }

      console.log(`正在 clone ${cloneUrl} 到 ${workdir}...`);

      if (!cloneUrl.startsWith('http') && !cloneUrl.startsWith('git@')) {
        cloneUrl = `https://github.com/${cloneUrl}`;
      }
      if (cloneUrl.startsWith('https://github.com/') && !cloneUrl.endsWith('.git')) {
        cloneUrl = cloneUrl + '.git';
      }

      try {
        await new Promise<void>((resolve, reject) => {
          exec(`git clone --depth 1 "${cloneUrl}" "${workdir}"`, {
            timeout: 300000,
            maxBuffer: 1024 * 1024
          }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr || error.message));
            } else {
              resolve();
            }
          });
        });
      } catch (cloneError: any) { // TODO: type this
        try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
        return res.status(500).json({
          error: `Git clone 失败: ${cloneError.stderr?.toString() || cloneError.message}`
        });
      }

      const project = projectManager.addProject(repoName, workdir);

      res.json({
        project,
        status: 'cloned',
        message: `成功 clone 并创建项目 ${repoName}`
      });

    } catch (error: any) {
      console.error('导入 Git 项目失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id', (req: Request, res: Response) => {
    try {
      const updates = req.body;
      const project = projectManager.updateProject(req.params.id, updates);
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      projectManager.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/favorite', (req: Request, res: Response) => {
    try {
      const project = projectManager.toggleFavorite(req.params.id);
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/search', (req: Request, res: Response) => {
    const query = req.query.q || '';
    res.json(projectManager.searchProjects(query));
  });

  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const project = projectManager.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const { agentType = 'claude-code', mode = 'auto', model = null, effort = 'medium' } = req.body;

      const session = await sessionManager.createSession(
        project.workdir,
        agentType,
        {
          mode,
          model,
          effort
        }
      );

      // 更新项目的最后使用信息（可选）
      try {
        projectManager.updateProject(project.id, {
          lastSessionId: session.id,
          lastUsedAt: new Date().toISOString()
        });
      } catch (updateErr: any) { // TODO: type this
        // 忽略更新错误，不影响会话创建
        console.warn('更新项目最后使用信息失败:', updateErr.message);
      }

      res.json({
        session: session.toJSON(),
        project: project
      });
    } catch (error: any) {
      console.error('启动项目会话失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 将已存凭证应用到项目（支持HTTPS→SSH自动转换）
  router.post('/:id/apply-credential', (req: Request, res: Response) => {
    try {
      const project = projectManager.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const credentialManager = require('../credentialManager').default;
      const { host } = req.body;
      if (!host) return res.status(400).json({ error: 'host是必需的' });

      const cred = credentialManager.getCredentialForHost(host);
      if (!cred) return res.status(404).json({ error: `未找到 ${host} 的凭证` });

      const workdir = project.workdir;
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) return res.status(400).json({ error: '非Git仓库' });

      // 获取当前 remote URL
      let remoteUrl = '';
      try {
        remoteUrl = execSync('git config --local --get remote.origin.url', {
          cwd: workdir, encoding: 'utf8'
        }).trim();
      } catch (e) {
        return res.status(400).json({ error: '无法获取远程仓库地址' });
      }

      const isHttps = remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://');
      const isSsh = remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://');

      // 如果凭证类型和协议不匹配，尝试转换 remote URL
      if (cred.type === 'ssh' && isHttps) {
        // HTTPS → SSH: https://github.com/user/repo.git → git@github.com:user/repo.git
        const match = remoteUrl.match(/https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
        if (match) {
          const newUrl = `git@${match[1]}:${match[2]}.git`;
          execSync(`git config --local remote.origin.url "${newUrl}"`, { cwd: workdir });
          remoteUrl = newUrl;
        }
      } else if (cred.type === 'token' && isSsh) {
        // SSH → HTTPS: git@github.com:user/repo.git → https://github.com/user/repo.git
        const match = remoteUrl.match(/git@([^:]+):(.+?)(?:\.git)?$/);
        if (match) {
          const newUrl = `https://${match[1]}/${match[2]}.git`;
          execSync(`git config --local remote.origin.url "${newUrl}"`, { cwd: workdir });
          remoteUrl = newUrl;
        }
      }

      // 应用凭证
      const result = credentialManager.applyCredentialToWorkdir(workdir, cred);
      if (!result.success) return res.status(500).json({ error: result.error || result.message });

      // 直接更新项目的 gitHost 和 gitConfigured
      const newHost = projectManager._getGitHostFromWorkdir(workdir);
      project.gitHost = newHost;
      project.gitConfigured = true;
      project.updatedAt = new Date().toISOString();
      projectManager.saveData();

      res.json({
        success: true,
        message: `已将 ${cred.type === 'ssh' ? 'SSH' : 'Token'} 凭证应用到 ${project.name}`,
        remoteUrl
      });
    } catch (error: any) {
      console.error('应用凭证失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
