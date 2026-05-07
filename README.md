# AgentPilot

多 Agent 协作开发平台 — 支持多个 AI 编程助手同时工作，提供完整的开发工具链，可通过浏览器远程使用。

## 功能特性

### 多 Agent 支持

| Agent | 说明 |
|-------|------|
| Claude Code | Anthropic 官方 CLI，功能最全，支持会话恢复、模型选择、effort 等级 |
| OpenCode | 内置多个免费模型，零成本使用，支持 build/plan 模式 |
| Codex | OpenAI Codex CLI，full-auto 模式，支持多 provider 切换 |

### 核心功能

- **多会话并行** — 每个会话独立运行，互不阻塞，支持 per-session 的模式/模型/effort 配置
- **实时流式输出** — WebSocket 实时推送，看到 AI 思考过程
- **远程访问** — 手机浏览器打开即可使用，响应式布局适配移动端
- **子任务拆分** — 将复杂任务拆分为并行子任务，独立或批量执行

### 项目管理

- **项目 CRUD** — 创建、编辑、删除项目，支持从 Git 仓库克隆导入
- **项目收藏** — 收藏常用项目，快速访问
- **密码保护** — 项目可选设置密码，启动会话需验证密码
- **项目预览** — 自动静态文件服务，支持目录浏览和 index.html 回退
- **凭证管理** — 为 Git 项目配置 Token 或 SSH 密钥凭证

### 会话管理

- **按项目过滤** — 会话列表按项目分组，选择项目后显示对应会话
- **会话标签** — 给会话打标签，支持按标签筛选
- **会话归档** — 归档不活跃的会话，保持列表整洁
- **会话置顶** — 置顶重要会话
- **会话导出** — 支持导出/导入会话备份
- **记忆恢复** — 恢复之前的会话上下文继续工作

### AI 开发工具

#### AI 美化

- 自动优化代码格式和样式，支持 HTML/CSS/JS/TS/JSX/TSX/Python/JSON
- 三种美化级别：轻度、中度、激进
- 六种风格预设：Modern、Glassmorphism、Neumorphism、Brutalist、Gradient、Minimal
- 实时预览，美化前后对比
- 支持从文件浏览器右键菜单直接美化并保存

#### 设计系统

- 内置 54 套设计系统（Notion、Linear、Stripe、Figma、Claude、Cursor、Vercel 等）
- 卡片网格浏览，支持搜索和中英文切换
- 亮色/暗色预览，一键应用到项目

#### 设计规范配置

- UI 库选择：Tailwind、Ant Design、MUI、Chakra、None
- 五种设计风格：Modern、Minimal、Corporate、Playful、Neo-brutalism
- 颜色、圆角、字体、间距等全面配置
- 实时预览面板，一键生成 AI Prompt

#### Prompt 模板

- 分类模板：UI、代码、测试、文档、国际化、通用
- 支持自定义模板创建和使用统计
- 搜索和分类筛选，快速插入聊天输入框

#### 组件库

- 支持 React+Tailwind、Vue+Tailwind、原生 HTML/CSS
- 自动检测项目使用的 UI 框架
- 分类浏览，搜索，实时预览
- 一键插入代码或复制到剪贴板

### 文件与 Git

- **文件浏览器** — 右侧栏显示项目文件树，支持查看和编辑文件内容
- **语法高亮** — 代码文件自动语法高亮显示
- **文件差异** — 查看文件修改前后的差异对比
- **Git 控制** — Pull、Push、Commit、分支管理、Stash、Fetch、Diff、Log
- **.gitignore 管理** — 直接编辑 .gitignore 文件

### 工作流编排

- **可视化编排** — 拖拽式工作流编辑器，支持依赖图和循环检测
- **多步骤执行** — 支持串行/并行步骤组合
- **模板管理** — 保存和复用工作流模板
- **模型选择** — 每个步骤可独立选择 AI 模型

### 搜索

- **全局搜索** — Ctrl+K 跨所有会话消息搜索

### 管理员功能

- **用户管理** — 创建、编辑、删除用户，设置角色和权限
- **模型管理** — 配置 AI Provider，管理 API Key，同步模型列表
- **凭证管理** — 管理系统级 Git 凭证（SSH Key、Token）
- **权限控制** — 按用户控制可用的 Agent 类型

