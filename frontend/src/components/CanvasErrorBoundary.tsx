import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  onReset?: () => void;
  getBackupData?: () => unknown;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class CanvasErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Canvas crash caught by CanvasErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  private handleExportBackup = () => {
    try {
      const backupData = this.props.getBackupData ? this.props.getBackupData() : null;
      const dataStr = JSON.stringify(backupData || { error: 'No scene data available' }, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `canvhq-emergency-backup-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export emergency backup:', e);
      toast.error('Could not export the emergency backup.');
    }
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-paper p-6 select-text">
          <div className="max-w-md w-full bg-white border border-border rounded-2xl shadow-xl p-6 sm:p-8 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-danger-subtle border border-danger-border flex items-center justify-center text-danger">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-bold text-ink font-sans tracking-tight">
                Canvas Rendering Error
              </h2>
              <span className="text-xs text-ink-muted font-sans">
                The diagram engine encountered an unexpected runtime failure.
              </span>
            </div>
            {this.state.error?.message && (
              <div className="w-full p-3 bg-danger-soft border border-danger-soft-border rounded-xl text-left font-mono text-[11px] text-danger-muted max-h-24 overflow-y-auto break-all">
                {this.state.error.message}
              </div>
            )}
            <div className="pt-2 w-full flex flex-col sm:flex-row gap-2.5">
              <Button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center justify-center gap-1.5 flex-1 h-10 font-mono text-xs uppercase"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload Canvas</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={this.handleExportBackup}
                className="inline-flex items-center justify-center gap-1.5 flex-1 h-10 font-mono text-xs uppercase"
              >
                <Download className="w-3.5 h-3.5 text-brand" />
                <span>Export Emergency Backup</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
