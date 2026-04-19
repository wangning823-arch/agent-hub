const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

module.exports = (ALLOWED_ROOT) => {
  router.get('/', (req, res) => {
    const dirPath = req.query.path;
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
        let size = null;
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
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/content', (req, res) => {
    const filePath = req.query.path;
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
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/content', (req, res) => {
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
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};