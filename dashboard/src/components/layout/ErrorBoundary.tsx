import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  reported: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    componentStack: null,
    reported: false,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? null;
    this.setState({ componentStack });

    // Fire-and-forget: never let reporting itself crash the fallback UI.
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack ?? null,
        componentStack,
        label: this.props.label ?? null,
      }),
    })
      .then(() => this.setState({ reported: true }))
      .catch(() => {
        // Swallow — backend unavailable shouldn't worsen the UX.
      });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReport = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const payload = [
      `Message: ${error.message}`,
      '',
      'Stack:',
      error.stack ?? '(no stack)',
      '',
      'Component stack:',
      componentStack ?? '(no component stack)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(payload);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Clipboard blocked — no-op. Users can still read the stack on-screen.
    }
  };

  render(): ReactNode {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.container} role="alert">
        <div className={styles.card}>
          <AlertTriangle className={styles.icon} size={32} aria-hidden="true" />
          <h2 className={styles.title}>Something went wrong</h2>
          <p className={styles.message}>{error.message || 'An unexpected error occurred.'}</p>
          <div className={styles.actions}>
            <button className={styles.reload} onClick={this.handleReload} type="button">
              Reload
            </button>
            <button className={styles.report} onClick={this.handleReport} type="button">
              {copied ? 'Copied' : 'Report'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
