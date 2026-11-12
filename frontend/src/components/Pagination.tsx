import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  onPrev: () => void;
  onNext: () => void;
  entityName?: string;
  className?: string;
}

export function Pagination({
  page,
  limit,
  total,
  hasPrevPage,
  hasNextPage,
  onPrev,
  onNext,
  entityName = 'ITEMS',
  className,
}: PaginationProps) {
  const from = total > 0 ? (page - 1) * limit + 1 : 0;
  const to = total > 0 ? Math.min(page * limit, total) : 0;
  const label =
    total > 0 ? `SHOWING ${from}–${to} OF ${total} ${entityName}` : `SHOWING 0 OF 0 ${entityName}`;

  return (
    <div
      className={cn(
        'pt-3 border-t border-border-subtle flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs',
        className,
      )}
    >
      <span className="text-ink-muted uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={onPrev}
          disabled={!hasPrevPage}
          className={!hasPrevPage ? 'bg-surface-2 text-ink-subtle' : ''}
        >
          ← PREVIOUS
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={onNext}
          disabled={!hasNextPage}
          className={!hasNextPage ? 'bg-surface-2 text-ink-subtle' : ''}
        >
          NEXT →
        </Button>
      </div>
    </div>
  );
}
