/**
 * Skills Registry - 管理各 Agent 的 Skills 列表和安装
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { AgentType } from './types';

const HOME: string = process.env.HOME || '/root';

interface SkillItem {
  id: string;
  name: string;
  description: string;
  version?: string;
  path?: string;
  relativePath?: string;
  source?: string;
  plugin?: string;
}

/**
 * Skill 描述翻译表
 */
const skillDescriptionTranslations: Record<string, string> = {
  // Claude 官方插件 Skills
  'agent-sdk-dev': '开发 AI Agent SDK 应用',
  'clangd-lsp': 'C/C++ 语言服务支持',
  'claude-automation-recommender': '分析代码库并推荐 Claude Code 自动化配置',
  'claude-code-setup': '快速配置 Claude Code 项目',
  'claude-md-improver': '审查和改进 CLAUDE.md 文件',
  'claude-md-management': '管理 CLAUDE.md 项目配置文档',
  'code-review': '审查代码变更，提供改进建议',
  'code-simplifier': '简化复杂代码，提升可读性',
  'commit-commands': '生成规范的 Git 提交信息',
  'csharp-lsp': 'C# 语言服务支持',
  'explanatory-output-style': '提供详细解释的输出风格',
  'feature-dev': '开发新功能和特性',
  'frontend-design': '设计前端界面和组件',
  'gopls-lsp': 'Go 语言服务支持',
  'hookify': '配置 Claude Code 钩子脚本',
  'jdtls-lsp': 'Java 语言服务支持',
  'kotlin-lsp': 'Kotlin 语言服务支持',
  'learning-output-style': '适合学习理解的输出风格',
  'lua-lsp': 'Lua 语言服务支持',
  'math-olympiad': '解决数学竞赛问题',
  'mcp-server-dev': '开发 MCP 服务器',
  'php-lsp': 'PHP 语言服务支持',
  'playground': '创建交互式 HTML 演示工具',
  'plugin-dev': '开发 Claude Code 插件',
  'pr-review-toolkit': '全面的 PR 审查工具集',
  'pyright-lsp': 'Python 语言服务支持',
  'ralph-loop': '自动化循环任务执行',
  'ruby-lsp': 'Ruby 语言服务支持',
  'rust-analyzer-lsp': 'Rust 语言服务支持',
  'security-guidance': '安全编码指导和检查',
  'session-report': '生成会话工作报告',
  'skill-creator': '创建自定义 Skill 技能',
  'swift-lsp': 'Swift 语言服务支持',
  'typescript-lsp': 'TypeScript 语言服务支持',
  // 外部插件 Skills
  'access': '管理渠道访问权限，审批配对，编辑白名单',
  'configure': '配置消息渠道，设置机器人令牌和访问策略',
  // Plugin Dev 子技能
  'agent-development': '开发 Claude Code 子代理，定义系统提示和触发条件',
  'command-development': '创建自定义斜杠命令',
  'hook-development': '开发 Claude Code 钩子脚本',
  'mcp-integration': '集成 MCP 服务器到插件',
  'plugin-settings': '管理插件配置和设置',
  'plugin-structure': '创建和组织 Claude Code 插件结构',
  'skill-development': '开发和优化技能',
  'writing-rules': '编写 Hookify 规则',
  // MCP Server Dev 子技能
  'build-mcp-app': '构建带交互式 UI 的 MCP 应用',
  'build-mcpb': '打包和分发 MCP 服务器',
  'build-mcp-server': '创建 MCP 服务器和工具',
  // 通用命令
  'debug': '帮助调试代码问题',
  'explain': '解释代码逻辑和功能',
  'refactor': '重构代码，改善可读性和性能',
  'test': '编写测试用例',
  'docs': '编写项目文档',
  'security': '安全审查代码',
  'deploy': '部署应用到生产环境',
  'migrate': '迁移数据库或代码库',
  'optimize': '优化代码性能和资源使用',
  // 示例插件
  'example-command': '示例用户调用技能，演示 frontmatter 选项',
  'example-skill': '示例技能模板，用于演示技能格式',
};

/**
 * 获取翻译后的描述
 */
