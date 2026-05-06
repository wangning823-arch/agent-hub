/**
 * 设计规范路由 - 管理用户的设计规范配置
 */
import { Router, Request, Response } from 'express';
import { getDb, saveToFile } from '../db';

const DEFAULT_SPEC = {
  ui_library: 'tailwind',
  design_style: 'modern',
  primary_color: '#6366f1',
  border_radius: 'medium',
  font_family: 'system',
  font_size: 'medium',
  spacing: 'normal',
  dark_mode: 1,
  animations: 1,
  custom_css: '',
};

function generateId(): string {
  return `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function rowToSpec(row: any[]): Record<string, any> {
  return {
    id: row[0],
    name: row[1],
    owner_id: row[2],
    ui_library: row[3],
    design_style: row[4],
    primary_color: row[5],
    border_radius: row[6],
    font_family: row[7],
    font_size: row[8],
    spacing: row[9],
    dark_mode: row[10],
    animations: row[11],
    custom_css: row[12],
    created_at: row[13],
    updated_at: row[14],
  };
}

export default () => {
  const router = Router();

  // GET /api/design-specs - 获取当前用户的设计规范
  router.get('/', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user?.userId;

      if (!userId) {
        return res.json({ spec: { id: null, ...DEFAULT_SPEC } });
      }

      const safeUserId = userId.replace(/'/g, "''");
      const result = db.exec(
        `SELECT id, name, owner_id, ui_library, design_style, primary_color,
                border_radius, font_family, font_size, spacing, dark_mode,
                animations, custom_css, created_at, updated_at
         FROM design_specs WHERE owner_id = '${safeUserId}' LIMIT 1`
      );

      if (result.length > 0 && result[0].values.length > 0) {
        const spec = rowToSpec(result[0].values[0]);
        return res.json({ spec });
      }

      // 返回默认值
      res.json({ spec: { id: null, name: 'My Design Spec', owner_id: userId, ...DEFAULT_SPEC } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/design-specs - 更新设计规范（upsert）
  router.put('/', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ error: '未登录' });
      }

      const {
        name, ui_library, design_style, primary_color, border_radius,
        font_family, font_size, spacing, dark_mode, animations, custom_css
      } = req.body;

      const safeUserId = userId.replace(/'/g, "''");
      const now = Date.now();

      // 查找是否已有
      const existing = db.exec(
        `SELECT id FROM design_specs WHERE owner_id = '${safeUserId}' LIMIT 1`
      );

      if (existing.length > 0 && existing[0].values.length > 0) {
        // UPDATE
        const id = existing[0].values[0][0] as string;
        const safeId = id.replace(/'/g, "''");
        db.run(
          `UPDATE design_specs SET
            name = COALESCE(?, name),
            ui_library = COALESCE(?, ui_library),
            design_style = COALESCE(?, design_style),
            primary_color = COALESCE(?, primary_color),
            border_radius = COALESCE(?, border_radius),
            font_family = COALESCE(?, font_family),
            font_size = COALESCE(?, font_size),
            spacing = COALESCE(?, spacing),
            dark_mode = COALESCE(?, dark_mode),
            animations = COALESCE(?, animations),
            custom_css = COALESCE(?, custom_css),
            updated_at = ?
          WHERE id = '${safeId}'`,
          [
            name ?? null, ui_library ?? null, design_style ?? null,
            primary_color ?? null, border_radius ?? null, font_family ?? null,
            font_size ?? null, spacing ?? null, dark_mode ?? null,
            animations ?? null, custom_css ?? null, now
          ]
        );
        saveToFile();

        const result = db.exec(
          `SELECT id, name, owner_id, ui_library, design_style, primary_color,
                  border_radius, font_family, font_size, spacing, dark_mode,
                  animations, custom_css, created_at, updated_at
           FROM design_specs WHERE id = '${safeId}'`
        );
        const spec = rowToSpec(result[0].values[0]);
        return res.json({ success: true, spec });
      }

      // INSERT
      const id = generateId();
      db.run(
        `INSERT INTO design_specs (id, name, owner_id, ui_library, design_style, primary_color,
          border_radius, font_family, font_size, spacing, dark_mode, animations, custom_css,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name || 'My Design Spec',
          userId,
          ui_library || DEFAULT_SPEC.ui_library,
          design_style || DEFAULT_SPEC.design_style,
          primary_color || DEFAULT_SPEC.primary_color,
          border_radius || DEFAULT_SPEC.border_radius,
          font_family || DEFAULT_SPEC.font_family,
          font_size || DEFAULT_SPEC.font_size,
          spacing || DEFAULT_SPEC.spacing,
          dark_mode ?? DEFAULT_SPEC.dark_mode,
          animations ?? DEFAULT_SPEC.animations,
          custom_css || DEFAULT_SPEC.custom_css,
          now,
          now
        ]
      );
      saveToFile();

      const result = db.exec(
        `SELECT id, name, owner_id, ui_library, design_style, primary_color,
                border_radius, font_family, font_size, spacing, dark_mode,
                animations, custom_css, created_at, updated_at
         FROM design_specs WHERE id = '${id.replace(/'/g, "''")}'`
      );
      const spec = rowToSpec(result[0].values[0]);
      res.json({ success: true, spec });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/design-specs/apply - 生成 system prompt 片段
  router.post('/apply', (req: Request, res: Response) => {
    try {
      const { spec } = req.body;
      if (!spec) {
        return res.status(400).json({ error: 'spec是必需的' });
      }

      const radiusMap: Record<string, string> = {
        none: '0px', small: '4px', medium: '8px', large: '16px', full: '9999px'
      };
      const fontSizeMap: Record<string, string> = {
        small: '14px', medium: '16px', large: '18px'
      };
      const spacingMap: Record<string, string> = {
        compact: '0.5rem', normal: '1rem', spacious: '1.5rem'
      };
      const fontFamilyMap: Record<string, string> = {
        system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        inter: '"Inter", sans-serif',
        roboto: '"Roboto", sans-serif',
        'noto-sans': '"Noto Sans SC", sans-serif',
        custom: spec.custom_font || 'inherit'
      };

      const lines: string[] = [
        '## Design Specifications',
        '',
        `UI Library: ${spec.ui_library || 'tailwind'}`,
        `Design Style: ${spec.design_style || 'modern'}`,
        `Primary Color: ${spec.primary_color || '#6366f1'}`,
        `Border Radius: ${spec.border_radius || 'medium'} (${radiusMap[spec.border_radius || 'medium']})`,
        `Font Family: ${spec.font_family || 'system'}`,
        `Font Size: ${spec.font_size || 'medium'} (${fontSizeMap[spec.font_size || 'medium']})`,
        `Spacing: ${spec.spacing || 'normal'} (${spacingMap[spec.spacing || 'normal']})`,
        `Dark Mode: ${spec.dark_mode ? 'enabled' : 'disabled'}`,
        `Animations: ${spec.animations ? 'enabled' : 'disabled'}`,
        '',
        '### CSS Variables',
        `--primary-color: ${spec.primary_color || '#6366f1'};`,
        `--border-radius: ${radiusMap[spec.border_radius || 'medium']};`,
        `--font-size: ${fontSizeMap[spec.font_size || 'medium']};`,
        `--spacing: ${spacingMap[spec.spacing || 'normal']};`,
        `--font-family: ${fontFamilyMap[spec.font_family || 'system']};`,
      ];

      if (spec.ui_library === 'tailwind') {
        lines.push('', 'Use Tailwind CSS classes. Apply the primary color via utility classes.');
      } else if (spec.ui_library === 'antd') {
        lines.push('', 'Use Ant Design components (antd). Configure theme with the primary color.');
      } else if (spec.ui_library === 'mui') {
        lines.push('', 'Use Material UI components (@mui/material). Apply custom theme.');
      } else if (spec.ui_library === 'chakra') {
        lines.push('', 'Use Chakra UI components (@chakra-ui/react). Apply custom theme tokens.');
      }

      if (spec.custom_css) {
        lines.push('', '### Custom CSS', '```css', spec.custom_css, '```');
      }

      const prompt = lines.join('\n');
      res.json({ success: true, prompt });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
