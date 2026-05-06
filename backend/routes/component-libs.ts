import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const DATA_FILE = path.join(__dirname, '../../../data/component-libraries.json');

function loadData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

const DETECTION_RULES: { test: (deps: Record<string, string>) => boolean; id: string }[] = [
  { test: (d) => !!d['tailwindcss'], id: 'tailwind' },
  { test: (d) => !!d['antd'], id: 'antd' },
  { test: (d) => !!d['@mui/material'], id: 'mui' },
  {
    test: (d) => {
      const keys = Object.keys(d);
      const hasRadix = keys.some((k) => k.startsWith('@radix-ui/react-'));
      const hasTailwindMerge = !!d['tailwind-merge'];
      return hasRadix && hasTailwindMerge;
    },
    id: 'shadcn',
  },
];

async function detectLibraries(workdir: string): Promise<string[]> {
  const detected: string[] = [];
  try {
    const pkgPath = path.join(workdir, 'package.json');
    if (!fs.existsSync(pkgPath)) return detected;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    for (const rule of DETECTION_RULES) {
      if (rule.test(deps)) {
        detected.push(rule.id);
      }
    }
  } catch {
    // ignore parse errors
  }
  return detected;
}

export default () => {
  const router = Router();

  // GET /api/component-libs — list all libraries with detection status
  router.get('/', async (req: Request, res: Response) => {
    try {
      const workdir = (req.query.workdir as string) || '';
      const data = loadData();
      const detected = workdir ? await detectLibraries(workdir) : [];
      const libraries = data.libraries.map((lib: any) => ({
        id: lib.id,
        name: lib.name,
        version: lib.version,
        package: lib.package,
        description: lib.description,
        detected: detected.includes(lib.id),
        componentCount: lib.components.length,
      }));
      res.json({ libraries, categories: data.categories });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/component-libs/detect — detect libraries from package.json
  router.get('/detect', async (req: Request, res: Response) => {
    try {
      const workdir = (req.query.workdir as string) || '';
      if (!workdir) {
        return res.status(400).json({ error: 'workdir is required' });
      }
      const detected = await detectLibraries(workdir);
      res.json({ detected });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/component-libs/detect — detect libraries (body-based)
  router.post('/detect', async (req: Request, res: Response) => {
    try {
      const { workdir } = req.body;
      if (!workdir) {
        return res.status(400).json({ error: 'workdir is required' });
      }
      const detected = await detectLibraries(workdir);
      res.json({ detected });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/component-libs/:libId/components — list components for a library
  router.get('/:libId/components', (req: Request, res: Response) => {
    try {
      const { libId } = req.params;
      const category = req.query.category as string | undefined;
      const search = req.query.search as string | undefined;
      const data = loadData();
      const lib = data.libraries.find((l: any) => l.id === libId);
      if (!lib) {
        return res.status(404).json({ error: 'Library not found' });
      }
      let components = lib.components;
      if (category) {
        components = components.filter((c: any) => c.category === category);
      }
      if (search) {
        const q = search.toLowerCase();
        components = components.filter(
          (c: any) =>
            c.name.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q)
        );
      }
      res.json({ library: { id: lib.id, name: lib.name }, components });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/component-libs/:libId/components/:componentId — component detail
  router.get('/:libId/components/:componentId', (req: Request, res: Response) => {
    try {
      const { libId, componentId } = req.params;
      const data = loadData();
      const lib = data.libraries.find((l: any) => l.id === libId);
      if (!lib) {
        return res.status(404).json({ error: 'Library not found' });
      }
      const component = lib.components.find((c: any) => c.id === componentId);
      if (!component) {
        return res.status(404).json({ error: 'Component not found' });
      }
      res.json({ library: { id: lib.id, name: lib.name }, component });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
