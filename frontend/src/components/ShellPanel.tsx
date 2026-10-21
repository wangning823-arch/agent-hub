import React, { useState, useRef, useEffect } from 'react'
import { IconClear } from './Icons'

const API_BASE = '/api'
const MAX_VISIBLE_LINES = 500
const MAX_HISTORY = 100

interface ShellLine {
  type: 'cmd' | 'out' | 'err' | 'info'
  text: string
}

interface ShellPanelProps {
  workdir?: string
}

export default function ShellPanel({ workdir }: ShellPanelProps) {
  const [lines, setLines] = useState<ShellLine[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const appendLines = (newLines: ShellLine[]) => {
    setLines(prev => [...prev, ...newLines].slice(-MAX_VISIBLE_LINES))
  }

  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  useEffect(() => {
    if (!workdir) return
    appendLines([{ type: 'info', text: `工作目录: ${workdir}` }])
    // 仅在切换目录时提示，不重复执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workdir])

  const postExec = async (command: string, confirm?: boolean) => {
    const res = await fetch(`${API_BASE}/shell/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workdir, command, confirm })
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true as const, data }
    if (res.status === 403 && data.needsConfirm) {
      const accepted = window.confirm(`${data.error}\n\n命令：${command}\n\n确定要执行吗？`)
      if (accepted) return postExec(command, true)
      return { ok: false as const, error: '已取消执行' }
    }
    return { ok: false as const, error: data.error || data.output || `请求失败 (${res.status})` }
  }

  const run = async (rawCommand?: string) => {
    const command = (rawCommand ?? input).trim()
    if (!command || running) return

    setInput('')
    setHistoryIdx(-1)
    setHistory(prev => [command, ...prev.filter(c => c !== command)].slice(0, MAX_HISTORY))
    appendLines([{ type: 'cmd', text: command }])
    setRunning(true)

    try {
      const result = await postExec(command)
      if (result.ok) {
        const { output, exitCode, timedOut } = result.data
        const outLines: ShellLine[] = []
        if (output) {
          outLines.push(...String(output).split('\n').map(text => ({ type: 'out' as const, text })))
        }
        if (!timedOut && exitCode !== null && exitCode !== undefined) {
          outLines.push({ type: exitCode === 0 ? 'info' : 'err', text: `[退出码 ${exitCode}]` })
        }
        if (outLines.length === 0) outLines.push({ type: 'info', text: '(无输出)' })
        appendLines(outLines)
      } else {
        appendLines([{ type: 'err', text: result.error }])
      }
    } catch (error: any) {
      appendLines([{ type: 'err', text: '请求失败: ' + error.message }])
    } finally {
      setRunning(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const next = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(next)
      setInput(history[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyIdx - 1
      if (next < 0) {
        setHistoryIdx(-1)
        setInput('')
      } else {
        setHistoryIdx(next)
        setInput(history[next])
      }
    }
  }

  const lineColor = (type: ShellLine['type']) => {
    switch (type) {
      case 'cmd': return 'var(--text-primary)'
      case 'err': return 'var(--error)'
      case 'info': return 'var(--text-muted)'
      default: return 'var(--text-secondary)'
    }
  }

  const promptLabel = workdir ? (workdir.split('/').filter(Boolean).pop() || workdir) : '~'

  return (
    <div className="flex flex-col">
      {/* Output */}
      <div
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        className="mx-3 mb-2 p-2 rounded-lg overflow-y-auto cursor-text"
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-subtle)',
          minHeight: 120,
          maxHeight: '40vh',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 11,
          lineHeight: 1.5
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>输入命令并回车执行（↑↓ 翻阅历史）</div>
        ) : (
          lines.map((line, idx) => (
            <div
              key={idx}
              className="whitespace-pre-wrap break-all"
              style={{ color: lineColor(line.type) }}
            >
              {line.type === 'cmd' ? `> ${line.text}` : line.text}
            </div>
          ))
        )}
        {running && <div style={{ color: 'var(--text-muted)' }}>执行中...</div>}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 flex items-center gap-2">
        <span
          className="text-xs flex-shrink-0"
          style={{ color: 'var(--success)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
          title={workdir || '家目录'}
        >
          {promptLabel} $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={running ? '执行中...' : '输入 shell 命令'}
          disabled={running}
          className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none"
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          onClick={() => run()}
          disabled={running || !input.trim()}
          className="btn-secondary px-2 py-1.5 text-xs"
          title="执行命令"
        >
          ▶
        </button>
        <button
          onClick={() => setLines([])}
          className="btn-icon w-7 h-7"
          title="清空输出"
        >
          <IconClear />
        </button>
      </div>
    </div>
  )
}
