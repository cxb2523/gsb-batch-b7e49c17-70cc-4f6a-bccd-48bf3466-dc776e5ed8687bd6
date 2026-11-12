import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 py-16 text-center max-w-md mx-auto"
    >
      <div className="w-12 h-12 rounded-xl bg-danger-subtle border border-danger-border flex items-center justify-center text-danger">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h2 className="text-base font-bold text-ink tracking-tight">{title}</h2>
      <p className="text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
