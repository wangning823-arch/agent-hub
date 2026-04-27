import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('React Error:', error, info)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, background: '#1a1a1a', color: '#fff', minHeight: '100vh' }}>
          <h2 style={{ color: '#ef4444' }}>❌ 应用崩溃</h2>
          <pre style={{ background: '#000', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13, color: '#fca5a5' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
