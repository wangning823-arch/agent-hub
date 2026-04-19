const express = require('express');
const router = express.Router();
const os = require('os');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

module.exports = (projectManager, sessionManager) => {
  router.get('/', (req, res) => {
    res.json(projectManager.listProjects());
  });

  router.get('/recent', (req, res) => {
    res.json(projectManager.getRecentProjects());
  });

  router.get('/favorites', (req, res) => {
    res.json(projectManager.getFavoriteProjects());
  });

  router.post('/', (req, res) => {
    try {
      const { name, workdir, agentType, mode, model, effort } = req.body;

      if (!name || !workdir) {
        return res.status(400).json({ error: 'name和workdir是必需的' });
      }

      const project = projectManager.addProject(name, workdir, agentType, { mode, model, effort });
      res.json(project);
    } catch (error) {
      console.error('创建项目失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/import-git', async (req, res) => {
    try {
      const { gitUrl, agentType, mode, model, effort } = req.body;

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

      const existingProject = projectManager.listProjects().find(p => {
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
        const project = projectManager.addProject(repoName, workdir, agentType || 'claude-code', { mode, model, effort });
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
        await new Promise((resolve, reject) => {
          exec(`git clone --depth 1 "${cloneUrl}" "${workdir}"`, {
            timeout: 300000,
            maxBuffer: 1024 * 1024
          }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr || error.message));
            } else {
              resolve(stdout);
            }
          });
        });
      } catch (cloneError) {
        try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
        return res.status(500).json({
          error: `Git clone 失败: ${cloneError.stderr?.toString() || cloneError.message}`
        });
      }

      const project = projectManager.addProject(repoName, workdir, agentType || 'claude-code', { mode, model, effort });

      res.json({
        project,
        status: 'cloned',
        message: `成功 clone 并创建项目 ${repoName}`
      });

    } catch (error) {
      console.error('导入 Git 项目失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const updates = req.body;
      const project = projectManager.updateProject(req.params.id, updates);
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      projectManager.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/:id/favorite', (req, res) => {
    try {
      const project = projectManager.toggleFavorite(req.params.id);
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/search', (req, res) => {
    const query = req.query.q || '';
    res.json(projectManager.searchProjects(query));
  });

  router.post('/:id/start', async (req, res) => {
    try {
      const project = projectManager.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const session = await sessionManager.createSession(
        project.workdir,
        project.agentType,
        {
          mode: project.mode,
          model: project.model,
          effort: project.effort
        }
      );

      projectManager.updateProject(project.id, {
        lastSessionId: session.id,
        lastUsedAt: new Date().toISOString()
      });

      res.json({
        session: session.toJSON(),
        project: project
      });
    } catch (error) {
      console.error('启动项目会话失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};