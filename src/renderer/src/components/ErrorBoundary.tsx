/**
 * React Error Boundary component.
 * Catches JavaScript errors in child components and displays fallback UI.
 */

import { Component, ReactNode } from 'react'
import { TriangleAlert, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/logger'
import i18n from '@/i18n'

const log = createLogger('app')

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
    log.error('Caught error:', error)
    log.error('Component stack:', errorInfo.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-background-secondary text-foreground p-8">
          <TriangleAlert className="h-16 w-16 text-destructive mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-heading mb-2">{i18n.t('error.title')}</h1>
          <p className="text-muted-foreground mb-4 text-center max-w-md">{i18n.t('error.description')}</p>
          <code className="text-xs text-destructive bg-destructive/10 p-3 rounded mb-6 max-w-lg overflow-auto">
            {this.state.error?.message || 'Unknown error'}
          </code>
          <Button
            onClick={this.handleReload}
            className="bg-primary hover:bg-accent"
            aria-label="Reload the application"
          >
            <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
            {i18n.t('error.reload')}
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
