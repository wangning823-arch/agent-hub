import { Router, Request, Response } from 'express';
import { getDb, saveToFile } from '../db';
import * as fs from 'fs';
import * as path from 'path';

const BUILTIN_TEMPLATES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'prompt-templates.json');

function loadBuiltinTemplates(): any[] {
  try {
    if (fs.existsSync(BUILTIN_TEMPLATES_PATH)) {
      const data = JSON.parse(fs.readFileSync(BUILTIN_TEMPLATES_PATH, 'utf8'));
      return (data.templates || []).map((t: any) => ({
        ...t,
        is_builtin: true,
        owner_id: null,
        usage_count: 0,
      }));
    }
  } catch (e) {
    console.warn('[PromptTemplates] 加载内置模板失败:', e);
  }
  return [];
}

export default () => {
  const router = Router();

  // GET / - 获取所有模板（内置 + 用户自定义），支持 category 和 search 筛选
  router.get('/', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { category, search } = req.query;

      // 从数据库读取用户自定义模板
      let sql = 'SELECT * FROM prompt_templates WHERE 1=1';
      const params: any[] = [];

      if (category && typeof category === 'string') {
        sql += ' AND category = ?';
        params.push(category);
      }

      if (search && typeof search === 'string') {
        const searchTerm = `%${search}%`;
        sql += ' AND (name LIKE ? OR description LIKE ? OR content LIKE ?)';
        params.push(searchTerm, searchTerm, searchTerm);
      }

      sql += ' ORDER BY usage_count DESC, created_at DESC';

      const result = params.length > 0 ? (db as any).exec(sql, params) : db.exec(sql);
      const userTemplates: any[] = result.length > 0 ? result[0].values.map((row: any[]) => ({
        id: row[0],
        name: row[1],
        description: row[2],
        category: row[3],
        content: row[4],
        is_builtin: false,
        owner_id: row[5],
        created_at: row[6],
        updated_at: row[7],
        usage_count: row[8] || 0,
      })) : [];

      // 从 JSON 加载内置模板
      let builtinTemplates = loadBuiltinTemplates();

      // 应用筛选到内置模板
      if (category && typeof category === 'string') {
        builtinTemplates = builtinTemplates.filter((t: any) => t.category === category);
      }
      if (search && typeof search === 'string') {
        const lowerSearch = (search as string).toLowerCase();
        builtinTemplates = builtinTemplates.filter((t: any) =>
          t.name.toLowerCase().includes(lowerSearch) ||
          t.description.toLowerCase().includes(lowerSearch) ||
          t.content.toLowerCase().includes(lowerSearch)
        );
      }

      // 合并：内置模板 + 用户模板
      const allTemplates = [...builtinTemplates, ...userTemplates];

      res.json({ templates: allTemplates });
    } catch (error: any) {
      console.error('[PromptTemplates] GET / error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST / - 创建自定义模板
  router.post('/', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { name, description = '', category = 'general', content } = req.body;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: '模板名称是必需的' });
      }

      if (!content || typeof content !== 'string' || content.trim() === '') {
        return res.status(400).json({ error: '模板内容是必需的' });
      }

      const id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const ownerId = req.user?.userId || null;
      const now = Date.now();

      const stmt = db.prepare(
        'INSERT INTO prompt_templates (id, name, description, category, content, is_builtin, owner_id, created_at, updated_at, usage_count) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0)'
      );
      stmt.run([id, name.trim(), description.trim(), category, content.trim(), ownerId, now, now]);
      stmt.free();
      saveToFile();

      const template = {
        id,
        name: name.trim(),
        description: description.trim(),
        category,
        content: content.trim(),
        is_builtin: false,
        owner_id: ownerId,
        created_at: now,
        updated_at: now,
        usage_count: 0,
      };

      res.status(201).json({ template });
    } catch (error: any) {
      console.error('[PromptTemplates] POST / error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /:id - 更新模板（只能更新非内置的）
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const { name, description, category, content } = req.body;

      // 检查是否为内置模板
      const builtinTemplates = loadBuiltinTemplates();
      if (builtinTemplates.some((t: any) => t.id === id)) {
        return res.status(403).json({ error: '不能修改内置模板' });
      }

      // 查询现有模板
      const result = (db as any).exec('SELECT * FROM prompt_templates WHERE id = ?', [id]);
      if (result.length === 0 || result[0].values.length === 0) {
        return res.status(404).json({ error: '模板不存在' });
      }
      const row = result[0].values[0];
      const existing = {
        id: row[0],
        name: row[1],
        description: row[2],
        category: row[3],
        content: row[4],
        is_builtin: row[5],
        owner_id: row[6],
        created_at: row[7],
        updated_at: row[8],
        usage_count: row[9],
      };

      const updatedName = (name !== undefined ? name : existing.name) as string;
      const updatedDescription = (description !== undefined ? description : existing.description) as string;
      const updatedCategory = (category !== undefined ? category : existing.category) as string;
      const updatedContent = (content !== undefined ? content : existing.content) as string;
      const now = Date.now();

      const updateStmt = db.prepare(
        'UPDATE prompt_templates SET name = ?, description = ?, category = ?, content = ?, updated_at = ? WHERE id = ?'
      );
      updateStmt.run([updatedName, updatedDescription, updatedCategory, updatedContent, now, id]);
      updateStmt.free();
      saveToFile();

      res.json({
        template: {
          id,
          name: updatedName,
          description: updatedDescription,
          category: updatedCategory,
          content: updatedContent,
          is_builtin: false,
          owner_id: existing.owner_id,
          created_at: existing.created_at,
          updated_at: now,
          usage_count: existing.usage_count || 0,
        },
      });
    } catch (error: any) {
      console.error('[PromptTemplates] PUT /:id error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /:id - 删除模板（只能删除非内置的）
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { id } = req.params;

      // 检查是否为内置模板
      const builtinTemplates = loadBuiltinTemplates();
      if (builtinTemplates.some((t: any) => t.id === id)) {
        return res.status(403).json({ error: '不能删除内置模板' });
      }

      const stmt = db.prepare('DELETE FROM prompt_templates WHERE id = ?');
      stmt.run([id]);
      stmt.free();
      saveToFile();

      res.json({ success: true });
    } catch (error: any) {
      console.error('[PromptTemplates] DELETE /:id error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /:id/use - 使用次数 +1
  router.post('/:id/use', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { id } = req.params;

      // 先检查模板是否存在（内置或用户）
      const builtinTemplates = loadBuiltinTemplates();
      const isBuiltin = builtinTemplates.some((t: any) => t.id === id);

      if (isBuiltin) {
        // 内置模板不在数据库中，只需返回成功
        // 如果想持久化内置模板的使用次数，可以插入一条记录
        const stmt = db.prepare(
          `INSERT INTO prompt_templates (id, name, description, category, content, is_builtin, owner_id, created_at, updated_at, usage_count)
           SELECT ?, name, description, category, content, 1, NULL, 0, 0, 1
           FROM (SELECT 1) -- placeholder
           WHERE NOT EXISTS (SELECT 1 FROM prompt_templates WHERE id = ?)`
        );
        // 简化：直接 upsert 内置模板的使用记录
        const builtin = builtinTemplates.find((t: any) => t.id === id);
        if (builtin) {
          const upsertStmt = db.prepare(
            `INSERT OR REPLACE INTO prompt_templates (id, name, description, category, content, is_builtin, owner_id, created_at, updated_at, usage_count)
             VALUES (?, ?, ?, ?, ?, 1, NULL,
               COALESCE((SELECT created_at FROM prompt_templates WHERE id = ?), 0),
               ?,
               COALESCE((SELECT usage_count FROM prompt_templates WHERE id = ?), 0) + 1)`
          );
          const now = Date.now();
          upsertStmt.run([id, builtin.name, builtin.description, builtin.category, builtin.content, id, now, id]);
          upsertStmt.free();
          saveToFile();
        }
        stmt.free();
      } else {
        // 用户模板，直接更新
        const updateStmt = db.prepare(
          'UPDATE prompt_templates SET usage_count = usage_count + 1 WHERE id = ?'
        );
        updateStmt.run([id]);
        updateStmt.free();
        saveToFile();
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('[PromptTemplates] POST /:id/use error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
