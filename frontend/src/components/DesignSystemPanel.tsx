import React, { useState, useEffect, useMemo } from 'react'
import { Search, X, Eye, Copy, Check, Download, ExternalLink } from 'lucide-react'
import { API_BASE } from '../config'

interface DesignSystemMeta {
  id: string
  name: string
  description: string
}

interface DesignSystemPanelProps {
  workdir: string
  onClose: () => void
}

const ZH_MAP: Record<string, { name: string; desc: string }> = {
  airbnb: { name: 'Airbnb', desc: 'Airbnb 设计系统，专注于旅行和住宿平台的用户体验' },
  airtable: { name: 'Airtable', desc: 'Airtable 设计系统，数据库驱动的应用界面设计' },
  apple: { name: 'Apple', desc: 'Apple Human Interface Guidelines，macOS/iOS 设计规范' },
  bmw: { name: 'BMW', desc: 'BMW 设计系统，汽车品牌数字化体验设计' },
  cal: { name: 'Cal.com', desc: 'Cal.com 设计系统，日程调度应用界面设计' },
  claude: { name: 'Claude', desc: 'Anthropic Claude 设计系统，AI 助手界面设计' },
  clay: { name: 'Clay', desc: 'Clay 设计系统，CRM 和销售平台界面设计' },
  clickhouse: { name: 'ClickHouse', desc: 'ClickHouse 设计系统，数据库管理界面设计' },
  cohere: { name: 'Cohere', desc: 'Cohere 设计系统，AI 平台界面设计' },
  coinbase: { name: 'Coinbase', desc: 'Coinbase 设计系统，加密货币交易平台设计' },
  composio: { name: 'Composio', desc: 'Composio 设计系统，AI Agent 集成平台设计' },
  cursor: { name: 'Cursor', desc: 'Cursor 设计系统，AI 代码编辑器界面设计' },
  elevenlabs: { name: 'ElevenLabs', desc: 'ElevenLabs 设计系统，AI 语音合成平台设计' },
  expo: { name: 'Expo', desc: 'Expo 设计系统，React Native 开发工具设计' },
  figma: { name: 'Figma', desc: 'Figma 设计系统，协作设计工具界面设计' },
  framer: { name: 'Framer', desc: 'Framer 设计系统，网站构建和动画工具设计' },
  hashicorp: { name: 'HashiCorp', desc: 'HashiCorp 设计系统，基础设施管理工具设计' },
  ibm: { name: 'IBM Carbon', desc: 'IBM Carbon 设计系统，企业级组件和设计语言' },
  intercom: { name: 'Intercom', desc: 'Intercom 设计系统，客户沟通平台界面设计' },
  kraken: { name: 'Kraken', desc: 'Kraken 设计系统，加密货币交易所界面设计' },
  'linear.app': { name: 'Linear', desc: 'Linear 设计系统，项目管理工具界面设计' },
  lovable: { name: 'Lovable', desc: 'Lovable 设计系统，AI 应用构建平台设计' },
  minimax: { name: 'MiniMax', desc: 'MiniMax 设计系统，AI 平台界面设计' },
  mintlify: { name: 'Mintlify', desc: 'Mintlify 设计系统，文档工具界面设计' },
  miro: { name: 'Miro', desc: 'Miro 设计系统，协作白板工具界面设计' },
  'mistral.ai': { name: 'Mistral AI', desc: 'Mistral AI 设计系统，AI 平台界面设计' },
  mongodb: { name: 'MongoDB', desc: 'MongoDB 设计系统，数据库管理界面设计' },
  notion: { name: 'Notion', desc: 'Notion 设计系统，知识管理和协作工具设计' },
  nvidia: { name: 'NVIDIA', desc: 'NVIDIA 设计系统，GPU 和 AI 计算平台设计' },
  ollama: { name: 'Ollama', desc: 'Ollama 设计系统，本地 AI 模型运行工具设计' },
  'opencode.ai': { name: 'OpenCode', desc: 'OpenCode 设计系统，AI 编程助手界面设计' },
  pinterest: { name: 'Pinterest', desc: 'Pinterest 设计系统，图片分享社交平台设计' },
  posthog: { name: 'PostHog', desc: 'PostHog 设计系统，产品分析平台界面设计' },
  raycast: { name: 'Raycast', desc: 'Raycast 设计系统，效率启动器工具设计' },
  replicate: { name: 'Replicate', desc: 'Replicate 设计系统，AI 模型部署平台设计' },
  resend: { name: 'Resend', desc: 'Resend 设计系统，邮件发送 API 平台设计' },
  revolut: { name: 'Revolut', desc: 'Revolut 设计系统，数字银行和金融应用设计' },
  runwayml: { name: 'Runway', desc: 'Runway 设计系统，AI 视频创作平台设计' },
  sanity: { name: 'Sanity', desc: 'Sanity 设计系统，内容管理平台界面设计' },
  sentry: { name: 'Sentry', desc: 'Sentry 设计系统，错误监控平台界面设计' },
  spacex: { name: 'SpaceX', desc: 'SpaceX 设计系统，航天科技品牌界面设计' },
  spotify: { name: 'Spotify', desc: 'Spotify 设计系统，音乐流媒体平台设计' },
  stripe: { name: 'Stripe', desc: 'Stripe 设计系统，支付和金融服务平台设计' },
  supabase: { name: 'Supabase', desc: 'Supabase 设计系统，开源 Firebase 替代方案设计' },
  superhuman: { name: 'Superhuman', desc: 'Superhuman 设计系统，高性能邮件客户端设计' },
  'together.ai': { name: 'Together AI', desc: 'Together AI 设计系统，AI 推理平台界面设计' },
  uber: { name: 'Uber', desc: 'Uber 设计系统，出行和配送服务平台设计' },
  vercel: { name: 'Vercel', desc: 'Vercel 设计系统，前端部署和云平台设计' },
  voltagent: { name: 'VoltAgent', desc: 'VoltAgent 设计系统，AI Agent 框架界面设计' },
  warp: { name: 'Warp', desc: 'Warp 设计系统，现代终端工具界面设计' },
  webflow: { name: 'Webflow', desc: 'Webflow 设计系统，可视化网站构建工具设计' },
  wise: { name: 'Wise', desc: 'Wise 设计系统，国际转账和多币种账户设计' },
  'x.ai': { name: 'xAI', desc: 'xAI 设计系统，Elon Musk AI 公司界面设计' },
  zapier: { name: 'Zapier', desc: 'Zapier 设计系统，自动化工作流平台设计' },
}

