import {
  Component,
  Fragment,
  createRef,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useI18n } from '../i18n/I18nProvider'
import {
  classifyAppError,
  isChunkLoadError,
  type AppErrorKind,
} from '../lib/clientErrors'
import type { Translate } from '../lib/i18n'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryInnerProps extends AppErrorBoundaryProps {
  t: Translate
}

interface ErrorBoundaryState {
  error: unknown | null
  kind: AppErrorKind | null
  resetKey: number
}

function navigatorOnline(): boolean | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.onLine
}

export function AppErrorBoundary({ children }: AppErrorBoundaryProps) {
  const { t } = useI18n()
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>
}

class ErrorBoundaryInner extends Component<
  ErrorBoundaryInnerProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    kind: null,
    resetKey: 0,
  }

  private readonly headingRef = createRef<HTMLHeadingElement>()
  private lastLoggedError: unknown = null
  private reloadScheduled = false

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return {
      error,
      kind: classifyAppError(error, navigatorOnline()),
    }
  }

  componentDidMount() {
    window.addEventListener('online', this.handleOnline)
    this.focusHeading()
  }

  componentDidUpdate(
    _previousProps: Readonly<ErrorBoundaryInnerProps>,
    previousState: Readonly<ErrorBoundaryState>,
  ) {
    if (previousState.kind === null && this.state.kind !== null) {
      this.focusHeading()
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.lastLoggedError !== error) {
      this.lastLoggedError = error
      console.error('Application render failed', {
        error,
        componentStack: info.componentStack,
      })
    }
    this.focusHeading()
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.handleOnline)
  }

  private focusHeading() {
    this.headingRef.current?.focus()
  }

  private reloadPage = () => {
    if (this.reloadScheduled) return
    this.reloadScheduled = true
    window.location.reload()
  }

  private handleOnline = () => {
    if (this.state.kind === 'connection') this.reloadPage()
  }

  private handleRetry = () => {
    const { error, kind } = this.state
    if (kind === null) return

    if (kind === 'connection' || isChunkLoadError(error)) {
      this.reloadPage()
      return
    }

    this.lastLoggedError = null
    this.reloadScheduled = false
    this.setState((previousState) => ({
      error: null,
      kind: null,
      resetKey: previousState.resetKey + 1,
    }))
  }

  render() {
    const { children, t } = this.props
    const { kind, resetKey } = this.state

    if (kind !== null) {
      const connectionFailure = kind === 'connection'
      const title = connectionFailure
        ? t('Connection interrupted')
        : t('Something went wrong')
      const description = connectionFailure
        ? t('Posterlytics could not connect. Check your internet connection and try again.')
        : t('Posterlytics ran into an unexpected error. Try again or reload the page.')

      return (
        <main className="app-error-screen" data-app-error-screen>
          <section
            className="app-error-content"
            role="alert"
            aria-labelledby="app-error-title"
            aria-describedby="app-error-description"
          >
            <div className="app-error-brand">
              <span className="app-error-brand-mark" aria-hidden="true">P</span>
              <strong>Posterlytics</strong>
            </div>
            <div className="app-error-copy">
              <h1 id="app-error-title" ref={this.headingRef} tabIndex={-1}>
                {title}
              </h1>
              <p id="app-error-description">{description}</p>
            </div>
            <div className="app-error-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={navigatorOnline() === false}
                onClick={this.handleRetry}
              >
                {t('Retry')}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={this.reloadPage}
              >
                {t('Reload page')}
              </button>
            </div>
          </section>
        </main>
      )
    }

    return <Fragment key={resetKey}>{children}</Fragment>
  }
}
