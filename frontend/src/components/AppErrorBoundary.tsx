import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/ErrorState';

interface State {
  hasError: boolean;
}

/** Last line of defence for the whole app; the canvas keeps its own boundary with a backup export. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info);
  }

  public override render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <ErrorState
          message="An unexpected error stopped this page. Reloading usually fixes it."
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}
