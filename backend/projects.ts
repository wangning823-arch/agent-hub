/**
 * 项目管理 - 保存/加载/最近项目
 * 项目仅与工作目录关联，不包含Agent特定配置
 * Git凭证由独立的CredentialManager管理，在项目添加/更新时自动应用
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import credentialManager from './credentialManager';
import { getDb } from './db';

const PROJECTS_FILE = path.join(__dirname, '..', '..', 'data', 'projects.json');

interface ProjectObj {
  id: string;
  name: string;
  workdir: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  gitHost?: string | null;
  gitConfigured?: boolean;
}

interface ProjectData {
  projects: [string, ProjectObj][] | Record<string, ProjectObj>;
  recentProjects: string[];
}

interface ApplyResult {
  success: boolean;
  message: string;
}

class ProjectManager {
  projects: Map<string, ProjectObj>;
  recentProjects: string[];

  constructor() {
    this.projects = new Map();
    this.recentProjects = [];
    this.loadData();
  }

  _getGitHostFromWorkdir(workdir: string): string | null {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) return null;

      let url: string;
      try {
        url = execSync('git config --local --get remote.origin.url', {
          cwd: workdir,
          encoding: 'utf8'
        }).trim();
      } catch (_e) {
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
    } catch (_e) {
      return null;
    }
  }

  _getRemoteProtocol(workdir: string): 'ssh' | 'https' | null {
    try {
      const url = execSync('git config --local --get remote.origin.url', {
        cwd: workdir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (url.startsWith('git@') || url.startsWith('ssh://')) return 'ssh';
      if (url.startsWith('https://') || url.startsWith('http://')) return 'https';
    } catch (_e) {}
    return null;
  }

  _credMatchesProtocol(cred: any, protocol: 'ssh' | 'https' | null): boolean {
    if (!protocol) return true;
    if (protocol === 'ssh' && cred.type === 'ssh') return true;
    if (protocol === 'https' && cred.type === 'token') return true;
    return false;
  }

  _applyCredentialToWorkdir(workdir: string, cred: any): ApplyResult {
    try {
      const gitDir = path.join(workdir, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: false, message: '非Git仓库' };
      }

      if (cred.type === 'token') {
        execSync(`git config --local credential.helper "store --file=.git/credentials"`, {
          cwd: workdir
        });
        const username = cred.username || 'git';
        if (!cred.secret) {
          return { success: false, message: 'Token缺失' };
        }
        const credentialsLine = `https://${username}:${cred.secret}@${cred.host}\n`;
        const credentialsFile = path.join(workdir, '.git', 'credentials');
        fs.writeFileSync(credentialsFile, credentialsLine, { encoding: 'utf8' });
        fs.chmodSync(credentialsFile, parseInt('600', 8));
        return { success: true, message: 'Token凭证已配置' };
      } else if (cred.type === 'ssh') {
        execSync('git config --local core.sshCommand "ssh -o StrictHostKeyChecking=no"', {
          cwd: workdir
        });
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
    } catch (error: any) {
      return { success: false, message: `配置失败: ${error.message}` };
    }
  }

  loadData(): void {
    try {
      const dataDir = path.dirname(PROJECTS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(PROJECTS_FILE)) {
        const raw = fs.readFileSync(PROJECTS_FILE, 'utf8');
        const data: ProjectData = JSON.parse(raw);

        const migratedProjects = new Map<string, ProjectObj>();
        let projectsData = data.projects || [];
        if (Array.isArray(projectsData)) {
          for (const [id, proj] of projectsData) {
            const migrated: ProjectObj = {
              id: proj.id,
              name: proj.name,
              workdir: proj.workdir,
              createdAt: proj.createdAt || new Date().toISOString(),
              updatedAt: proj.updatedAt || new Date().toISOString(),
              favorite: !!proj.favorite,
            };

            const host = this._getGitHostFromWorkdir(migrated.workdir);
            const protocol = this._getRemoteProtocol(migrated.workdir);
            migrated.gitHost = host || null;
            if (host) {
              const cred = credentialManager.getCredentialForHost(host);
              if (cred && this._credMatchesProtocol(cred, protocol)) {
                const applyResult = this._applyCredentialToWorkdir(migrated.workdir, cred);
                migrated.gitConfigured = applyResult.success;
              } else {
                migrated.gitConfigured = (credentialManager as any).hasCredentialForHost(host, migrated.workdir);
              }
            } else {
              migrated.gitConfigured = false;
            }

            migratedProjects.set(id, migrated);
          }
        } else {
          for (const [id, proj] of Object.entries(projectsData)) {
            const migrated: ProjectObj = {
              id: proj.id,
              name: proj.name,
              workdir: proj.workdir,
              createdAt: proj.createdAt || new Date().toISOString(),
              updatedAt: proj.updatedAt || new Date().toISOString(),
              favorite: !!proj.favorite,
            };

            const host = this._getGitHostFromWorkdir(migrated.workdir);
            const protocol = this._getRemoteProtocol(migrated.workdir);
            migrated.gitHost = host || null;
            if (host) {
              const cred = credentialManager.getCredentialForHost(host);
              if (cred && this._credMatchesProtocol(cred, protocol)) {
                const applyResult = this._applyCredentialToWorkdir(migrated.workdir, cred);
                migrated.gitConfigured = applyResult.success;
              } else {
                migrated.gitConfigured = (credentialManager as any).hasCredentialForHost(host, migrated.workdir);
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

  saveData(): void {
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

  addProject(name: string, workdir: string): ProjectObj {
    const id = `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const project: ProjectObj = {
      id,
      name,
      workdir,
      createdAt: now,
      updatedAt: now,
      favorite: false
    };

    const host = this._getGitHostFromWorkdir(workdir);
    const protocol = this._getRemoteProtocol(workdir);
    project.gitHost = host || null;
    if (host) {
      const cred = credentialManager.getCredentialForHost(host);
      if (cred && this._credMatchesProtocol(cred, protocol)) {
        const applyResult = this._applyCredentialToWorkdir(workdir, cred);
        project.gitConfigured = applyResult.success;
      } else {
        project.gitConfigured = (credentialManager as any).hasCredentialForHost(host, workdir);
      }
    } else {
      project.gitConfigured = false;
    }

    this.projects.set(id, project);
    this.addToRecent(id);
    this.saveData();

    try {
      const db = getDb();
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO projects (id, name, workdir, agent_type, mode, model, effort, created_at, updated_at, last_session_id, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      stmt.run([id, name, workdir, 'claude-code', 'auto', null, 'medium', now, now, null, now]);
    } catch (e: any) {
      console.warn('同步项目到数据库失败:', e.message);
    }

    return project;
  }

  updateProject(id: string, updates: Partial<ProjectObj>): ProjectObj {
    const project = this.getProject(id);
    if (!project) {
      throw new Error(`项目不存在: ${id}`);
    }

    const allowedUpdates: Partial<ProjectObj> = {};
    if ('name' in updates) allowedUpdates.name = updates.name;
    if ('workdir' in updates) allowedUpdates.workdir = updates.workdir;
    if ('favorite' in updates) allowedUpdates.favorite = updates.favorite;

    Object.assign(project, allowedUpdates, {
      updatedAt: new Date().toISOString()
    });

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
          project.gitConfigured = (credentialManager as any).hasCredentialForHost(host, project.workdir);
        }
      } else {
        project.gitConfigured = false;
      }
    }

    this.saveData();
    return project;
  }

  getProject(id: string): ProjectObj | null {
    return this.projects.get(id) || null;
  }

  listProjects(): ProjectObj[] {
    return Array.from(this.projects.values());
  }

  deleteProject(id: string): boolean {
    const deleted = this.projects.delete(id);
    this.recentProjects = this.recentProjects.filter(pid => pid !== id);
    this.saveData();
    return deleted;
  }

  addToRecent(projectId: string): void {
    this.recentProjects = [
      projectId,
      ...this.recentProjects.filter(id => id !== projectId)
    ].slice(0, 10);
  }

  getRecentProjects(): ProjectObj[] {
    return this.recentProjects
      .map(id => this.projects.get(id))
      .filter(Boolean) as ProjectObj[];
  }

  toggleFavorite(id: string): ProjectObj {
    const project = this.getProject(id);
    if (!project) {
      throw new Error(`项目不存在: ${id}`);
    }

    project.favorite = !project.favorite;
    project.updatedAt = new Date().toISOString();
    this.saveData();

    return project;
  }

  getFavoriteProjects(): ProjectObj[] {
    return Array.from(this.projects.values())
      .filter(p => p.favorite);
  }

  searchProjects(query: string): ProjectObj[] {
    const q = query.toLowerCase();
    return Array.from(this.projects.values())
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.workdir.toLowerCase().includes(q)
      );
  }
}

export default ProjectManager;
