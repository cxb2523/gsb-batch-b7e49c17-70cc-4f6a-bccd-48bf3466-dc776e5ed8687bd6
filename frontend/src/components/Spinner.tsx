import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        'w-6 h-6 border-2 border-border border-t-ink rounded-full animate-spin',
        className,
      )}
    />
  );
}