### 其他功能

- **Token 统计** — 跟踪每个会话的 API Token 使用量和费用
- **技能系统** — 安装和使用 Agent 技能插件
- **文件上传** — 支持图片和文档附件
- **消息操作** — 复制、引用、删除消息
- **主题切换** — 四种主题：暗夜（默认）、亮白、深夜蓝、樱粉
- **桌面通知** — Agent 完成任务时发送桌面通知
- **帮助中心** — 内置 14 节完整帮助文档

## 快速开始

### 环境要求

- Node.js >= 18
- Git

### 安装与启动

```bash
# 克隆项目
git clone <repo-url>
cd agent-hub

# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 一键启动（开发模式）
./start.sh dev

# 或生产模式
./start.sh
```

### 开发模式

```bash
# 后端（端口 3002）+ 前端（端口 5173）分开启动
./dev.sh
```

### 服务地址

| 模式 | 前端 | 后端 |
|------|------|------|
| 开发 | http://localhost:5173 | http://localhost:3002 |
| 生产 | — | http://localhost:3002（前端由后端托管） |

### 首次使用

1. 打开浏览器访问服务地址
2. 首次访问会进入注册页面，创建管理员账号
3. 登录后即可创建会话，开始使用

## 项目结构

```
agent-pilot/
├── backend/                         # Node.js + Express + WebSocket + SQLite
│   ├── server.ts                    # 入口，注册所有路由和中间件
│   ├── db.ts                        # SQLite 数据库初始化
│   ├── routes/                      # REST API 路由
│   │   ├── auth.ts                  # 认证（JWT 登录、注册、用户偏好）
│   │   ├── sessions.ts             # 会话 CRUD、恢复、状态
│   │   ├── projects.ts             # 项目管理、密码验证、预览
│   │   ├── files.ts                # 文件浏览、读写、删除
│   │   ├── git.ts                  # Git 操作
│   │   ├── models.ts               # AI 模型和 Provider 管理
│   │   ├── credentials.ts          # 凭证管理
│   │   ├── workflows.ts            # 工作流管理
│   │   ├── prompt-templates.ts     # Prompt 模板
│   │   ├── design-specs.ts         # 设计规范配置
│   │   ├── design-systems.ts       # 设计系统
│   │   ├── component-libs.ts       # 组件库
│   │   ├── ai.ts                   # AI 美化接口
│   │   ├── skills.ts               # 技能管理
│   │   ├── search.ts               # 全局搜索
│   │   ├── permissions.ts          # 权限策略
│   │   ├── tokens.ts               # Token 统计
│   │   ├── upload.ts               # 文件上传
│   │   └── export.ts               # 会话导入导出
│   ├── agents/                      # Agent 适配器
│   │   ├── base.ts                 # Agent 基类（EventEmitter）
│   │   ├── claude-code.ts          # Claude Code CLI 适配器
│   │   ├── opencode.ts             # OpenCode CLI 适配器
│   │   ├── codex.ts                # Codex CLI 适配器
│   │   └── factory.ts              # Agent 工厂
│   ├── workflow-engine.ts          # 工作流执行引擎
│   ├── summary-service.ts          # 会话摘要服务
│   └── credentialManager.ts        # 凭证管理器
│
├── frontend/                        # React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── App.tsx                  # 主组件，全局状态管理
│       ├── main.tsx                 # 入口
│       └── components/
│           ├── Sidebar.tsx          # 左侧栏（会话列表、项目选择、控制面板）
│           ├── ChatPanel.tsx        # 聊天面板（WebSocket、工具栏、附件）
│           ├── RightSidebar.tsx     # 右侧栏（文件浏览器、Git 控制）
│           ├── Message.tsx          # 消息渲染
│           ├── ControlPanel.tsx     # Per-session 控制（模式、模型、effort）
│           ├── Login.tsx            # 登录/注册
│           ├── ProjectManager.tsx   # 项目管理弹窗
│           ├── NewSessionModal.tsx  # 新建会话弹窗
│           ├── SubtaskPanel.tsx     # 子任务面板
│           ├── WorkflowEditor.tsx   # 工作流可视化编辑器
│           ├── DesignSystemPanel.tsx # 设计系统浏览（54 套）
│           ├── DesignSpecPanel.tsx   # 设计规范配置
│           ├── DesignSpecPreview.tsx # 设计规范实时预览
│           ├── CodeBeautifyModal.tsx # AI 代码美化
│           ├── PromptTemplatePanel.tsx # Prompt 模板
│           ├── ComponentLibPanel.tsx # 组件库
│           ├── SettingsPanel.tsx     # 系统设置
│           ├── SearchPanel.tsx       # 全局搜索（Ctrl+K）
│           ├── UserManager.tsx       # 用户管理（管理员）
│           ├── ModelManager.tsx      # 模型管理（管理员）
│           ├── CredentialManager.tsx # 凭证管理（管理员）
│           ├── AccessControlManager.tsx # 权限控制（管理员）
│           ├── HelpModal.tsx         # 帮助中心（14 节）
│           ├── ChangelogModal.tsx    # 更新日志
│           ├── ThemeContext.tsx       # 主题上下文（4 种主题）
│           ├── Icons.tsx             # SVG 图标组件
│           └── Toast.tsx             # Toast 通知
│
├── data/                            # 数据存储
│   └── agent-hub.db                 # SQLite 数据库
│
├── start.sh                         # 一键启动脚本
├── dev.sh                           # 开发模式启动
├── ecosystem.config.js              # PM2 配置
└── .env.example                     # 环境变量示例
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18, TypeScript, Vite 5, Tailwind CSS 3 |
| 后端 | Node.js, Express, WebSocket (ws) |
| 数据库 | SQLite (sql.js) |
| 认证 | JWT (jsonwebtoken) |
| 文件上传 | multer |
| 语法高亮 | highlight.js, react-syntax-highlighter |
| Markdown | marked, react-markdown |
| 虚拟列表 | @tanstack/react-virtual |
| 图标 | lucide-react, 自定义 SVG |

## API

### REST 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/agents` | GET | 可用 Agent 列表 |
| `/api/sessions` | GET/POST | 会话列表/创建 |
| `/api/sessions/:id` | DELETE | 删除会话 |
| `/api/sessions/:id/rename` | PUT | 重命名 |
| `/api/sessions/:id/resume` | POST | 恢复会话 |
| `/api/projects` | GET/POST | 项目列表/创建 |
| `/api/projects/:id` | PUT/DELETE | 更新/删除项目 |
| `/api/projects/:id/start` | POST | 启动项目会话 |
| `/api/files` | GET | 文件列表 |
| `/api/files/content` | GET | 文件内容 |
| `/api/git/status` | GET | Git 状态 |
| `/api/git/command` | POST | 执行 Git 命令 |
| `/api/git/commit` | POST | Git 提交 |
| `/api/search` | GET | 全局搜索 |
| `/api/models` | GET | 可用模型列表 |
| `/api/credentials` | GET/POST | 凭证管理 |
| `/api/skills/:agentType` | GET | 技能列表 |
| `/api/tokens/:sessionId` | GET | Token 统计 |
| `/api/workflows` | GET/POST | 工作流管理 |
| `/api/prompt-templates` | GET/POST | Prompt 模板 |
| `/api/design-specs` | GET/POST | 设计规范 |
| `/api/design-systems` | GET | 设计系统列表 |
| `/api/component-libs` | GET | 组件库 |
| `/api/ai/beautify` | POST | AI 代码美化 |

### WebSocket

连接：`ws://host:PORT/ws?session=SESSION_ID&token=TOKEN`

发送消息：
```json
{"type": "user_input", "content": "请帮我实现一个登录页面"}
```

接收消息类型：`text`、`status`、`error`、`token_usage`、`tool_use`、`conversation_id`、`title_update`

## 添加新 Agent

实现 `Agent` 接口（继承 `EventEmitter`）：

```typescript
import { EventEmitter } from 'events';

class MyAgent extends EventEmitter {
  constructor(name: string, workdir: string) {
    super();
    this.name = name;
    this.workdir = workdir;
  }
  start(): void { /* 启动 Agent 进程 */ }
  send(message: string): void { /* 发送消息 */ }
  stop(): void { /* 终止进程 */ }
}
```

必须触发的事件：`message`、`error`、`stopped`

可选事件：`token_usage`、`conversation_id`、`title_update`、`tool_use`

然后在 `agents/factory.ts` 中注册。

## License

MIT
