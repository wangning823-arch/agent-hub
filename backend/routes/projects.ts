import { Router, Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { exec, execSync } from 'child_process';
import { hashPassword } from '../crypto-utils';
import { getDb } from '../db';

export default (projectManager: any, sessionManager: any) => { // TODO: type this
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const userId = req.user?.role === 'admin' ? undefined : req.user?.userId;
    res.json(projectManager.listProjects(userId));
  });

  router.get('/recent', (req: Request, res: Response) => {
    res.json(projectManager.getRecentProjects());
  });

  router.get('/favorites', (req: Request, res: Response) => {
    res.json(projectManager.getFavoriteProjects());
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, workdir, password } = req.body;

      if (!name || !workdir) {
        return res.status(400).json({ error: 'name和workdir是必需的' });
      }

      if (req.user && req.user.role !== 'admin') {
        if (!projectManager.isPathWithinUserHome(workdir, req.user.homeDir)) {
          return res.status(403).json({ error: '项目路径必须在用户目录内' });
        }
      }

      const userId = req.user?.userId;
      const project = projectManager.addProject(name, workdir, password || undefined, userId);
      res.json(project);
    } catch (error: any) {
      console.error('创建项目失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/import-git', async (req: Request, res: Response) => {
    try {
      const { gitUrl, password, credentialId } = req.body;

      if (!gitUrl) {
        return res.status(400).json({ error: 'gitUrl 是必需的' });
      }

      let repoName = '';
      let cloneUrl = gitUrl.trim();
      let targetBranch = '';

      // 提取分支名并去除 /tree/branch 等后缀
      const branchMatch = cloneUrl.match(/\/tree\/([^/?#]+)/);
      if (branchMatch) {
        targetBranch = branchMatch[1];
      }
      cloneUrl = cloneUrl.replace(/\/(tree|blob|pull|issues|actions|releases|wiki)\/.*$/, '');

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

      // 使用用户目录作为克隆目标
      const userHomeDir = req.user?.homeDir || path.join(os.homedir(), 'projects');
      const baseDir = path.join(userHomeDir, 'projects');
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }

      const workdir = path.join(baseDir, repoName);

      if (fs.existsSync(workdir)) {
        console.log(`目录 ${workdir} 已存在，导入项目`);
        const project = projectManager.addProject(repoName, workdir, password || undefined);
        return res.json({
          project,
          status: 'imported',
          message: `目录已存在，已导入项目 ${repoName}`
        });
      }

      if (req.user && req.user.role !== 'admin') {
        if (!projectManager.isPathWithinUserHome(workdir, req.user.homeDir)) {
          return res.status(403).json({ error: '克隆路径必须在用户目录内' });
        }
      }

      console.log(`正在 clone ${cloneUrl} 到 ${workdir}...`);

      if (!cloneUrl.startsWith('http') && !cloneUrl.startsWith('git@')) {
        cloneUrl = `https://github.com/${cloneUrl}`;
      }
      if (cloneUrl.startsWith('https://github.com/') && !cloneUrl.endsWith('.git')) {
        cloneUrl = cloneUrl + '.git';
      }

      // 尝试使用存储的凭证进行 clone
      const hostMatch = cloneUrl.match(/https?:\/\/([^/]+)/) || cloneUrl.match(/git@([^:]+):/);
      if (hostMatch) {
        const host = hostMatch[1];
        const credentialManager = require('../credentialManager').default;
        let cred = null;

        if (credentialId) {
          // 使用用户指定的凭证
          cred = credentialManager.getCredentialById(credentialId);
          console.log(`使用指定凭证 ${credentialId}: ${cred ? '找到' : '未找到'}`);
        } else {
          // 自动查找可用凭证
          const userId = req.user?.userId;
          cred = userId
            ? credentialManager.getAvailableCredentialForHost(host, userId)
            : credentialManager.getSystemCredentialForHost(host);
        }

        if (!cred) {
          // 没有凭证时，使用 GIT_TERMINAL_PROMPT=0 防止 git 挂起等待输入
          console.log(`未找到 ${host} 的凭证，尝试匿名 clone...`);
        }

        if (cred) {
          if (cred.type === 'token' && cred.secret) {
            // HTTPS + token: https://token@github.com/user/repo.git
            const username = cred.username || 'oauth2';
            cloneUrl = cloneUrl.replace('https://', `https://${username}:${cred.secret}@`);
          } else if (cred.type === 'ssh' && cred.key_data) {
            // SSH 模式: 写临时密钥文件
            const tmpKeyPath = path.join(os.tmpdir(), `agent-hub-tmp-key-${Date.now()}`);
            fs.writeFileSync(tmpKeyPath, cred.key_data, { encoding: 'utf8', mode: 0o600 });
            // 转换为 SSH URL
            const sshMatch = cloneUrl.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
            if (sshMatch) {
              cloneUrl = `git@github.com:${sshMatch[1]}.git`;
            }
            // 使用临时密钥进行 clone
            try {
              await new Promise<void>((resolve, reject) => {
                const branchArg = targetBranch ? `-b ${targetBranch}` : '';
                exec(`GIT_SSH_COMMAND="ssh -i ${tmpKeyPath} -o StrictHostKeyChecking=no" git clone --depth 1 ${branchArg} "${cloneUrl}" "${workdir}"`, {
                  timeout: 300000,
                  maxBuffer: 1024 * 1024
                }, (error, stdout, stderr) => {
                  if (error) reject(new Error(stderr || error.message));
                  else resolve();
                });
              });
              // clone 成功后清理临时密钥
              try { fs.unlinkSync(tmpKeyPath); } catch {}
              const project = projectManager.addProject(repoName, workdir, password || undefined, req.user?.userId);
              return res.json({
                project,
                status: 'cloned',
                message: `成功 clone 并创建项目 ${repoName}`
              });
            } catch (cloneError: any) {
              try { fs.unlinkSync(tmpKeyPath); } catch {}
              try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
              return res.status(500).json({
                error: `Git clone 失败: ${cloneError.stderr?.toString() || cloneError.message}`
              });
            }
          }
        }
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const branchArg = targetBranch ? `-b ${targetBranch}` : '';
          exec(`GIT_TERMINAL_PROMPT=0 git clone --depth 1 ${branchArg} "${cloneUrl}" "${workdir}"`, {
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

      const project = projectManager.addProject(repoName, workdir, password || undefined, req.user?.userId);

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
      if (updates.password !== undefined) {
        updates.passwordHash = updates.password ? hashPassword(updates.password) : null;
        delete updates.password;
      }
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
    const userId = req.user?.role === 'admin' ? undefined : req.user?.userId;
    res.json(projectManager.searchProjects(query, userId));
  });

  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const project = projectManager.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (projectManager.hasPassword(project.id)) {
        const { password } = req.body;
        if (!password) {
          return res.status(401).json({ error: '需要项目密码', requiresPassword: true });
        }
        const valid = projectManager.verifyProjectPassword(project.id, password);
        if (!valid) {
          return res.status(403).json({ error: '密码错误' });
        }
      }

      const { agentType = 'claude-code', mode = 'auto', model = null, effort = 'medium' } = req.body;

      const session = await sessionManager.createSession(
        project.workdir,
        agentType,
        {
          mode,
          model,
          effort
        },
        req.user?.userId
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

  router.post('/:id/verify-password', (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      const project = projectManager.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const hasPwd = projectManager.hasPassword(project.id);
      if (!hasPwd) {
        return res.json({ valid: true, hasPassword: false });
      }

      const valid = projectManager.verifyProjectPassword(project.id, password || '');
      res.json({ valid, hasPassword: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/:id/password-status', (req: Request, res: Response) => {
    try {
      const project = projectManager.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }
      res.json({ hasPassword: projectManager.hasPassword(project.id) });
    } catch (error: any) {
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

  // 将模型应用到项目（写入 .claude/settings.json）
  router.post('/:id/apply-model', (req: Request, res: Response) => {
    try {
      const project = projectManager.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const { model, sonnetModel, opusModel, haikuModel, providerId } = req.body;
      if (!model && !sonnetModel && !opusModel && !haikuModel) {
        return res.status(400).json({ error: '请至少设置一个模型' });
      }

      const workdir = project.workdir;
      const claudeDir = path.join(workdir, '.claude');
      const settingsPath = path.join(claudeDir, 'settings.json');

      // 读取现有配置或创建新的
      let settings: any = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch (e) {
          settings = {};
        }
      }

      // 确保 env 对象存在
      if (!settings.env) settings.env = {};

      // 从 Provider 读取连接信息并写入 env
      if (providerId) {
        const db = getDb();
        const uid = req.user!.userId.replace(/'/g, "''");
        const pid = providerId.replace(/'/g, "''");
        // 检查用户有权访问该 Provider（系统分配或个人）
        const result = db.exec(
          `SELECT base_url, base_url_anthropic, api_key FROM providers WHERE id = '${pid}' AND (owner_id IS NULL OR owner_id = '${uid}')`
        );
        if (result.length > 0 && result[0].values.length > 0) {
          const [baseUrl, baseUrlAnthropic, apiKey] = result[0].values[0];
          // Claude Code 使用 anthropic 协议的 base_url
          const anthropicUrl = baseUrlAnthropic || baseUrl;
          if (anthropicUrl) settings.env.ANTHROPIC_BASE_URL = anthropicUrl;
          if (apiKey) settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
        }
      }

      // 设置模型（只覆盖传入的字段，不清除未传入的）
      if (model) settings.env.ANTHROPIC_MODEL = model;
      if (sonnetModel) settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel;
      if (opusModel) settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel;
      if (haikuModel) settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel;

      // 写入配置
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      const setModels = [model && '默认', sonnetModel && 'Sonnet', opusModel && 'Opus', haikuModel && 'Haiku'].filter(Boolean).join('、');
      res.json({
        success: true,
        message: `已将模型 (${setModels}) 应用到 ${project.name}`,
        settingsPath
      });
    } catch (error: any) {
      console.error('应用模型失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
