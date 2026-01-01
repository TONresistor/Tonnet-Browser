/**
 * React Error Boundary component.
 * Catches JavaScript errors in child components and displays fallback UI.
 */

import { Component, ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[React Error Boundary] Caught error:', error)
    console.error('[React Error Boundary] Component stack:', errorInfo.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-background-secondary text-foreground p-8">
          <AlertTriangle className="h-16 w-16 text-red-500 mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-4 text-center max-w-md">
            The application encountered an unexpected error.
            Try reloading to recover.
          </p>
          <code className="text-xs text-red-400 bg-card p-3 rounded mb-6 max-w-lg overflow-auto">
            {this.state.error?.message || 'Unknown error'}
          </code>
          <Button
            onClick={this.handleReload}
            className="bg-primary hover:bg-accent"
            aria-label="Reload the application"
          >
            <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
            Reload Application
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
