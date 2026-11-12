import { Check, Lock } from 'lucide-react';
import type { SyncState } from '../hooks/useBoardSave';

const PILL = 'inline-flex items-center font-mono text-[10px] rounded-full px-2.5 py-0.5 border';

const SYNC_PILLS: Record<SyncState, { label: string; className: string }> = {
  saving: {
    label: 'Saving...',
    className: 'gap-1.5 text-warning bg-warning-subtle border-warning-border',
  },
  saved: {
    label: 'Saved',
    className: 'gap-1 text-brand-strong bg-brand-subtle border-brand-border font-semibold',
  },
  unsaved: {
    label: 'Unsaved',
    className: 'gap-1 text-ink-muted bg-paper border-border font-semibold',
  },
  error: {
    label: 'Save Error',
    className: 'gap-1 text-danger bg-danger-subtle border-danger-border font-semibold',
  },
  'needs-sign-in': {
    label: 'Sign in to save',
    className: 'gap-1 text-warning bg-warning-subtle border-warning-border font-semibold',
  },
};

/** The save state of the canvas, or a read-only badge for someone who cannot edit it. */
export function BoardSyncStatus({
  isViewer,
  syncState,
}: {
  isViewer: boolean;
  syncState: SyncState;
}) {
  if (isViewer) {
    return (
      <span className={`${PILL} gap-1 text-warning bg-warning-subtle border-warning-border`}>
        <Lock className="w-3 h-3 text-warning-amber" />
        <span>Read-Only</span>
      </span>
    );
  }

  const pill = SYNC_PILLS[syncState];
  return (
    <span className={`${PILL} ${pill.className}`}>
      {syncState === 'saving' && (
        <span className="w-1.5 h-1.5 rounded-full bg-warning-dot animate-pulse" />
      )}
      {syncState === 'saved' && <Check className="w-3 h-3 text-success" />}
      <span>{pill.label}</span>
    </span>
  );
}
