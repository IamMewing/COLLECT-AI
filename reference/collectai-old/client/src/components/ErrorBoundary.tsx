import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary — catches uncaught render/lifecycle errors and shows a
 * recovery UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[CollectAI ErrorBoundary]', error, errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '40px',
          background: 'var(--paper)',
          flexDirection: 'column',
          gap: '24px',
          textAlign: 'center',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            background: 'var(--red)',
            border: '2px solid var(--ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
          }}>
            ✗
          </div>

          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-title)',
              fontWeight: 800,
              letterSpacing: '-0.01em',
              marginBottom: '8px',
            }}>
              Unexpected Error
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-caption)',
              color: 'var(--muted)',
              maxWidth: '480px',
            }}>
              {this.state.error?.message || 'An unexpected error occurred. Your workspace data is safe.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="primary"
              onClick={this.handleReset}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.href = '/'}
              style={{
                background: 'transparent',
                border: 'var(--stroke)',
                padding: '10px 20px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-caption)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Return to Dashboard
            </button>
          </div>

          {import.meta.env.DEV && this.state.errorInfo && (
            <details style={{
              marginTop: '16px',
              maxWidth: '700px',
              textAlign: 'left',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              color: 'var(--muted)',
              background: 'var(--paper-warm)',
              padding: '16px',
              border: 'var(--stroke-subtle)',
              borderRadius: '3px',
              width: '100%',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                Stack Trace (dev only)
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                {this.state.error?.stack}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
