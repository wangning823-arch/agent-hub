import React, { useState } from 'react'

interface FileDiffProps {
  file: string
  diff: string
}

export default function FileDiff({ file, diff }: FileDiffProps) {
  const [expanded, setExpanded] = useState<boolean>(true)

  if (!diff) return null

  const lines: string[] = diff.split('\n')

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2 bg-card cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">📄</span>
          <span className="font-mono text-sm">{file}</span>
        </div>
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="bg-background overflow-x-auto">
          <pre className="text-xs leading-5">
            {lines.map((line: string, idx: number) => {
              let className = ''
              if (line.startsWith('+') && !line.startsWith('+++')) {
                className = 'bg-green-900/30 text-green-300'
              } else if (line.startsWith('-') && !line.startsWith('---')) {
                className = 'bg-red-900/30 text-red-300'
              } else if (line.startsWith('@@')) {
                className = 'text-blue-400'
              }

              return (
                <div key={idx} className={`px-4 ${className}`}>
                  {line || ' '}
                </div>
              )
            })}
          </pre>
        </div>
      )}
    </div>
  )
}
