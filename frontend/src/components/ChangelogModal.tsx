import React from 'react'

interface ChangelogModalProps {
  onClose: () => void
}

interface ChangelogEntry {
  version: string
  date: string
  sections: {
    title: string
    color: string
    items: string[]
  }[]
}

const changelog: ChangelogEntry[] = [
  {
    version: '0.2.20260506.0001',
    date: '2026-05-06',
    sections: [
      {
        title: '新功能',
        color: 'var(--accent-primary, #6366f1)',
        items: [
          '支持多种 AI Agent：Claude Code、OpenCode、Codex',
          '项目管理：创建项目、导入 Git 仓库、设置项目密码',
          '项目预览功能：在浏览器中预览项目运行效果',
          '全局搜索：Ctrl+K 快速搜索所有会话内容',
          '文件浏览器：右侧面板浏览项目文件结构',
          '工作流编辑器：创建和执行自动化工作流',
          '多种主题选择，支持跟随用户偏好',
          '聊天消息引用、复制、删除功能',
          '聊天发送/停止按钮合并，节省空间',
          '文件上传支持（图片、文档等附件）',
        ],
      },
      {
        title: '管理员功能',
        color: 'var(--warning, #f59e0b)',
        items: [
          '用户管理：创建、编辑、删除用户',
          '权限控制：管理员可控制用户可用的 Agent 类型',
          '模型管理：配置和管理系统模型',
          '凭证管理：统一管理 API Key 和 SSH 密钥',
        ],
      },
      {
        title: '改进',
        color: 'var(--success, #22c55e)',
        items: [
          'Token 统计和用量跟踪',
          '会话标签和分类管理',
          '聊天记录导出功能',
          '移动端适配优化',
        ],
      },
      {
        title: '修复',
        color: 'var(--success, #22c55e)',
        items: [
          '修复 Codex Agent 多用户并发使用不同 provider 的模型',
          '修复前端依赖安全漏洞',
          '修复项目预览目录列表链接跳转错误',
          '修复新用户首次登录崩溃问题',
          '修复 Git 克隆项目功能',
          '修复非管理员用户无法获取模型列表',
        ],
      },
    ],
  },
]

const ChangelogModal: React.FC<ChangelogModalProps> = ({ onClose }) => {
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '36rem' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            更新日志
          </h2>
          <button onClick={onClose} className="btn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: '65vh' }}>
          {changelog.map((entry) => (
            <div key={entry.version} style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <span
                  style={{
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#fff',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  v{entry.version}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {entry.date}
                </span>
              </div>

              {entry.sections.map((section) => (
                <div key={section.title} style={{ marginBottom: '1rem' }}>
                  <h3
                    style={{
                      color: section.color,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: '0.5rem',
                    }}
                  >
                    {section.title}
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                    {section.items.map((item, idx) => (
                      <li
                        key={idx}
                        style={{
                          color: 'var(--text-secondary)',
                          fontSize: '0.85rem',
                          lineHeight: 1.7,
                        }}
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ChangelogModal
