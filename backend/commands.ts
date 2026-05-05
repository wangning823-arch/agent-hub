/**
 * Claude Code 命令定义
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { AgentType } from './types';

interface CommandDef {
  id: string;
  name: string;
  description: string;
  category: string;
  usage: string;
}

interface ModeOption {
  id: string;
  name: string;
  description: string;
}

interface ModelOption {
  id: string;
  name: string;
  description: string;
  contextLimit?: number;
  free?: boolean;
}

interface EffortOption {
  id: string;
  name: string;
  description: string;
}

const CLAUDE_COMMANDS: CommandDef[] = [
  // 会话管理
  { id: 'compact', name: '/compact', description: '压缩上下文，减少token使用', category: '会话', usage: '/compact' },
  { id: 'continue', name: '/continue', description: '继续上次的对话', category: '会话', usage: '/continue' },
  { id: 'resume', name: '/resume', description: '恢复指定会话', category: '会话', usage: '/resume [session-id]' },
  // 代码审查
  { id: 'review', name: '/review', description: '审查代码变更', category: '审查', usage: '/review' },
  { id: 'security-review', name: '/security-review', description: '安全审查代码', category: '审查', usage: '/security-review' },
  // 开发工具
  { id: 'debug', name: '/debug', description: '调试当前问题', category: '开发', usage: '/debug' },
  { id: 'simplify', name: '/simplify', description: '简化代码', category: '开发', usage: '/simplify' },
  { id: 'init', name: '/init', description: '初始化项目配置', category: '开发', usage: '/init' },
  // 批处理
  { id: 'batch', name: '/batch', description: '批量执行任务', category: '批处理', usage: '/batch' },
  { id: 'loop', name: '/loop', description: '循环执行任务', category: '批处理', usage: '/loop' },
  // 配置
  { id: 'update-config', name: '/update-config', description: '更新配置', category: '配置', usage: '/update-config' },
  // 分析和洞察
  { id: 'insights', name: '/insights', description: '获取代码洞察', category: '分析', usage: '/insights' },
  { id: 'context', name: '/context', description: '查看当前上下文', category: '分析', usage: '/context' },
  { id: 'cost', name: '/cost', description: '查看API使用成本', category: '分析', usage: '/cost' },
  // 团队协作
  { id: 'team-onboarding', name: '/team-onboarding', description: '团队新人引导', category: '团队', usage: '/team-onboarding' },
  // 调试工具
  { id: 'heapdump', name: '/heapdump', description: '生成堆转储', category: '调试', usage: '/heapdump' }
];

// 模式选项 - Claude Code
const PERMISSION_MODES: ModeOption[] = [
  { id: 'default', name: '默认', description: '标准权限模式' },
  { id: 'auto', name: '自动', description: '自动批准安全操作' },
  { id: 'bypassPermissions', name: '跳过权限', description: '跳过所有权限检查（危险）' },
  { id: 'plan', name: '计划模式', description: '只生成计划，不执行' },
  { id: 'acceptEdits', name: '接受编辑', description: '自动接受文件编辑' },
  { id: 'dontAsk', name: '不询问', description: '不询问直接执行' }
];

// 模式选项 - OpenCode（agent 类型）
const OPENCODE_MODES: ModeOption[] = [
  { id: 'build', name: 'Build', description: '执行代码修改和构建任务' },
  { id: 'plan', name: 'Plan', description: '只生成计划，不执行修改' }
];

// 模式选项 - Codex
const CODEX_MODES: ModeOption[] = [
  { id: 'default', name: '默认', description: '标准模式' },
  { id: 'fullAuto', name: 'Full Auto', description: '自动批准所有变更' }
];

// 按 agentType 获取模式列表
function getModesForAgent(agentType: AgentType): ModeOption[] {
  switch (agentType) {
    case 'claude-code':
      return PERMISSION_MODES;
    case 'opencode':
      return OPENCODE_MODES;
    case 'codex':
      return CODEX_MODES;
    default:
      return PERMISSION_MODES;
  }
}

// Claude Code - 从配置文件读取模型，支持项目级配置
function loadClaudeModels(workdir?: string): ModelOption[] {
  // 优先读取项目级配置，读不到再读全局配置
  let settingsPath: string | undefined;
  if (workdir) {
    // 解析相对路径为绝对路径
    const resolvedWorkdir = path.isAbsolute(workdir)
      ? workdir
      : path.resolve(process.env.HOME || '/root', workdir);
    const projectSettingsPath = path.join(resolvedWorkdir, '.claude', 'settings.json');
    if (fs.existsSync(projectSettingsPath)) {
      settingsPath = projectSettingsPath;
    }
  }
  if (!settingsPath) {
    settingsPath = path.join(process.env.HOME || '/root', '.claude', 'settings.json');
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const env = settings.env || {};

    const modelIds = new Set<string>();
    const defaultModel = env.ANTHROPIC_MODEL;
    if (defaultModel) modelIds.add(defaultModel);
    if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) modelIds.add(env.ANTHROPIC_DEFAULT_SONNET_MODEL);
    if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) modelIds.add(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
    if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) modelIds.add(env.ANTHROPIC_DEFAULT_HAIKU_MODEL);

    const models: ModelOption[] = [];
    if (defaultModel) {
      models.push({ id: defaultModel, name: defaultModel, description: '当前默认模型' });
    }
    for (const id of modelIds) {
      if (id !== defaultModel) {
        models.push({ id, name: id, description: '' });
      }
    }

    // 从数据库合并 contextLimit
    try {
      const dbModule = require('./db');
      const db = dbModule.getDb();
      const result = db.exec('SELECT id, context_limit FROM models');
      if (result.length > 0) {
        const ctxMap: Record<string, number> = {};
        for (const row of result[0].values) {
          ctxMap[row[0] as string] = row[1] as number;
        }
        for (const m of models) {
          if (ctxMap[m.id]) m.contextLimit = ctxMap[m.id];
        }
      }
    } catch (_) {}

    if (models.length === 0) {
      return [{ id: 'claude-sonnet-4-6', name: 'Sonnet 4', description: '默认模型' }];
    }
    return models;
  } catch (e: any) {
    console.warn('读取 Claude 配置失败:', e.message);
    return [{ id: 'claude-sonnet-4-6', name: 'Sonnet 4', description: '默认模型' }];
  }
}

// OpenCode - 动态获取免费模型 + 配置文件中的模型
let _opencodeModelsCache: ModelOption[] | null = null;

function loadOpenCodeModels(): ModelOption[] {
  if (_opencodeModelsCache) return _opencodeModelsCache;
  const configPath = path.join(process.env.HOME || '/root', '.config', 'opencode', 'opencode.json');
  const models: ModelOption[] = [];
  const seen = new Set<string>();

  // 格式化上下文大小
  const formatCtx = (tokens: number): string => {
    if (!tokens) return '';
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
    return String(tokens);
  };

  // 1. 动态运行 opencode models --verbose 获取免费模型
  try {
    const opencodeBin = findOpencodeBin();
    const npmBinPath = getNpmBinPath();
    const output = execSync(`${opencodeBin} models --verbose`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      env: npmBinPath ? { ...process.env, PATH: npmBinPath + ':' + process.env.PATH } : process.env
    });

    // 输出是多组 "名称\n{JSON}" 格式，用大括号计数解析
    const lines = output.split('\n');
    let jsonStart = -1;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('{') && jsonStart === -1) {
        jsonStart = i;
        braceCount = 0;
      }
      if (jsonStart !== -1) {
        for (const ch of line) {
          if (ch === '{') braceCount++;
          if (ch === '}') braceCount--;
        }
        if (braceCount === 0) {
          const jsonStr = lines.slice(jsonStart, i + 1).join('\n');
          try {
            const model = JSON.parse(jsonStr);
            // 筛选免费模型：input 和 output cost 都为 0
            if (model.id && model.providerID && model.cost && model.cost.input === 0 && model.cost.output === 0) {
              const fullId = `${model.providerID}/${model.id}`;
              if (!seen.has(fullId)) {
                const ctx = formatCtx(model.limit?.context);
                const caps: string[] = [];
                if (model.capabilities?.reasoning) caps.push('推理');
                if (model.capabilities?.input?.image) caps.push('图像');
                models.push({
                  id: fullId,
                  name: model.name || model.id,
                  description: `免费${ctx ? ' · ' + ctx + ' ctx' : ''}${caps.length ? ' · ' + caps.join('/') : ''}`,
                  free: true
                });
                seen.add(fullId);
              }
            }
          } catch (e) { /* 忽略解析失败 */ }
          jsonStart = -1;
        }
      }
    }
    console.log(`[OpenCode] 动态读取到 ${models.length} 个免费模型`);
  } catch (e: any) {
    console.warn('[OpenCode] 动态读取模型失败，使用硬编码列表:', e.message);
    // 降级：硬编码的免费模型
    const fallback = [
      { id: 'opencode/gpt-5-nano', name: 'GPT-5 Nano', description: '免费 · 400K ctx · 推理', free: true },
      { id: 'opencode/big-pickle', name: 'Big Pickle', description: '免费 · 200K ctx · 推理', free: true },
      { id: 'opencode/minimax-m2.5-free', name: 'MiniMax M2.5 Free', description: '免费 · 204K ctx', free: true },
      { id: 'opencode/nemotron-3-super-free', name: 'Nemotron 3 Super Free', description: '免费 · 204K ctx', free: true },
    ];
    for (const m of fallback) {
      if (!seen.has(m.id)) {
        models.push(m);
        seen.add(m.id);
      }
    }
  }

  // 2. 从配置文件读取用户自定义的模型（bailian、mimo 等）
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const providers = config.provider || {};
    const defaultModel: string = config.model || '';

    // 默认模型优先显示
    if (defaultModel && !seen.has(defaultModel)) {
      const [providerName, ...modelParts] = defaultModel.split('/');
      const modelId = modelParts.join('/');
      const provider = providers[providerName];
      const modelInfo = provider?.models?.[modelId];
      models.unshift({
        id: defaultModel,
        name: modelInfo?.name || modelId,
        description: '当前默认模型'
      });
      seen.add(defaultModel);
    }

    // 其他配置的模型
    for (const [providerName, provider] of Object.entries(providers) as [string, any][]) {
      const providerModels = provider.models || {};
      for (const [modelId, modelInfo] of Object.entries(providerModels) as [string, any][]) {
        const fullId = `${providerName}/${modelId}`;
        if (!seen.has(fullId)) {
          models.push({
            id: fullId,
            name: modelInfo?.name || modelId,
            description: provider.name || providerName
          });
          seen.add(fullId);
        }
      }
    }
  } catch (e: any) {
    console.warn('[OpenCode] 读取配置文件失败:', e.message);
  }

  _opencodeModelsCache = models;
  return models;
}

