/**
 * 文件上传处理
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 上传目录
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 按日期组织文件夹
    const today = new Date().toISOString().split('T')[0];
    const dayDir = path.join(UPLOAD_DIR, today);
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }
    cb(null, dayDir);
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// 文件过滤
const fileFilter = (req, file, cb) => {
  // 允许的文件类型
  const allowedMimes = [
    // 图片
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    // 文本/代码
    'text/plain', 'text/html', 'text/css', 'text/javascript',
    'application/json', 'application/xml',
    'application/javascript',
    // 文档
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // 压缩包
    'application/zip', 'application/x-rar-compressed',
    // 其他
    'application/octet-stream'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
};

// 创建multer实例
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB限制
    files: 5 // 最多5个文件
  }
});

/**
 * 上传文件
 */
function handleUpload(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '没有文件被上传' });
    }

    const uploadedFiles = req.files.map(file => ({
      id: uuidv4(),
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      url: `/uploads/${path.basename(path.dirname(file.path))}/${file.filename}`,
      uploadedAt: new Date().toISOString()
    }));

    res.json({
      success: true,
      files: uploadedFiles
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * 处理剪切板粘贴的base64图片
 */
function handlePasteImage(req, res) {
  try {
    const { data, type, name } = req.body;
    
    if (!data || !type) {
      return res.status(400).json({ error: '缺少data或type参数' });
    }

    // 解析base64数据
    const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: '无效的base64格式' });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 确定文件扩展名
    const ext = mimeType.split('/')[1] || 'png';
    const filename = `${uuidv4()}.${ext}`;

    // 保存文件
    const today = new Date().toISOString().split('T')[0];
    const dayDir = path.join(UPLOAD_DIR, today);
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }

    const filePath = path.join(dayDir, filename);
    fs.writeFileSync(filePath, buffer);

    const fileInfo = {
      id: uuidv4(),
      originalName: name || `pasted-image.${ext}`,
      filename,
      path: filePath,
      size: buffer.length,
      mimetype: mimeType,
      url: `/uploads/${today}/${filename}`,
      uploadedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      file: fileInfo
    });
  } catch (error) {
    console.error('处理粘贴图片失败:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  upload,
  handleUpload,
  handlePasteImage,
  UPLOAD_DIR
};
