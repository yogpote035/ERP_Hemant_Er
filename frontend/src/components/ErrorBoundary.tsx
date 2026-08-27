import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './ui/Button'

interface Props {
  children: ReactNode
  /** Shown in the fallback so the user knows what failed. */
  routeName?: string
  /** Inline (in-route) fallback rather than a full-screen takeover. */
  compact?: boolean
}

interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors so one broken screen can't blank the whole app.
 * `compact` mode renders an in-route card; otherwise a centered full-screen panel.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No backend to report to — log for the dev console.
    console.error(`[ErrorBoundary${this.props.routeName ? ` · ${this.props.routeName}` : ''}]`, error, info)
  }

  reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const body = (
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 rounded-full bg-danger/15 p-3 text-danger">
          <AlertTriangle size={28} aria-hidden />
        </div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 max-w-md text-sm text-muted">
          {this.props.routeName ? `The “${this.props.routeName}” screen` : 'This screen'} hit an
          unexpected error. Your saved data is safe.
        </p>
        <pre className="mt-3 max-w-md overflow-x-auto rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-fg">
          {error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" leftIcon={<RotateCcw size={16} />} onClick={this.reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>
      </div>
    )

    if (this.props.compact) return <div className="card">{body}</div>
    return <div className="flex min-h-[60vh] items-center justify-center p-6">{body}</div>
  }
}
