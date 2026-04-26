/**
 * 项目管理 - 保存/加载/最近项目
 * 项目仅与工作目录关联，不包含Agent特定配置
 * Git凭证由独立的CredentialManager管理，在项目添加/更新时自动应用
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const credentialManager = require('./credentialManager');
const { getDb } = require('./db');

const PROJECTS_FILE = path.join(__dirname, '..', 'data', 'projects.json');

class ProjectManager {
  constructor() {
    this.projects = new Map(); // id -> projectObj
    this.recentProjects = [];
    this.loadData();
  }

  /**
   * 从工作目录检测Git远程主机（如github.com）
   * @param {string} workdir
   * @returns {string|null}
   */
  _getGitHostFromWorkdir(workdir) {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) return null;

      // 获取远程URL
      let url;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      } catch (e) {
        // 如果没有origin，尝试第一个远程
        const remotes = execSync('git remote', {
          cwd: workdir,
          encoding: 'utf8'
        })
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (remotes.length === 0) return null;
        url = execSync(`git config --local --get remote.${remotes[0]}.url`, {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      }
      if (!url) return null;

      // 解析主机名
      if (url.startsWith('https://')) {
        const after = url.substring(8);
        const slash = after.indexOf('/');
        if (slash !== -1) {
          return after.substring(0, slash);
        }
      } else if (url.startsWith('git@')) {
        const after = url.substring(4);
        const colon = after.indexOf(':');
        if (colon !== -1) {
          return after.substring(0, colon);
        }
      } else if (url.startsWith('ssh://')) {
        const after = url.substring(6);
        const at = after.indexOf('@');
        if (at !== -1) {
          const afterAt = after.substring(at + 1);
          const slash = afterAt.indexOf('/');
          if (slash !== -1) {
            return afterAt.substring(0, slash);
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取项目的远程协议类型
   * @param {string} workdir
   * @returns {'ssh'|'https'|null}
   */
  _getRemoteProtocol(workdir) {
    try {
      const url = execSync('git config --local --get remote.origin.url', {
        cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (url.startsWith('git@') || url.startsWith('ssh://')) return 'ssh';
      if (url.startsWith('https://') || url.startsWith('http://')) return 'https';
    } catch (e) {}
    return null;
  }

  /**
   * 判断凭证类型是否匹配远程协议
   * @param {Object} cred - {type: 'token'|'ssh', ...}
   * @param {'ssh'|'https'|null} protocol
   * @returns {boolean}
   */
  _credMatchesProtocol(cred, protocol) {
    if (!protocol) return true; // 不知道协议时允许任何凭证
    if (protocol === 'ssh' && cred.type === 'ssh') return true;
    if (protocol === 'https' && cred.type === 'token') return true;
    return false;
  }

  /**
   * 将凭证应用到指定工作目录的Git配置
   * @param {string} workdir
   * @param {Object} cred - 从CredentialManager获取的凭证对象
   * @returns {Object} {success: boolean, message: string}
   */
  _applyCredentialToWorkdir(workdir, cred) {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: false, message: '非Git仓库' };
      }

      if (cred.type === 'token') {
        // 配置凭证助手
        execSync(`git config --local credential.helper "store --file=.git/credentials"`, {
          cwd: workdir
        });
        // 写入凭证文件
        const username = cred.username || 'git';
        if (!cred.secret) {
          return { success: false, message: 'Token缺失' };
        }
        const credentialsLine = `https://${username}:${cred.secret}@${cred.host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8)); // 仅所有者可读写
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        // 配置使用SSH
        execSync('git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"', {
          cwd: workdir
        });
        // 如果提供了私钥数据，写入临时文件并指定
        if (cred.keyData) {
          const keyPath = path.join(workdir, '.git', 'id_rsa');
          fs.writeFileSync(keyPath, cred.keyData, { encoding: 'utf8' });
          fs.chmodSync(keyPath, parseInt('600', 8));
          execSync(`git config --local core.sshCommand "ssh -i ${keyPath} -o StrictHostKeyChecking=no"`, {
            cwd: workdir
          });
        }
        return { success: true, message: 'SSH凭证已配置' };
      } else {
        return { success: false, message: `未知凭证类型: ${cred.type}` };
      }
    } catch (error) {
      return { success: false, message: `配置失败: ${error.message}` };
    }
  }

  /**
   * 加载项目数据并迁移到新格式
   */
  loadData() {
    try {
      const dataDir = path.dirname(PROJECTS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(PROJECTS_FILE)) {
        const raw = fs.readFileSync(PROJECTS_FILE, 'utf8');
        const data = JSON.parse(raw);
        
        // 迁移旧项目数据到新格式
        const migratedProjects = new Map();
        // 处理两种可能的格式:
        // 1. 旧格式: { id1: projObj1, id2: projObj2 } 
        // 2. 新格式: [ [id1, projObj1], [id2, projObj2] ] (来自Array.from(map.entries()))
        let projectsData = data.projects || [];
        if (Array.isArray(projectsData)) {
          // 新格式: 数组中的键值对
          for (const [id, proj] of projectsData) {
            // 迁移逻辑...
            const migrated = {
              id: proj.id,
              name: proj.name,
              workdir: proj.workdir,
              createdAt: proj.createdAt || new Date().toISOString(),
              updatedAt: proj.updatedAt || new Date().toISOString(),
              favorite: !!proj.favorite,
              // 将在下面计算gitHost和gitConfigured
            };
            
            // 检测Git主机并应用凭证
            const host = this._getGitHostFromWorkdir(migrated.workdir);
            const protocol = this._getRemoteProtocol(migrated.workdir);
            migrated.gitHost = host || null;
            if (host) {
              const cred = credentialManager.getCredentialForHost(host);
              if (cred && this._credMatchesProtocol(cred, protocol)) {
                const applyResult = this._applyCredentialToWorkdir(migrated.workdir, cred);
                migrated.gitConfigured = applyResult.success;
              } else {
                migrated.gitConfigured = credentialManager.hasCredentialForHost(host, migrated.workdir);
              }
            } else {
              migrated.gitConfigured = false;
            }
            
            migratedProjects.set(id, migrated);
          }
        } else {
          // 旧格式: 对象
          for (const [id, proj] of Object.entries(projectsData)) {
            // 迁移逻辑...
            const migrated = {
              id: proj.id,
              name: proj.name,
              workdir: proj.workdir,
              createdAt: proj.createdAt || new Date().toISOString(),
              updatedAt: proj.updatedAt || new Date().toISOString(),
              favorite: !!proj.favorite,
              // 将在下面计算gitHost和gitConfigured
            };
            
            // 检测Git主机并应用凭证
            const host = this._getGitHostFromWorkdir(migrated.workdir);
            const protocol = this._getRemoteProtocol(migrated.workdir);
            migrated.gitHost = host || null;
            if (host) {
              const cred = credentialManager.getCredentialForHost(host);
              if (cred && this._credMatchesProtocol(cred, protocol)) {
                const applyResult = this._applyCredentialToWorkdir(migrated.workdir, cred);
                migrated.gitConfigured = applyResult.success;
              } else {
                migrated.gitConfigured = credentialManager.hasCredentialForHost(host, migrated.workdir);
              }
            } else {
              migrated.gitConfigured = false;
            }
            
            migratedProjects.set(id, migrated);
          }
        }
        
        this.projects = migratedProjects;
        this.recentProjects = data.recentProjects || [];
      } else {
        this.projects = new Map();
        this.recentProjects = [];
      }
    } catch (error) {
      console.error('加载项目数据失败:', error);
      this.projects = new Map();
      this.recentProjects = [];
    }
  }

  /**
   * 保存项目数据
   */
  saveData() {
    try {
      const dataDir = path.dirname(PROJECTS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const data = {
        projects: Array.from(this.projects.entries()),
        recentProjects: this.recentProjects
      };
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('保存项目数据失败:', error);
    }
  }

  /**
   * 添加项目
   * @param {string} name - 项目名称
   * @param {string} workdir - 工作目录绝对路径
   * @returns {Object} 创建的项目对象
   */
  addProject(name, workdir) {
    const id = `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const project = {
      id,
      name,
      workdir,
      createdAt: now,
      updatedAt: now,
      favorite: false
    };
    
    // 检测Git主机并应用凭证
    const host = this._getGitHostFromWorkdir(workdir);
    const protocol = this._getRemoteProtocol(workdir);
    project.gitHost = host || null;
    if (host) {
      const cred = credentialManager.getCredentialForHost(host);
      if (cred && this._credMatchesProtocol(cred, protocol)) {
        const applyResult = this._applyCredentialToWorkdir(workdir, cred);
        project.gitConfigured = applyResult.success;
      } else {
        project.gitConfigured = credentialManager.hasCredentialForHost(host, workdir);
      }
    } else {
      project.gitConfigured = false;
    }
    
    this.projects.set(id, project);
    this.addToRecent(id);
    this.saveData();

    // 同步到 SQLite 数据库
    try {
      const db = getDb();
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO projects (id, name, workdir, agent_type, mode, model, effort, created_at, updated_at, last_session_id, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      stmt.run([id, name, workdir, 'claude-code', 'auto', null, 'medium', now, now, null, now]);
    } catch (e) {
      console.warn('同步项目到数据库失败:', e.message);
    }
    
    return project;
  }

  /**
   * 更新项目
   * @param {string} id - 项目ID
   * @param {Object} updates - 要更新的字段（仅name, workdir, favorite有效）
   * @returns {Object} 更新后的项目对象
   */
  updateProject(id, updates) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error(`项目不存在: ${id}`);
    }
    
    // 只允许更新某些字段
    const allowedUpdates = {};
    if ('name' in updates) allowedUpdates.name = updates.name;
    if ('workdir' in updates) allowedUpdates.workdir = updates.workdir;
    if ('favorite' in updates) allowedUpdates.favorite = updates.favorite;
    
    Object.assign(project, allowedUpdates, {
      updatedAt: new Date().toISOString()
    });
    
    // 如果工作目录变化，重新检测Git并应用凭证
    if ('workdir' in updates) {
      const host = this._getGitHostFromWorkdir(project.workdir);
      const protocol = this._getRemoteProtocol(project.workdir);
      project.gitHost = host || null;
      if (host) {
        const cred = credentialManager.getCredentialForHost(host);
        if (cred && this._credMatchesProtocol(cred, protocol)) {
          const applyResult = this._applyCredentialToWorkdir(project.workdir, cred);
          project.gitConfigured = applyResult.success;
        } else {
          project.gitConfigured = credentialManager.hasCredentialForHost(host, project.workdir);
        }
      } else {
        project.gitConfigured = false;
      }
    }
    
    this.saveData();
    return project;
  }

  /**
   * 获取项目
   * @param {string} id
   * @returns {Object|null}
   */
  getProject(id) {
    return this.projects.get(id) || null;
  }

  /**
   * 获取所有项目
   * @returns {Array}
   */
  listProjects() {
    return Array.from(this.projects.values());
  }

  /**
   * 删除项目
   * @param {string} id
   * @returns {boolean}
   */
  deleteProject(id) {
    const deleted = this.projects.delete(id);
    this.recentProjects = this.recentProjects.filter(pid => pid !== id);
    this.saveData();
    return deleted;
  }

  /**
   * 添加到最近项目
   * @param {string} projectId
   */
  addToRecent(projectId) {
    this.recentProjects = [
      projectId,
      ...this.recentProjects.filter(id => id !== projectId)
    ].slice(0, 10); // 只保留最近10个
  }

  /**
   * 获取最近项目
   * @returns {Array}
   */
  getRecentProjects() {
    return this.recentProjects
      .map(id => this.projects.get(id))
      .filter(Boolean);
  }

  /**
   * 收藏项目
   * @param {string} id
   * @returns {Object}
   */
  toggleFavorite(id) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error(`项目不存在: ${id}`);
    }
    
    project.favorite = !project.favorite;
    project.updatedAt = new Date().toISOString();
    this.saveData();
    
    return project;
  }

  /**
   * 获取收藏项目
   * @returns {Array}
   */
  getFavoriteProjects() {
    return Array.from(this.projects.values())
      .filter(p => p.favorite);
  }

  /**
   * 搜索项目
   * @param {string} query
   * @returns {Array}
   */
  searchProjects(query) {
    const q = query.toLowerCase();
    return Array.from(this.projects.values())
      .filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.workdir.toLowerCase().includes(q)
      );
  }
}

module.exports = ProjectManager;