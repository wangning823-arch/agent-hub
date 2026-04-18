/**
 * 项目管理 - 保存/加载/最近项目
 */
const fs = require('fs');
const path = require('path');

const PROJECTS_FILE = path.join(__dirname, '..', 'data', 'projects.json');

class ProjectManager {
  constructor() {
    this.projects = new Map();
    this.recentProjects = [];
    this.loadData();
  }

  /**
   * 加载项目数据
   */
  loadData() {
    try {
      // 确保数据目录存在
      const dataDir = path.dirname(PROJECTS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(PROJECTS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
        this.projects = new Map(data.projects || []);
        this.recentProjects = data.recentProjects || [];
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
   */
  addProject(name, workdir, agentType = 'claude-code', options = {}) {
    const id = `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const project = {
      id,
      name,
      workdir,
      agentType,
      mode: options.mode || 'auto',
      model: options.model || null,
      effort: options.effort || 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.projects.set(id, project);
    this.addToRecent(id);
    this.saveData();
    
    return project;
  }

  /**
   * 更新项目
   */
  updateProject(id, updates) {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`项目不存在: ${id}`);
    }

    Object.assign(project, updates, {
      updatedAt: new Date().toISOString()
    });

    this.projects.set(id, project);
    this.saveData();
    
    return project;
  }

  /**
   * 获取项目
   */
  getProject(id) {
    return this.projects.get(id);
  }

  /**
   * 获取所有项目
   */
  listProjects() {
    return Array.from(this.projects.values());
  }

  /**
   * 删除项目
   */
  deleteProject(id) {
    const deleted = this.projects.delete(id);
    this.recentProjects = this.recentProjects.filter(pid => pid !== id);
    this.saveData();
    return deleted;
  }

  /**
   * 添加到最近项目
   */
  addToRecent(projectId) {
    this.recentProjects = [
      projectId,
      ...this.recentProjects.filter(id => id !== projectId)
    ].slice(0, 10); // 只保留最近10个
  }

  /**
   * 获取最近项目
   */
  getRecentProjects() {
    return this.recentProjects
      .map(id => this.projects.get(id))
      .filter(Boolean);
  }

  /**
   * 收藏项目
   */
  toggleFavorite(id) {
    const project = this.projects.get(id);
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
   */
  getFavoriteProjects() {
    return Array.from(this.projects.values())
      .filter(p => p.favorite);
  }

  /**
   * 搜索项目
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
