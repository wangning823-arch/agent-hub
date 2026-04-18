import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('React Error:', error, info)
  }
  render() {
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