function getTranslatedDescription(skill: SkillItem): string {
  const key = skill.id?.toLowerCase() || skill.name?.toLowerCase() || '';
  return skillDescriptionTranslations[key] || skill.description || '';
}

/**
 * 解析 YAML frontmatter
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split('\n');
  let currentKey: string | null = null;
  let currentValue = '';

  for (const line of lines) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      if (currentKey) {
        frontmatter[currentKey] = currentValue.trim();
      }
      currentKey = kvMatch[1];
      currentValue = kvMatch[2];
    } else if (line.match(/^\s+/)) {
      currentValue += '\n' + line;
    }
  }
  if (currentKey) {
    frontmatter[currentKey] = currentValue.trim();
  }

  return frontmatter;
}

/**
 * 扫描目录获取 Skills 列表
 */
function scanSkillsDir(dirPath: string, basePath: string = ''): SkillItem[] {
  const skills: SkillItem[] = [];

  if (!fs.existsSync(dirPath)) return skills;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const skillPath = path.join(fullPath, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          try {
            const content = fs.readFileSync(skillPath, 'utf-8');
            const fm = parseFrontmatter(content);

            const skill: SkillItem = {
              id: entry.name,
              name: fm.name || entry.name,
              description: fm.description || '',
              version: fm.version || '',
              path: skillPath,
              relativePath: basePath ? `${basePath}/${entry.name}` : entry.name
            };
            skill.description = getTranslatedDescription(skill);
            skills.push(skill);
          } catch (e: any) {
            console.warn(`读取 SKILL.md 失败: ${skillPath}`, e.message);
          }
        }

        // 递归扫描子目录
        const subSkills = scanSkillsDir(fullPath, basePath ? `${basePath}/${entry.name}` : entry.name);
        skills.push(...subSkills);
      }
    }
  } catch (e: any) {
    console.warn(`扫描目录失败: ${dirPath}`, e.message);
  }

  return skills;
}

/**
 * Claude Code Skills - 从官方 marketplace 和本地安装扫描
 */
function loadClaudeCodeSkills(): SkillItem[] {
  const skills: SkillItem[] = [];

  // 1. 官方 marketplace
  const officialMarketplace = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins');
  if (fs.existsSync(officialMarketplace)) {
    try {
      const plugins = fs.readdirSync(officialMarketplace);
      for (const plugin of plugins) {
        const skillsDir = path.join(officialMarketplace, plugin, 'skills');
        const pluginSkills = scanSkillsDir(skillsDir, `official/${plugin}`);
        skills.push(...pluginSkills.map(s => ({ ...s, source: 'official', plugin })));
      }
    } catch (e: any) {
      console.warn('扫描官方 marketplace 失败:', e.message);
    }
  }

  // 2. 用户安装的 plugins
  const userPluginsDir = path.join(HOME, '.claude', 'plugins', 'installed');
  if (fs.existsSync(userPluginsDir)) {
    try {
      const entries = fs.readdirSync(userPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillsDir = path.join(userPluginsDir, entry.name, 'skills');
          const userSkills = scanSkillsDir(skillsDir, `installed/${entry.name}`);
          skills.push(...userSkills.map(s => ({ ...s, source: 'installed', plugin: entry.name })));
        }
      }
    } catch (e: any) {
      console.warn('扫描用户 plugins 失败:', e.message);
    }
  }

  // 3. 本地 skills 目录
  const localSkillsDir = path.join(HOME, '.claude', 'skills');
  const localSkills = scanSkillsDir(localSkillsDir, 'local');
  skills.push(...localSkills.map(s => ({ ...s, source: 'local' })));

  return skills;
}

/**
 * OpenCode Plugins - 从配置文件读取
 */
