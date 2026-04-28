import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export default (ALLOWED_ROOT: string, projectManager?: any) => {
  const router = Router();

  function requireProjectScope(req: Request, res: Response, next: Function) {
    const projectId = req.headers['x-project-id'] as string || req.query.projectId as string;
    const filePath = (req.query.path || req.body?.path) as string;

    if (!projectId || !filePath || !projectManager) {
      const resolved = path.resolve(filePath || '');
      if (!resolved.startsWith(ALLOWED_ROOT)) {
        return res.status(403).json({ error: '路径不在允许的范围内' });
      }
      return next();
    }

    const project = projectManager.getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: '项目不存在' });
    }

    const resolved = path.resolve(filePath);

    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }
    if (!resolved.startsWith(project.workdir)) {
      return res.status(403).json({ error: '无权访问此项目目录外的文件' });
    }

    next();
  }

  router.get('/', requireProjectScope, (req: Request, res: Response) => {
    const dirPath = req.query.path as string;
    if (!dirPath) {
      return res.status(400).json({ error: 'path参数是必需的' });
    }

    const resolved = path.resolve(dirPath);
    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }

    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = items.map(item => {
        const fullPath = `${dirPath}/${item.name}`.replace(/\/+/g, '/');
        let size: number | null = null;
        if (!item.isDirectory()) {
          try {
            const stat = fs.statSync(fullPath);
            size = stat.size;
          } catch (err) {}
        }
        return {
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
          size
        };
      });

      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      res.json({ files });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/content', requireProjectScope, (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: 'path参数是必需的' });
    }

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      res.json({ content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/content', requireProjectScope, (req: Request, res: Response) => {
    const { path: filePath, content } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path和content参数是必需的' });
    }

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ALLOWED_ROOT)) {
      return res.status(403).json({ error: '路径不在允许的范围内' });
    }

    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件不存在' });
      }

      fs.writeFileSync(filePath, content, 'utf8');
      res.json({ success: true, message: '文件已保存' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
