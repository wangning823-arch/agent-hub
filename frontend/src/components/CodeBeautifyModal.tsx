import React, { useState, useCallback } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { API_BASE } from '../config'

interface CodeBeautifyModalProps {
  originalCode: string
  language?: string
  filePath?: string
  onClose: () => void
  onApply: (beautifiedCode: string) => void
  onSaveFile?: (code: string) => void
}

type BeautifyLevel = 'light' | 'moderate' | 'aggressive'

const STYLES: { id: string; name: string }[] = [
  { id: 'modern', name: 'Modern' },
  { id: 'glassmorphism', name: 'Glassmorphism' },
  { id: 'neumorphism', name: 'Neumorphism' },
  { id: 'brutalist', name: 'Brutalist' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'minimal', name: 'Minimal' },
]

const LANGUAGES: { id: string; name: string }[] = [
  { id: 'auto', name: 'Auto-detect' },
  { id: 'html', name: 'HTML' },
  { id: 'css', name: 'CSS' },
  { id: 'javascript', name: 'JavaScript' },
  { id: 'typescript', name: 'TypeScript' },
  { id: 'jsx', name: 'JSX' },
  { id: 'tsx', name: 'TSX' },
  { id: 'python', name: 'Python' },
  { id: 'json', name: 'JSON' },
]

function detectLanguage(code: string): string {
  const trimmed = code.trim()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<div') || trimmed.startsWith('<section')) return 'html'
  if (trimmed.includes('import React') || trimmed.includes('from "react"')) return 'tsx'
  if (trimmed.includes('useState') || trimmed.includes('useEffect') || trimmed.includes('jsx')) return 'jsx'
  if (trimmed.match(/:\s*(string|number|boolean|any)\b/)) return 'typescript'
  if (trimmed.includes('def ') || trimmed.includes('import ')) return 'python'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (trimmed.includes('{') && trimmed.includes('}') && trimmed.includes(':')) return 'css'
  return 'javascript'
}