const ZH_UI = {
  searchPlaceholder: '搜索设计系统...',
  noResult: '未找到设计系统',
  loading: '加载中...',
  back: '← 返回',
  code: '代码',
  light: '☀ 亮色',
  dark: '🌙 暗色',
  copy: '复制',
  copied: '已复制',
  apply: '应用到项目',
  applying: '应用中...',
  applied: '✓ 已应用',
  designSystem: '设计系统',
}

export default function DesignSystemPanel({ workdir, onClose }: DesignSystemPanelProps) {
  const [systems, setSystems] = useState<DesignSystemMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [designContent, setDesignContent] = useState('')
  const [previewMode, setPreviewMode] = useState<'code' | 'light' | 'dark'>('code')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lang, setLang] = useState<'en' | 'cn'>('en')

  useEffect(() => {
    fetch(`${API_BASE}/design-systems`)
      .then(r => r.json())
      .then(data => setSystems(data.systems || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const getLocalizedName = (sys: DesignSystemMeta) => {
    if (lang === 'cn' && ZH_MAP[sys.id]) return ZH_MAP[sys.id].name
    return sys.name
  }

  const getLocalizedDesc = (sys: DesignSystemMeta) => {
    if (lang === 'cn' && ZH_MAP[sys.id]) return ZH_MAP[sys.id].desc
    return sys.description || 'Design system'
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return systems
    const q = search.toLowerCase()
    return systems.filter(s => {
      const zh = ZH_MAP[s.id]
      return s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (zh && (zh.name.toLowerCase().includes(q) || zh.desc.toLowerCase().includes(q)))
    })
  }, [systems, search])

  const handleSelect = async (id: string) => {
    setSelectedId(id)
    setDesignContent('')
    setPreviewMode('code')
    setApplied(false)
    try {
      const res = await fetch(`${API_BASE}/design-systems/${id}`)
      const data = await res.json()
      setDesignContent(data.content || '')
    } catch (e) {
      console.error('Failed to load design system:', e)
    }
  }

  const handleApply = async () => {
    if (!selectedId) return
    setApplying(true)
    try {
      const res = await fetch(`${API_BASE}/design-systems/${selectedId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir }),
      })
      const data = await res.json()
      if (data.success) {
        setApplied(true)
      }
    } catch (e) {
      console.error('Failed to apply:', e)
    } finally {
      setApplying(false)
    }
  }

  const handleCopy = async () => {
    if (!designContent) return
    try {
      await navigator.clipboard.writeText(designContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // Detail view
  if (selectedId) {
    const system = systems.find(s => s.id === selectedId)
    return (
      <div className="rounded-xl overflow-hidden flex flex-col" style={{
        background: 'var(--bg-elevated, var(--bg-secondary))',
        border: '1px solid var(--border-primary)',
        maxHeight: 480,
        width: '100%',
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle, var(--border-primary))' }}>
          <div className="flex items-center gap-2">
            <button onClick={() => { setSelectedId(null); setDesignContent('') }}
              className="text-xs px-2 py-1 rounded-md transition-colors"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
              {ZH_UI.back}
            </button>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {system ? getLocalizedName(system) : selectedId}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Language toggle */}
            <button onClick={() => setLang(lang === 'en' ? 'cn' : 'en')}
              className="text-xs px-2 py-1 rounded-md font-medium transition-colors mr-1"
              style={{
                background: 'var(--bg-primary)',
                color: 'var(--accent-primary)',
                border: '1px solid var(--border-subtle, var(--border-primary))',
              }}>
              {lang === 'en' ? 'EN' : 'CN'}
            </button>
            {/* Preview mode tabs */}
            {(['code', 'light', 'dark'] as const).map(mode => (
              <button key={mode} onClick={() => setPreviewMode(mode)}
                className="text-xs px-2 py-1 rounded-md transition-colors"
                style={{
                  background: previewMode === mode ? 'var(--accent-primary)' : 'transparent',
                  color: previewMode === mode ? '#fff' : 'var(--text-muted)',
                }}>
                {mode === 'code' ? ZH_UI.code : mode === 'light' ? ZH_UI.light : ZH_UI.dark}
              </button>
            ))}
            <button onClick={onClose} className="ml-2 p-1 rounded-md transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto" style={{ minHeight: 0 }}>
          {previewMode === 'code' ? (
            <pre className="p-4 text-xs leading-relaxed overflow-auto h-full" style={{
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {designContent || 'Loading...'}
            </pre>
          ) : (
            <iframe
              src={`${API_BASE}/design-systems/${selectedId}/preview${previewMode === 'dark' ? '-dark' : ''}`}
              style={{ width: '100%', height: '100%', border: 'none', minHeight: 400 }}
              title={`${selectedId} preview`}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
          style={{ borderTop: '1px solid var(--border-subtle, var(--border-primary))' }}>
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: copied ? 'rgba(34,197,94,0.15)' : 'var(--bg-primary)',
              color: copied ? '#22c55e' : 'var(--text-secondary)',
              border: '1px solid var(--border-subtle, var(--border-primary))',
            }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? ZH_UI.copied : ZH_UI.copy}
          </button>
          <button onClick={handleApply} disabled={applying}
            className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg font-medium transition-colors"
            style={{
              background: applied ? '#22c55e' : 'var(--accent-primary)',
              color: '#fff',
              opacity: applying ? 0.6 : 1,
            }}>
            {applying ? ZH_UI.applying : applied ? ZH_UI.applied : ZH_UI.apply}
          </button>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{
      background: 'var(--bg-elevated, var(--bg-secondary))',
      border: '1px solid var(--border-primary)',
      maxHeight: 480,
      width: '100%',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle, var(--border-primary))' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {ZH_UI.designSystem} ({filtered.length})
          </span>
          <button onClick={() => setLang(lang === 'en' ? 'cn' : 'en')}
            className="text-xs px-2 py-1 rounded-md font-medium transition-colors"
            style={{
              background: 'var(--bg-primary)',
              color: 'var(--accent-primary)',
              border: '1px solid var(--border-subtle, var(--border-primary))',
            }}>
            {lang === 'en' ? 'EN' : 'CN'}
          </button>
        </div>
        <button onClick={onClose} className="p-1 rounded-md transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle, var(--border-primary))' }}>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle, var(--border-primary))' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={ZH_UI.searchPlaceholder}
            className="flex-1 text-xs bg-transparent border-none outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ color: 'var(--text-muted)' }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">{ZH_UI.loading}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-muted)' }}>
            <span className="text-xs">{ZH_UI.noResult}</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {filtered.map(sys => (
              <button
                key={sys.id}
                onClick={() => handleSelect(sys.id)}
                className="text-left p-3 rounded-lg transition-all"
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle, var(--border-primary))',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent-primary)'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle, var(--border-primary))'
                  e.currentTarget.style.transform = 'none'
                }}
              >
                <div className="text-xs font-semibold mb-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {getLocalizedName(sys)}
                </div>
                <div className="text-xs leading-tight line-clamp-2" style={{
                  color: 'var(--text-muted)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {getLocalizedDesc(sys)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
