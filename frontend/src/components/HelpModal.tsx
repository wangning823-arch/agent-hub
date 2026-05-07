import React, { useState } from 'react'

interface HelpModalProps {
  onClose: () => void
}

interface HelpSection {
  id: string
  title: string
  icon: React.ReactNode
  content: React.ReactNode
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState<string>('overview')

  const sections: HelpSection[] = [
    {
      id: 'overview',
      title: '概览',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--text-primary)' }}>AgentPilot</strong> 是一个多 Agent 协作开发平台，允许同时使用多个 AI 编程助手，每个助手在独立的项目窗口中工作。
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            支持的 Agent 类型包括 Claude Code、OpenCode 和 Codex，你可以根据需要选择最适合的 AI 助手来协助开发。
          </p>
        </div>
      ),
    },
    {
      id: 'projects',
      title: '项目管理',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V9C21 7.9 20.1 7 19 7H13L11 5H5C3.9 5 3 5.9 3 7Z" />
        </svg>
      ),
      content: (
        <div>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>创建新项目</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>点击侧边栏底部的 <strong>+</strong> 按钮</li>
            <li>选择"新建项目"，填写项目名称和工作目录</li>
            <li>可选：设置项目密码保护</li>
          </ol>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>导入 Git 仓库</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>点击 <strong>+</strong> 按钮，选择"导入 Git 仓库"</li>
            <li>输入仓库 URL</li>
            <li>如有私有仓库，选择已保存的凭证</li>
            <li>点击导入，系统会自动克隆仓库</li>
          </ol>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>项目预览</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            点击顶部项目名称旁的链接图标，可在新标签页中预览项目的 Web 服务。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem', marginTop: '1rem' }}>项目收藏</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            点击项目旁的星标图标可收藏项目，收藏的项目会优先显示在列表中。
          </p>
        </div>
      ),
    },
    {
      id: 'sessions',
      title: '会话管理',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      content: (
        <div>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>创建会话</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>在侧边栏中选择一个项目</li>
            <li>点击 <strong>新建会话</strong> 按钮</li>
            <li>选择要使用的 Agent 类型（Claude Code / OpenCode / Codex）</li>
            <li>点击创建，等待 Agent 初始化完成</li>
          </ol>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>会话操作</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li><strong>置顶</strong>：将重要会话固定在列表顶部</li>
            <li><strong>归档</strong>：归档已完成的会话，不显示在主列表中</li>
            <li><strong>标签</strong>：为会话添加标签，支持按标签筛选</li>
            <li><strong>恢复记忆</strong>：恢复 Agent 的上下文记忆</li>
          </ul>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>会话控制</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            每个会话可独立设置工作模式、使用的模型和努力程度，通过侧边栏下方的控制面板进行调整。
          </p>
        </div>
      ),
    },
    {
      id: 'chat',
      title: '聊天功能',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
      content: (
        <div>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>发送消息</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            在底部输入框中输入消息，点击发送按钮或按 Enter 发送。支持上传图片、文档等附件。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>中断任务</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            Agent 正在工作时，发送按钮会变为停止按钮（红色方块），点击可中断当前任务。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>拆分模式</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            勾选"拆分"选项后，复杂任务会被拆分为多个并行子任务同时执行，提高效率。可在顶部并行任务面板中查看各子任务进度。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>消息操作</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li><strong>复制</strong>：悬停消息，点击复制图标</li>
            <li><strong>引用</strong>：点击引用图标，将消息内容作为输入</li>
            <li><strong>删除</strong>：点击删除图标移除消息</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workflow',
      title: '工作流',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            工作流允许你创建可复用的自动化任务序列，将多个步骤串联执行。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>使用工作流</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>在侧边栏中找到"工作流"入口</li>
            <li>使用工作流编辑器创建或选择模板</li>
            <li>执行工作流，可随时暂停、取消或重试</li>
          </ol>
        </div>
      ),
    },
    {
      id: 'search',
      title: '搜索',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            使用 <kbd style={{ background: 'var(--bg-tertiary)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}>Ctrl+K</kbd> 或点击顶部搜索按钮打开全局搜索。
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            搜索会遍历所有会话的消息内容，找到匹配结果后点击即可跳转到对应会话。
          </p>
        </div>
      ),
    },
    {
      id: 'files',
      title: '文件浏览',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            点击顶部的面板按钮可打开右侧文件浏览器，查看项目的文件结构。
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>点击文件可查看内容，支持代码高亮</li>
            <li>右键文件可执行删除、AI 美化等操作</li>
            <li>使用 <kbd style={{ background: 'var(--bg-tertiary)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>Ctrl+S</kbd> 保存文件修改</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'ai-beautify',
      title: 'AI 美化',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            AI 美化功能可以使用 AI 自动优化你的代码格式和样式，支持 HTML、CSS、JavaScript 等多种语言。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>使用方式</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li><strong>聊天工具栏</strong>：点击工具栏的 AI 美化按钮，可粘贴代码进行美化</li>
            <li><strong>文件右键菜单</strong>：在文件浏览器中右键文件，选择"AI 美化"</li>
          </ul>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>功能特点</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>支持代码和实时预览两种视图（HTML/CSS 文件）</li>
            <li>美化前后代码对比，支持独立预览</li>
            <li>可直接保存美化结果到文件</li>
            <li>自动检测代码语言，支持手动切换</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'design-systems',
      title: '设计系统',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            内置 54 套知名产品设计系统（Notion、Linear、Stripe、Figma 等），一键应用到你的项目。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>打开方式</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            点击聊天工具栏的调色板图标（🎨）打开设计系统面板。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>浏览与预览</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>支持关键词搜索设计系统</li>
            <li>3 列卡片网格展示，包含名称和简介</li>
            <li>点击卡片查看详情，包含设计规范代码、亮色/暗色预览</li>
          </ul>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>应用到项目</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>点击"应用到项目"按钮，设计规范文件会自动写入项目目录</li>
            <li>支持复制设计规范代码到剪贴板</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'design-spec',
      title: '设计规范',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            设计规范定义项目的视觉风格，包括颜色、字体、间距、圆角等，AI 在生成代码时会自动遵循这些规范。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>配置方式</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>打开设置面板，切换到"设计规范"标签页</li>
            <li>选择设计风格（现代、极简、企业、活泼、新粗野主义）</li>
            <li>选择 UI 组件库（Ant Design、Material UI、Tailwind 等）</li>
            <li>自定义颜色、字体、间距等参数</li>
          </ol>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>实时预览</h4>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            右侧面板会实时展示当前设计规范的预览效果，包括卡片、按钮、输入框等组件样式。
          </p>
        </div>
      ),
    },
    {
      id: 'theme',
      title: '主题设置',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            点击顶部设置按钮，在"主题"标签页中选择主题。可选主题包括：
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li><strong>暗夜</strong> - 深色主题（默认）</li>
            <li><strong>亮白</strong> - 浅色主题</li>
            <li><strong>深夜蓝</strong> - 深蓝色主题</li>
            <li><strong>樱粉</strong> - 樱花粉色主题</li>
          </ul>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
            主题设置会跟随用户账号保存。
          </p>
        </div>
      ),
    },
    {
      id: 'settings',
      title: '系统设置',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            点击顶部设置按钮打开设置面板，包含以下标签页：
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li><strong>主题</strong> - 切换界面主题</li>
            <li><strong>设计规范</strong> - 配置项目设计风格和 UI 组件库</li>
            <li><strong>凭证</strong> - 管理 Token 和 SSH 密钥等凭证</li>
            <li><strong>模型</strong> - 配置和管理系统模型</li>
            <li><strong>权限</strong> - 管理员设置用户可用的 Agent 类型</li>
            <li><strong>通知</strong> - 配置桌面通知</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'prompts',
      title: 'Prompt 模板',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            Prompt 模板提供预设的提示词模板，帮助你快速发起高质量的 AI 对话。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>使用方式</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>点击聊天工具栏的模板图标打开模板面板</li>
            <li>浏览或搜索需要的模板</li>
            <li>点击模板卡片，内容会自动填入输入框</li>
            <li>根据需要修改变量部分，然后发送</li>
          </ol>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>模板分类</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>代码开发类：代码审查、Bug 修复、功能实现</li>
            <li>文档编写类：API 文档、README、注释生成</li>
            <li>测试类：单元测试、集成测试用例生成</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'component-lib',
      title: '组件库',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
      content: (
        <div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '1rem' }}>
            组件库提供常用 UI 组件的代码片段和最佳实践，帮助你快速构建界面。
          </p>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>使用方式</h4>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            <li>点击聊天工具栏的组件库图标打开面板</li>
            <li>按分类浏览组件（按钮、表单、卡片、导航等）</li>
            <li>点击组件查看代码示例和使用说明</li>
            <li>复制代码到你的项目中使用</li>
          </ol>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>支持的框架</h4>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>React + Tailwind CSS</li>
            <li>Vue + Tailwind CSS</li>
            <li>原生 HTML/CSS</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'shortcuts',
      title: '快捷键',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <line x1="6" y1="8" x2="6.01" y2="8" />
          <line x1="10" y1="8" x2="10.01" y2="8" />
          <line x1="14" y1="8" x2="14.01" y2="8" />
          <line x1="18" y1="8" x2="18.01" y2="8" />
          <line x1="8" y1="12" x2="8.01" y2="12" />
          <line x1="12" y1="12" x2="12.01" y2="12" />
          <line x1="16" y1="12" x2="16.01" y2="12" />
          <line x1="7" y1="16" x2="17" y2="16" />
        </svg>
      ),
      content: (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Ctrl + K', '打开全局搜索'],
                ['Enter', '发送消息'],
                ['Shift + Enter', '换行（不发送）'],
                ['Ctrl + S', '保存文件（文件查看器中）'],
              ].map(([key, desc]) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '0.6rem 0', width: '40%' }}>
                    <kbd style={{
                      background: 'var(--bg-tertiary)',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                    }}>
                      {key}
                    </kbd>
                  </td>
                  <td style={{ padding: '0.6rem 0', color: 'var(--text-secondary)' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
  ]

  const currentSection = sections.find((s) => s.id === activeSection) || sections[0]

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '40rem', height: '70vh', display: 'flex', flexDirection: 'column' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            帮助中心
          </h2>
          <button onClick={onClose} className="btn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left sidebar */}
          <div
            style={{
              width: '12rem',
              flexShrink: 0,
              borderRight: '1px solid var(--border-subtle)',
              overflowY: 'auto',
              padding: '0.5rem 0',
            }}
          >
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  padding: '0.5rem 1rem',
                  border: 'none',
                  background: activeSection === section.id ? 'var(--bg-tertiary)' : 'transparent',
                  color: activeSection === section.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                {section.icon}
                {section.title}
              </button>
            ))}
          </div>
          {/* Right content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.1rem',
                fontWeight: 600,
                marginBottom: '1rem',
              }}
            >
              {currentSection.title}
            </h3>
            {currentSection.content}
          </div>
        </div>
      </div>
    </div>
  )
}

export default HelpModal
