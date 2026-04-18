/**
 * Claude Code 命令定义
 */
const CLAUDE_COMMANDS = [
  // 会话管理
  {
    id: 'compact',
    name: '/compact',
    description: '压缩上下文，减少token使用',
    category: '会话',
    usage: '/compact'
  },
  {
    id: 'continue',
    name: '/continue',
    description: '继续上次的对话',
    category: '会话',
    usage: '/continue'
  },
  {
    id: 'resume',
    name: '/resume',
    description: '恢复指定会话',
    category: '会话',
    usage: '/resume [session-id]'
  },

  // 代码审查
  {
    id: 'review',
    name: '/review',
    description: '审查代码变更',
    category: '审查',
    usage: '/review'
  },
  {
    id: 'security-review',
    name: '/security-review',
    description: '安全审查代码',
    category: '审查',
    usage: '/security-review'
  },

  // 开发工具
  {
    id: 'debug',
    name: '/debug',
    description: '调试当前问题',
    category: '开发',
    usage: '/debug'
  },
  {
    id: 'simplify',
    name: '/simplify',
    description: '简化代码',
    category: '开发',
    usage: '/simplify'
  },
  {
    id: 'init',
    name: '/init',
    description: '初始化项目配置',
    category: '开发',
    usage: '/init'
  },

  // 批处理
  {
    id: 'batch',
    name: '/batch',
    description: '批量执行任务',
    category: '批处理',
    usage: '/batch'
  },
  {
    id: 'loop',
    name: '/loop',
    description: '循环执行任务',
    category: '批处理',
    usage: '/loop'
  },

  // API 和配置
  {
    id: 'claude-api',
    name: '/claude-api',
    description: 'Claude API 相关操作',
    category: '配置',
    usage: '/claude-api'
  },
  {
    id: 'update-config',
    name: '/update-config',
    description: '更新配置',
    category: '配置',
    usage: '/update-config'
  },

  // 分析和洞察
  {
    id: 'insights',
    name: '/insights',
    description: '获取代码洞察',
    category: '分析',
    usage: '/insights'
  },
  {
    id: 'context',
    name: '/context',
    description: '查看当前上下文',
    category: '分析',
    usage: '/context'
  },
  {
    id: 'cost',
    name: '/cost',
    description: '查看API使用成本',
    category: '分析',
    usage: '/cost'
  },

  // 团队协作
  {
    id: 'team-onboarding',
    name: '/team-onboarding',
    description: '团队新人引导',
    category: '团队',
    usage: '/team-onboarding'
  },

  // 调试工具
  {
    id: 'heapdump',
    name: '/heapdump',
    description: '生成堆转储',
    category: '调试',
    usage: '/heapdump'
  }
];

// 模式选项
const PERMISSION_MODES = [
  { id: 'default', name: '默认', description: '标准权限模式' },
  { id: 'auto', name: '自动', description: '自动批准安全操作' },
  { id: 'bypassPermissions', name: '跳过权限', description: '跳过所有权限检查（危险）' },
  { id: 'plan', name: '计划模式', description: '只生成计划，不执行' },
  { id: 'acceptEdits', name: '接受编辑', description: '自动接受文件编辑' },
  { id: 'dontAsk', name: '不询问', description: '不询问直接执行' }
];

// 模型选项 - 从 Claude 配置文件动态读取
const fs = require('fs');
const path = require('path');

function loadModelsFromClaudeConfig() {
  const settingsPath = path.join(process.env.HOME || '/root', '.claude', 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const env = settings.env || {};
    
    // 从 Claude 配置中收集所有模型ID
    const modelIds = new Set();
    const defaultModel = env.ANTHROPIC_MODEL;
    if (defaultModel) modelIds.add(defaultModel);
    if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) modelIds.add(env.ANTHROPIC_DEFAULT_SONNET_MODEL);
    if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) modelIds.add(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
    if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) modelIds.add(env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
    
    // 构建模型列表，默认模型排第一
    const models = [];
    if (defaultModel) {
      models.push({ id: defaultModel, name: defaultModel, description: '当前默认模型' });
    }
    for (const id of modelIds) {
      if (id !== defaultModel) {
        models.push({ id, name: id, description: '' });
      }
    }
    
    // 如果配置文件没有任何模型，fallback
    if (models.length === 0) {
      return [{ id: 'claude-sonnet-4-6', name: 'Sonnet 4', description: '默认模型' }];
    }
    return models;
  } catch (e) {
    console.warn('读取 Claude 配置失败，使用默认模型列表:', e.message);
    return [{ id: 'claude-sonnet-4-6', name: 'Sonnet 4', description: '默认模型' }];
  }
}

const MODELS = loadModelsFromClaudeConfig();

// 努力程度选项
const EFFORT_LEVELS = [
  { id: 'low', name: '低', description: '快速响应，节省token' },
  { id: 'medium', name: '中', description: '平衡速度和质量' },
  { id: 'high', name: '高', description: '更深入的思考' },
  { id: 'max', name: '最大', description: '最深入的分析' }
];

module.exports = {
  CLAUDE_COMMANDS,
  PERMISSION_MODES,
  MODELS,
  EFFORT_LEVELS
};

