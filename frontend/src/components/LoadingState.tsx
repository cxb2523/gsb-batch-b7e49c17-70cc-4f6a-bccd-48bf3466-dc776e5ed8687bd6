import { Spinner } from '@/components/Spinner';

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Spinner />
      <p className="text-sm text-ink-muted">{message}</p>
    </div>
  );
}
