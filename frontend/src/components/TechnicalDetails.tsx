import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface TechnicalDetailsProps {
  title?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function TechnicalDetails({
  title = 'Technical details',
  children,
  defaultOpen = false,
  className = '',
}: TechnicalDetailsProps) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-xl border border-border bg-paper/60 p-4 font-mono text-xs text-ink-muted transition-colors open:bg-paper ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-ink select-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-ink-subtle transition-transform duration-200 group-open:rotate-90" />
          <span>{title}</span>
        </span>
      </summary>
      <div className="mt-3.5 space-y-3 pt-3 border-t border-border-subtle text-ink-secondary leading-relaxed font-sans text-xs">
        {children}
      </div>
    </details>
  );
}
