/**
 * 权限管理器 - 管理Agent的权限策略
 */
import * as fs from 'fs';
import * as path from 'path';
import { PermissionRule, PermissionAction } from './types';

// 默认权限策略
const DEFAULT_PERMISSIONS: Record<string, any> = {
  // 文件操作
  file_read: 'auto_allow',      // 读取文件自动允许
  file_write: 'auto_allow',     // 写入文件自动允许

  // 命令执行
  shell_exec: {
    default: 'auto_allow',      // 默认自动允许
    dangerous_patterns: [       // 危险命令需要确认
      /^rm\s+-rf\s+[\/~]/i,     // rm -rf / 或 ~
      /^sudo\s+/i,              // sudo命令
      /^chmod\s+777/i,          // chmod 777
      /^curl.*\|\s*sh/i,        // curl | sh
      /^wget.*\|\s*sh/i,        // wget | sh
    ],
    dangerous_action: 'ask_user' // 危险命令询问用户
  },

  // 网络访问
  network: 'auto_allow',

  // 其他
  other: 'ask_user'             // 其他未知操作询问用户
};

class PermissionManager {
  private configPath: string;
  private permissions: Record<string, any>;

  constructor(configPath: string | null = null) {
    this.configPath = configPath || path.join(__dirname, '../../permissions.json');
    this.permissions = this.loadPermissions();
  }

  /**
   * 加载权限配置
   */
  loadPermissions(): Record<string, any> {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return { ...DEFAULT_PERMISSIONS, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('加载权限配置失败:', error);
    }
    return DEFAULT_PERMISSIONS;
  }

  /**
   * 保存权限配置
   */
  savePermissions(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.permissions, null, 2));
    } catch (error) {
      console.error('保存权限配置失败:', error);
    }
  }

  /**
   * 检查权限
   * @param action - 操作类型
   * @param details - 操作详情
   * @returns 'allow' | 'deny' | 'ask_user'
   */
  checkPermission(action: string, details: { command?: string } = {}): string {
    const policy = this.permissions[action];

    if (!policy) {
      return this.permissions.other || 'ask_user';
    }

    // 如果是简单策略
    if (typeof policy === 'string') {
      return policy;
    }

    // 如果是复杂策略（如shell_exec）
    if (policy.default) {
      // 检查危险模式
      if (policy.dangerous_patterns && details.command) {
        for (const pattern of policy.dangerous_patterns) {
          if (pattern.test(details.command)) {
            return policy.dangerous_action || 'ask_user';
          }
        }
      }
      return policy.default;
    }

    return 'ask_user';
  }

  /**
   * 更新权限策略
   */
  updatePermission(action: string, policy: any): void {
    this.permissions[action] = policy;
    this.savePermissions();
  }

  /**
   * 获取所有权限配置
   */
  getAllPermissions(): Record<string, any> {
    return { ...this.permissions };
  }
}

export default PermissionManager;
