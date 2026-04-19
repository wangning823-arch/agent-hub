const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { upload, handleUpload, handlePasteImage, UPLOAD_DIR } = require('../upload');

module.exports = () => {
  router.post('/', upload.array('files', 5), handleUpload);

  router.post('/paste', handlePasteImage);

  router.get('/', (req, res) => {
    try {
      const files = [];
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

      files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
      res.json({ files: files.slice(0, 50) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};