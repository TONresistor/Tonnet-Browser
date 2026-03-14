/**
 * React entry point.
 * Mounts the App component to the DOM with error boundary.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/globals.css'
import { createLogger } from '@/logger'

const log = createLogger('app')

// Global error handlers for renderer process
window.addEventListener('error', (event) => {
  log.error('[Window Error]', event.error?.message || event.message)
  log.error('[Window Error] Stack:', event.error?.stack)
})

window.addEventListener('unhandledrejection', (event) => {
  log.error('[Unhandled Promise Rejection]', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
