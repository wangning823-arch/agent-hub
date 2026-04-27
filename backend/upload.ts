/**
 * 文件上传处理
 */
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

// 上传目录
const UPLOAD_DIR: string = path.join(__dirname, '..', '..', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置存储
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    // 按日期组织文件夹
    const today = new Date().toISOString().split('T')[0];
    const dayDir = path.join(UPLOAD_DIR, today);
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }
    cb(null, dayDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    // 生成唯一文件名
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// 文件过滤
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback): void => {
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
    cb(new Error(`不支持的文件类型: ${file.mimetype}`));
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

interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  url: string;
  uploadedAt: string;
}

/**
 * 上传文件
 */
function handleUpload(req: Request, res: Response): void {
  try {
    if (!req.files || req.files.length === 0) {
      res.status(400).json({ error: '没有文件被上传' });
      return;
    }

    const uploadedFiles: UploadedFile[] = (req.files as Express.Multer.File[]).map(file => ({
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
  } catch (error: any) {
    console.error('文件上传失败:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * 处理剪切板粘贴的base64图片
 */
function handlePasteImage(req: Request, res: Response): void {
  try {
    const { data, type, name } = req.body as { data?: string; type?: string; name?: string };

    if (!data || !type) {
      res.status(400).json({ error: '缺少data或type参数' });
      return;
    }

    // 解析base64数据
    const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      res.status(400).json({ error: '无效的base64格式' });
      return;
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

    const fileInfo: UploadedFile = {
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
  } catch (error: any) {
    console.error('处理粘贴图片失败:', error);
    res.status(500).json({ error: error.message });
  }
}

export { upload, handleUpload, handlePasteImage, UPLOAD_DIR };
