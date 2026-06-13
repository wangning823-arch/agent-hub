/**
 * 文件上传处理
 */
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

// SVG安全清理：移除危险元素和属性
function sanitizeSvg(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '');
}

// 上传目录
const UPLOAD_DIR: string = path.join(__dirname, '..', '..', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置存储
const storage = multer.diskStorage({
  destination: (req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const today = new Date().toISOString().split('T')[0];
    const userId = (req as any).user?.userId || 'anonymous';
    const dayDir = path.join(UPLOAD_DIR, userId, today);
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }
    cb(null, dayDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    // 修复中文文件名乱码：某些浏览器/客户端发送的 filename 用 latin1 编码了 UTF-8 字节
    let originalName = file.originalname;
    try {
      // 检测是否是 latin1 编码的 UTF-8 字节（包含高位字节）
      const hasHighBytes = /[^\x00-\x7F]/.test(originalName);
      if (hasHighBytes) {
        // 尝试用 latin1 解码再用 utf8 编码，修复乱码
        const fixed = Buffer.from(originalName, 'latin1').toString('utf8');
        // 验证修复后的字符串是否包含合理的 Unicode 字符（不是替换字符）
        if (!fixed.includes('�') && fixed.length > 0) {
          originalName = fixed;
        }
      }
    } catch {
      // 解码失败，使用原始文件名
    }
    // 生成唯一文件名
    const ext = path.extname(originalName);
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
    'text/plain', 'text/css', 'text/javascript',
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

    const uploadedFiles: UploadedFile[] = (req.files as Express.Multer.File[]).map(file => {
      // SVG安全清理
      if (file.mimetype === 'image/svg+xml') {
        try {
          const content = fs.readFileSync(file.path, 'utf-8');
          fs.writeFileSync(file.path, sanitizeSvg(content), 'utf-8');
        } catch {}
      }
      const relPath = path.relative(UPLOAD_DIR, file.path);
      // 修复中文文件名乱码
      let originalName = file.originalname;
      try {
        const hasHighBytes = /[^\x00-\x7F]/.test(originalName);
        if (hasHighBytes) {
          const fixed = Buffer.from(originalName, 'latin1').toString('utf8');
          if (!fixed.includes('�') && fixed.length > 0) {
            originalName = fixed;
          }
        }
      } catch {}
      return {
        id: uuidv4(),
        originalName,
        filename: file.filename,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype,
        url: `/uploads/${relPath.replace(/\\/g, '/')}`,
        uploadedAt: new Date().toISOString()
      };
    });

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
    const userId = (req as any).user?.userId || 'anonymous';
    const dayDir = path.join(UPLOAD_DIR, userId, today);
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
      url: `/uploads/${userId}/${today}/${filename}`,
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
