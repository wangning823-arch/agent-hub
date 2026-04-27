import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
const { upload, handleUpload, handlePasteImage, UPLOAD_DIR } = require('../upload');

export default () => {
  const router = Router();

  router.post('/', upload.array('files', 5), handleUpload);

  router.post('/paste', handlePasteImage);

  router.get('/', (_req: Request, res: Response) => {
    try {
      const files: any[] = []; // TODO: type this
      if (fs.existsSync(UPLOAD_DIR)) {
        const dates = fs.readdirSync(UPLOAD_DIR);
        for (const date of dates) {
          const dateDir = path.join(UPLOAD_DIR, date);
          if (fs.statSync(dateDir).isDirectory()) {
            const items = fs.readdirSync(dateDir);
            for (const item of items) {
              const filePath = path.join(dateDir, item);
              const stat = fs.statSync(filePath);
              files.push({
                name: item,
                path: filePath,
                url: `/uploads/${date}/${item}`,
                size: stat.size,
                date,
                modifiedAt: stat.mtime
              });
            }
          }
        }
      }

      files.sort((a: any, b: any) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
      res.json({ files: files.slice(0, 50) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