const CodeBeautifyModal: React.FC<CodeBeautifyModalProps> = ({
  originalCode,
  language: initialLanguage,
  filePath,
  onClose,
  onApply,
  onSaveFile,
}) => {
  const [level, setLevel] = useState<BeautifyLevel>('moderate')
  const [style, setStyle] = useState<string>('')
  const [preserveFunctionality, setPreserveFunctionality] = useState(true)
  const [beautifiedCode, setBeautifiedCode] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [leftTab, setLeftTab] = useState<'code' | 'preview'>('code')
  const [rightTab, setRightTab] = useState<'code' | 'preview'>('code')
  const [saving, setSaving] = useState(false)

  // Content-based detection takes priority — a .tsx file may contain pure HTML
  const effectiveLanguage = detectLanguage(originalCode)

  const handleBeautify = useCallback(async () => {
    setLoading(true)
    setError('')
    setBeautifiedCode('')

    try {
      const response = await fetch(`${API_BASE}/ai/beautify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: originalCode,
          language: effectiveLanguage,
          level,
          style: style || undefined,
          preserveFunctionality,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Beautify failed')
      }

      const data = await response.json()
      setBeautifiedCode(data.beautified)
    } catch (err: any) {
      setError(err.message || 'Failed to beautify code')
    } finally {
      setLoading(false)
    }
  }, [originalCode, effectiveLanguage, level, style, preserveFunctionality])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(beautifiedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = beautifiedCode
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const handleApply = () => {
    if (beautifiedCode) {
      onApply(beautifiedCode)
    }
  }

  const handleSaveFile = async () => {
    if (!beautifiedCode || !onSaveFile) return
    setSaving(true)
    try {
      await onSaveFile(beautifiedCode)
    } finally {
      setSaving(false)
    }
  }

  const isPreviewable = effectiveLanguage === 'html' || effectiveLanguage === 'css'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col w-full h-full max-w-[95vw] max-h-[90vh] rounded-xl overflow-hidden"
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
              style={{ background: 'var(--accent-primary-soft, rgba(99,102,241,0.15))', color: 'var(--accent-primary)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                <path d="M20 3v4"/>
                <path d="M22 5h-4"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                AI Code Beautifier
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Beautify your code with AI
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Options Bar */}
        <div
          className="flex items-center gap-3 px-5 py-3 flex-wrap shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
        >
          {/* Level selector */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Level:</label>
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
              {(['light', 'moderate', 'aggressive'] as BeautifyLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className="px-3 py-1 text-xs font-medium transition-colors capitalize"
                  style={{
                    background: level === l ? 'var(--accent-primary)' : 'transparent',
                    color: level === l ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Style dropdown */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Style:</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="text-xs py-1 px-2 rounded-lg border-none focus:outline-none"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
            >
              <option value="">Default</option>
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Language selector */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Language:</label>
            <select
              value={effectiveLanguage}
              onChange={() => {}}
              className="text-xs py-1 px-2 rounded-lg border-none focus:outline-none"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
              disabled
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* Preserve functionality toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={preserveFunctionality}
              onChange={(e) => setPreserveFunctionality(e.target.checked)}
              className="rounded"
              style={{ accentColor: 'var(--accent-primary)' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Preserve functionality</span>
          </label>

          <div className="flex-1" />

          {/* Beautify button */}
          <button
            onClick={handleBeautify}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: loading ? 'var(--bg-hover)' : 'var(--accent-primary)',
              color: '#fff',
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Beautifying...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                  <path d="M20 3v4"/>
                  <path d="M22 5h-4"/>
                </svg>
                Beautify
              </>
            )}
          </button>
        </div>

        {/* Code Comparison Area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Original Code */}
          <div className="flex-1 flex flex-col min-w-0" style={{ borderRight: '1px solid var(--border-subtle)' }}>
            <div
              className="flex items-center justify-between px-4 py-2 shrink-0"
              style={{ background: 'var(--bg-tertiary)' }}
            >
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Original</span>
                {isPreviewable && (
                  <div className="flex ml-3 rounded overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => setLeftTab('code')}
                      className="px-2 py-0.5 text-xs font-medium transition-colors"
                      style={{
                        background: leftTab === 'code' ? 'var(--accent-primary)' : 'transparent',
                        color: leftTab === 'code' ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      Code
                    </button>
                    <button
                      onClick={() => setLeftTab('preview')}
                      className="px-2 py-0.5 text-xs font-medium transition-colors"
                      style={{
                        background: leftTab === 'preview' ? 'var(--accent-primary)' : 'transparent',
                        color: leftTab === 'preview' ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      Preview
                    </button>
                  </div>
                )}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {originalCode.split('\n').length} lines
              </span>
            </div>
            <div className="flex-1 overflow-auto">
              {leftTab === 'preview' && isPreviewable ? (
                <iframe
                  srcDoc={effectiveLanguage === 'css'
                    ? `<html><head><style>${originalCode}</style></head><body><div class="preview-container"><h1>Heading</h1><p>Paragraph text</p><button>Button</button><input placeholder="Input field"/></div></body></html>`
                    : originalCode
                  }
                  sandbox="allow-same-origin"
                  style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                  title="Original Preview"
                />
              ) : (
                <SyntaxHighlighter
                  language={effectiveLanguage}
                  style={oneDark}
                  showLineNumbers
                  wrapLongLines
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    background: 'var(--bg-primary)',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    minHeight: '100%',
                  }}
                  lineNumberStyle={{
                    minWidth: '3em',
                    paddingRight: '1em',
                    color: 'var(--text-muted)',
                    opacity: 0.5,
                  }}
                >
                  {originalCode}
                </SyntaxHighlighter>
              )}
            </div>
          </div>

          {/* Beautified Code */}
          <div className="flex-1 flex flex-col min-w-0">
            <div
              className="flex items-center justify-between px-4 py-2 shrink-0"
              style={{ background: 'var(--bg-tertiary)' }}
            >
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>Beautified</span>
                {beautifiedCode && isPreviewable && (
                  <div className="flex ml-3 rounded overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => setRightTab('code')}
                      className="px-2 py-0.5 text-xs font-medium transition-colors"
                      style={{
                        background: rightTab === 'code' ? 'var(--accent-primary)' : 'transparent',
                        color: rightTab === 'code' ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      Code
                    </button>
                    <button
                      onClick={() => setRightTab('preview')}
                      className="px-2 py-0.5 text-xs font-medium transition-colors"
                      style={{
                        background: rightTab === 'preview' ? 'var(--accent-primary)' : 'transparent',
                        color: rightTab === 'preview' ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      Preview
                    </button>
                  </div>
                )}
              </div>
              {beautifiedCode && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {beautifiedCode.split('\n').length} lines
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--text-muted)' }}>
                  <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-subtle)', borderTopColor: 'var(--accent-primary)' }} />
                  <span className="text-sm">AI is beautifying your code...</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>This may take a few seconds</span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--error)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                  <span className="text-sm font-medium">Beautification Failed</span>
                  <span className="text-xs max-w-[300px] text-center" style={{ color: 'var(--text-muted)' }}>{error}</span>
                  <button
                    onClick={handleBeautify}
                    className="mt-2 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: 'var(--error-soft, rgba(239,68,68,0.1))', color: 'var(--error)' }}
                  >
                    Retry
                  </button>
                </div>
              ) : beautifiedCode ? (
                rightTab === 'preview' && isPreviewable ? (
                  <iframe
                    srcDoc={effectiveLanguage === 'css'
                      ? `<html><head><style>${beautifiedCode}</style></head><body><div class="preview-container"><h1>Heading</h1><p>Paragraph text</p><button>Button</button><input placeholder="Input field"/></div></body></html>`
                      : beautifiedCode
                    }
                    sandbox="allow-same-origin"
                    style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                    title="Preview"
                  />
                ) : (
                  <SyntaxHighlighter
                    language={effectiveLanguage}
                    style={oneDark}
                    showLineNumbers
                    wrapLongLines
                    customStyle={{
                      margin: 0,
                      borderRadius: 0,
                      background: 'var(--bg-primary)',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      minHeight: '100%',
                    }}
                    lineNumberStyle={{
                      minWidth: '3em',
                      paddingRight: '1em',
                      color: 'var(--text-muted)',
                      opacity: 0.5,
                    }}
                  >
                    {beautifiedCode}
                  </SyntaxHighlighter>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--text-muted)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                    <path d="M20 3v4"/>
                    <path d="M22 5h-4"/>
                  </svg>
                  <span className="text-sm">Click "Beautify" to see the result</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {onSaveFile && (
            <button
              onClick={handleSaveFile}
              disabled={!beautifiedCode || saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: beautifiedCode ? 'var(--success, #22c55e)' : 'var(--bg-hover)',
                color: beautifiedCode ? '#fff' : 'var(--text-muted)',
                opacity: beautifiedCode && !saving ? 1 : 0.5,
                cursor: beautifiedCode && !saving ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
              )}
              {saving ? 'Saving...' : 'Save to File'}
            </button>
          )}
          <button
            onClick={handleApply}
            disabled={!beautifiedCode}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: beautifiedCode ? 'var(--accent-primary)' : 'var(--bg-hover)',
              color: beautifiedCode ? '#fff' : 'var(--text-muted)',
              opacity: beautifiedCode ? 1 : 0.5,
              cursor: beautifiedCode ? 'pointer' : 'not-allowed',
            }}
          >
            Apply to Input
          </button>
          <button
            onClick={handleCopy}
            disabled={!beautifiedCode}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: copied ? 'var(--success-soft, rgba(34,197,94,0.15))' : 'var(--bg-hover)',
              color: copied ? 'var(--success)' : beautifiedCode ? 'var(--text-primary)' : 'var(--text-muted)',
              opacity: beautifiedCode ? 1 : 0.5,
              cursor: beautifiedCode ? 'pointer' : 'not-allowed',
            }}
          >
            {copied ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default CodeBeautifyModal
