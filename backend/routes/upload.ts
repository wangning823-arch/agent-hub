import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
const { upload, handleUpload, handlePasteImage, UPLOAD_DIR } = require('../upload');

export default () => {
  const router = Router();

  router.post('/', upload.array('files', 5), handleUpload);

  router.post('/paste', handlePasteImage);

  router.get('/', (req: Request, res: Response) => {
    try {
      const files: any[] = []; // TODO: type this
      const isAdmin = req.user?.role === 'admin';
      const userId = req.user?.userId;

      if (fs.existsSync(UPLOAD_DIR)) {
        const dates = fs.readdirSync(UPLOAD_DIR);
        for (const date of dates) {
          const dateDir = path.join(UPLOAD_DIR, date);
          if (fs.statSync(dateDir).isDirectory()) {
            // 按用户ID过滤：非admin用户只能查看自己的文件
            if (!isAdmin && userId) {
              const userDir = path.join(dateDir, userId);
              if (!fs.existsSync(userDir)) continue;
              const items = fs.readdirSync(userDir);
              for (const item of items) {
                const filePath = path.join(userDir, item);
                const stat = fs.statSync(filePath);
                files.push({
                  name: item,
                  path: filePath,
                  url: `/uploads/${date}/${userId}/${item}`,
                  size: stat.size,
                  date,
                  modifiedAt: stat.mtime
                });
              }
            } else {
              // admin用户可以查看所有文件
              const userDirs = fs.readdirSync(dateDir);
              for (const userDirName of userDirs) {
                const userDir = path.join(dateDir, userDirName);
                if (!fs.statSync(userDir).isDirectory()) continue;
                const items = fs.readdirSync(userDir);
                for (const item of items) {
                  const filePath = path.join(userDir, item);
                  const stat = fs.statSync(filePath);
                  files.push({
                    name: item,
                    path: filePath,
                    url: `/uploads/${date}/${userDirName}/${item}`,
                    size: stat.size,
                    date,
                    modifiedAt: stat.mtime
                  });
                }
              }
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
