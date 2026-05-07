import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const DESIGNS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'design-systems');

interface DesignSystemMeta {
  id: string
  name: string
  description: string
}

function loadIndex(): DesignSystemMeta[] {
  try {
    if (!fs.existsSync(DESIGNS_DIR)) return [];
    const dirs = fs.readdirSync(DESIGNS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    return dirs.map(id => {
      const readmePath = path.join(DESIGNS_DIR, id, 'README.md');
      let description = '';
      try {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        // Extract first non-empty, non-heading line as description
        const lines = readme.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        description = lines[0]?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim() || '';
      } catch { /* ignore */ }

      // Format name: capitalize, handle dots (e.g., "linear.app" → "Linear", "x.ai" → "X")
      const name = id
        .replace(/\.(com|app|ai|ml|io)$/, '')
        .split('.')
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');

      return { id, name, description };
    });
  } catch {
    return [];
  }
}

export default () => {
  const router = Router();

  // GET / - List all design systems
  router.get('/', (_req: Request, res: Response) => {
    try {
      const index = loadIndex();
      res.json({ systems: index });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id - Get DESIGN.md content
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const designPath = path.join(DESIGNS_DIR, id, 'DESIGN.md');
      if (!fs.existsSync(designPath)) {
        return res.status(404).json({ error: 'Design system not found' });
      }
      const content = fs.readFileSync(designPath, 'utf-8');
      res.json({ id, content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id/preview - Get preview.html content
  router.get('/:id/preview', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const previewPath = path.join(DESIGNS_DIR, id, 'preview.html');
      if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ error: 'Preview not found' });
      }
      const content = fs.readFileSync(previewPath, 'utf-8');
      res.type('html').send(content);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /:id/preview-dark - Get preview-dark.html content
  router.get('/:id/preview-dark', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const previewPath = path.join(DESIGNS_DIR, id, 'preview-dark.html');
      if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ error: 'Dark preview not found' });
      }
      const content = fs.readFileSync(previewPath, 'utf-8');
      res.type('html').send(content);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/apply - Write DESIGN.md to project directory
  router.post('/:id/apply', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { workdir } = req.body;

      if (!workdir || typeof workdir !== 'string') {
        return res.status(400).json({ error: 'workdir is required' });
      }

      const designPath = path.join(DESIGNS_DIR, id, 'DESIGN.md');
      if (!fs.existsSync(designPath)) {
        return res.status(404).json({ error: 'Design system not found' });
      }

      const content = fs.readFileSync(designPath, 'utf-8');
      const targetPath = path.join(workdir, 'DESIGN.md');
      fs.writeFileSync(targetPath, content, 'utf-8');

      // Also copy preview files if they exist
      const previewSrc = path.join(DESIGNS_DIR, id, 'preview.html');
      const previewDarkSrc = path.join(DESIGNS_DIR, id, 'preview-dark.html');
      if (fs.existsSync(previewSrc)) {
        fs.writeFileSync(path.join(workdir, 'preview.html'), fs.readFileSync(previewSrc, 'utf-8'), 'utf-8');
      }
      if (fs.existsSync(previewDarkSrc)) {
        fs.writeFileSync(path.join(workdir, 'preview-dark.html'), fs.readFileSync(previewDarkSrc, 'utf-8'), 'utf-8');
      }

      res.json({ success: true, message: `Design system "${id}" applied to ${workdir}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
