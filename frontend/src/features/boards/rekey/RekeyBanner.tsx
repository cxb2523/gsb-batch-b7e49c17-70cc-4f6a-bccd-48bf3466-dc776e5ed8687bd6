import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { RekeyJob } from './useRekeyJob';

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function Line({ tone, children }: { tone: 'warning' | 'neutral'; children: ReactNode }) {
  const colours =
    tone === 'warning'
      ? 'bg-warning-subtle border-warning-border text-warning'
      : 'bg-surface-2 border-border text-ink-muted';
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-xs ${colours}`}
    >
      {children}
    </div>
  );
}

/** Progress of the background re-key for administrators: running, paused, failed, or left alone. */
export function RekeyBanner({ job }: { job: RekeyJob }) {
  const { status, progress, skippedPublic } = job;
  const failed = progress?.failed ?? 0;
  // A finished run is announced once as a toast; what stays on the page is only what needs action.
  const hasLine =
    status === 'running' || status === 'paused' || status === 'failed' || skippedPublic > 0;
  if (!hasLine) return null;

  return (
    <div className="flex flex-col gap-2 mb-5">
      {status === 'running' && progress && (
        <Line tone="warning">
          <span>
            Securing boards: {Math.min(progress.done + 1, progress.total)} of {progress.total}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={job.pause}>
            Pause
          </Button>
        </Line>
      )}
      {status === 'paused' && (
        <Line tone="warning">
          <span>Securing boards is paused.</span>
          <Button type="button" variant="outline" size="sm" onClick={job.resume}>
            Resume
          </Button>
        </Line>
      )}
      {status === 'failed' && (
        <Line tone="warning">
          <span>
            {failed > 0
              ? `${failed} ${plural(failed, 'board', 'boards')} could not be secured. They stay readable and are tried again on your next visit.`
              : 'Securing boards stopped. They stay readable and are tried again on your next visit.'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={job.retry}>
            Retry
          </Button>
        </Line>
      )}
      {skippedPublic > 0 && (
        <Line tone="neutral">
          <span>
            {skippedPublic === 1
              ? '1 board with a public link keeps its current key. Turn the link off to secure it.'
              : `${skippedPublic} boards with public links keep their current key. Turn the links off to secure them.`}
          </span>
        </Line>
      )}
    </div>
  );
}