function loadOpenCodePlugins(): SkillItem[] {
  const plugins: SkillItem[] = [];

  const configPaths = [
    path.join(HOME, '.config', 'opencode', 'opencode.json'),
    path.join(HOME, '.opencode', 'opencode.json')
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        // 读取 plugin 数组
        const pluginList = config.plugin || config.plugins || [];
        for (const p of pluginList) {
          plugins.push({
            id: typeof p === 'string' ? p : p.name || p,
            name: typeof p === 'string' ? p : p.name || p,
            description: typeof p === 'object' ? (p.description || '') : '',
            source: 'config'
          });
        }
      } catch (e: any) {
        console.warn('读取 OpenCode 配置失败:', configPath, e.message);
      }
    }
  }

  // 扫描本地 plugin 目录
  const localPluginsDir = path.join(HOME, '.config', 'opencode', 'plugins');
  if (fs.existsSync(localPluginsDir)) {
    try {
      const files = fs.readdirSync(localPluginsDir);
      for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.js')) {
          const pluginPath = path.join(localPluginsDir, file);
          const content = fs.readFileSync(pluginPath, 'utf-8');

          // 简单解析 plugin 名称
          const nameMatch = content.match(/export\s+const\s+(\w+Plugin):/);
          plugins.push({
            id: file.replace(/\.(ts|js)$/, ''),
            name: nameMatch ? nameMatch[1] : file,
            description: '本地插件',
            source: 'local',
            path: pluginPath
          });
        }
      }
    } catch (e: any) {
      console.warn('扫描 OpenCode 本地插件失败:', e.message);
    }
  }

  return plugins;
}

/**
 * Codex - 有限的扩展能力
 */
function loadCodexExtensions(): SkillItem[] {
  return [
    {
      id: 'code-review',
      name: 'Code Review',
      description: '代码审查工具',
      source: 'built-in'
    }
  ];
}

/**
 * 获取指定 Agent 类型的 Skills
 */
function getSkillsForAgent(agentType: AgentType): SkillItem[] {
  let skills: SkillItem[];
  switch (agentType) {
    case 'claude-code':
      skills = loadClaudeCodeSkills();
      break;
    case 'opencode':
      skills = loadOpenCodePlugins();
      break;
    case 'codex':
      skills = loadCodexExtensions();
      break;
    default:
      skills = [];
  }
  // 应用翻译
  return skills.map(skill => ({
    ...skill,
    description: getTranslatedDescription(skill)
  }));
}

/**
 * 安装 Claude Code Skill/Plugin
 */
async function installClaudeSkill(source: string, options: { scope?: string } = {}): Promise<{ success: boolean; output: string }> {
  const { scope = 'user' } = options;

  return new Promise((resolve, reject) => {
    try {
      let cmd: string;

      if (source.includes('/') && !source.startsWith('http') && !source.startsWith('git@')) {
        // GitHub 格式
        cmd = `claude plugin marketplace add ${source} --scope ${scope}`;
      } else if (source.startsWith('http') || source.startsWith('git@') || source.startsWith('git://')) {
        // Git URL 或远程 URL
        cmd = `claude plugin marketplace add "${source}" --scope ${scope}`;
      } else {
        // 直接 plugin 名称
        cmd = `claude plugin install ${source} --scope ${scope}`;
      }

      console.log(`[Skills] 安装命令: ${cmd}`);
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
      resolve({ success: true, output });
    } catch (e: any) {
      reject(new Error(`安装失败: ${e.message}`));
    }
  });
}

/**
 * 安装 OpenCode Plugin
 */
async function installOpenCodePlugin(pluginName: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    try {
      const cmd = `opencode plugin ${pluginName}`;
      console.log(`[Skills] 安装命令: ${cmd}`);
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
      resolve({ success: true, output });
    } catch (e: any) {
      reject(new Error(`安装失败: ${e.message}`));
    }
  });
}

/**
 * 安装指定 Agent 类型的 Skill
 */
async function installSkill(agentType: AgentType, source: string, options: { scope?: string } = {}): Promise<{ success: boolean; output: string }> {
  switch (agentType) {
    case 'claude-code':
      return installClaudeSkill(source, options);
    case 'opencode':
      return installOpenCodePlugin(source);
    default:
      throw new Error(`不支持的 Agent 类型: ${agentType}`);
  }
}

/**
 * 卸载 Claude Code Plugin
 */
async function uninstallClaudePlugin(pluginName: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    try {
      const cmd = `claude plugin uninstall ${pluginName}`;
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
      resolve({ success: true, output });
    } catch (e: any) {
      reject(new Error(`卸载失败: ${e.message}`));
    }
  });
}

export {
  getSkillsForAgent,
  installSkill,
  uninstallClaudePlugin,
  scanSkillsDir,
  parseFrontmatter
};
