import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
  stack: string | null;
}

/**
 * A crash anywhere in the tree used to leave an empty window with no clue what
 * happened. Showing the error — and where it came from — is worth far more than
 * a blank canvas.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Also goes to the devtools console for the full stack.
    console.error('VSM Translator crashed:', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <h1>Something broke.</h1>
        <p className="crash-message">{error.message}</p>
        {stack && <pre className="crash-stack">{stack.trim()}</pre>}
        <p className="muted">
          Your projects are untouched — they live as JSON files in{' '}
          <code>~/.vsm-translator/projects/</code>. Reload with ⌘R, or open the developer
          tools from the View menu for the full stack.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