// 查找 opencode 二进制路径
function findOpencodeBin(): string {
  const candidates = [
    path.join(process.env.HOME || '/root', '.npm-global/lib/node_modules/opencode-ai/bin/.opencode'),
    '/usr/local/lib/node_modules/opencode-ai/bin/.opencode',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync('which opencode 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch (e) {
    return 'opencode';
  }
}

// 获取 npm 全局 bin 路径
function getNpmBinPath(): string {
  try {
    const prefix = execSync('npm config get prefix', { encoding: 'utf-8' }).trim();
    return prefix + '/bin';
  } catch (e) {
    return '';
  }
}

// Codex - 从 ~/.codex/config.yaml 或环境变量读取
function loadCodexModels(): ModelOption[] {
  // Codex 通常使用 OPENAI_MODEL 环境变量
  const envModel = process.env.OPENAI_MODEL;
  const models: ModelOption[] = [];
  if (envModel) {
    models.push({ id: envModel, name: envModel, description: '环境变量默认模型' });
  }
  // Codex 支持的常见模型
  const defaults = ['o4-mini', 'o3', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini'];
  for (const m of defaults) {
    if (m !== envModel) {
      models.push({ id: m, name: m, description: '' });
    }
  }
  return models;
}

// 按 agentType 获取模型列表
function getModelsForAgent(agentType: AgentType, workdir?: string): ModelOption[] {
  switch (agentType) {
    case 'claude-code':
      return loadClaudeModels(workdir);
    case 'opencode':
      return loadOpenCodeModels();
    case 'codex':
      return loadCodexModels();
    default:
      return loadClaudeModels(workdir);
  }
}

// 向后兼容：默认加载 Claude 模型
const MODELS: ModelOption[] = loadClaudeModels();

// 努力程度选项 - Claude Code
const EFFORT_LEVELS: EffortOption[] = [
  { id: 'low', name: '低', description: '快速响应，节省token' },
  { id: 'medium', name: '中', description: '平衡速度和质量' },
  { id: 'high', name: '高', description: '更深入的思考' },
  { id: 'max', name: '最大', description: '最深入的分析' }
];

// 推理强度选项 - OpenCode
const OPENCODE_VARIANTS: EffortOption[] = [
  { id: 'minimal', name: '极简', description: '最快响应' },
  { id: 'high', name: '高', description: '深入推理' },
  { id: 'max', name: '最大', description: '最深入分析' }
];

// 按 agentType 获取努力程度列表
function getEffortsForAgent(agentType: AgentType): EffortOption[] {
  switch (agentType) {
    case 'claude-code':
      return EFFORT_LEVELS;
    case 'opencode':
      return OPENCODE_VARIANTS;
    case 'codex':
      return []; // Codex 没有努力程度选项
    default:
      return EFFORT_LEVELS;
  }
}

// OpenCode 命令定义
const OPENCODE_COMMANDS: CommandDef[] = [
  { id: 'continue', name: '继续上次', description: '继续上次的对话', category: '会话', usage: 'Continue from our last conversation' },
  { id: 'review', name: '代码审查', description: '审查当前代码变更', category: '审查', usage: 'Review the recent changes in this project' },
  { id: 'explain', name: '解释代码', description: '解释项目代码逻辑', category: '分析', usage: 'Explain the code in this project' },
  { id: 'refactor', name: '重构', description: '重构改善代码质量', category: '开发', usage: 'Refactor and improve code quality' },
  { id: 'test', name: '写测试', description: '为项目编写测试', category: '开发', usage: 'Write tests for this project' },
  { id: 'debug', name: '调试', description: '调试当前问题', category: '开发', usage: 'Debug the current issue' },
  { id: 'fix', name: '修复Bug', description: '修复已知的Bug', category: '开发', usage: 'Fix the bugs in this project' },
  { id: 'docs', name: '写文档', description: '为项目编写文档', category: '文档', usage: 'Write documentation for this project' }
];

// Codex 命令定义
const CODEX_COMMANDS: CommandDef[] = [
  { id: 'implement', name: '实现功能', description: '实现新功能', category: '开发', usage: 'Implement the requested feature' },
  { id: 'review', name: '代码审查', description: '审查代码变更', category: '审查', usage: 'Review the code changes' },
  { id: 'refactor', name: '重构', description: '重构代码', category: '开发', usage: 'Refactor the code for better quality' },
  { id: 'test', name: '写测试', description: '编写测试用例', category: '开发', usage: 'Write tests' },
  { id: 'fix', name: '修复Bug', description: '修复问题', category: '开发', usage: 'Fix the bug' },
  { id: 'explain', name: '解释代码', description: '解释代码逻辑', category: '分析', usage: 'Explain this code' }
];

// 按 agentType 获取命令列表
function getCommandsForAgent(agentType: AgentType): CommandDef[] {
  switch (agentType) {
    case 'claude-code':
      return CLAUDE_COMMANDS;
    case 'opencode':
      return OPENCODE_COMMANDS;
    case 'codex':
      return CODEX_COMMANDS;
    default:
      return CLAUDE_COMMANDS;
  }
}

function clearModelCache(): void {
  _opencodeModelsCache = null;
}

export {
  CLAUDE_COMMANDS,
  OPENCODE_COMMANDS,
  CODEX_COMMANDS,
  PERMISSION_MODES,
  MODELS,
  EFFORT_LEVELS,
  getModelsForAgent,
  getModesForAgent,
  getEffortsForAgent,
  getCommandsForAgent,
  clearModelCache
};
