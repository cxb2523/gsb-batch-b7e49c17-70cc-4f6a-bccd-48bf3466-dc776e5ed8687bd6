import { AlertTriangle } from 'lucide-react';

interface BoardConflictBannerProps {
  onReload: () => void;
  onOverwrite: () => void;
}

/**
 * Non-blocking banner shown when a save conflict occurs (409 BOARD_CONFLICT, Batch 17 Decision 4).
 * Offers Reload (load server version; local work stays in stash banner) or Overwrite (resaves on top).
 */
export function BoardConflictBanner({ onReload, onOverwrite }: BoardConflictBannerProps) {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-3 bg-white border border-amber-300 rounded-xl shadow-lg px-4 py-2.5 font-mono text-[11px] text-ink max-w-[92vw]">
      <div className="flex items-center gap-1.5 text-amber-700 font-medium">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <span>This canvas was changed elsewhere.</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReload}
          className="px-2.5 py-1 bg-ink text-white rounded-lg font-semibold uppercase tracking-wide cursor-pointer hover:bg-ink-hover transition-colors"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={onOverwrite}
          className="px-2.5 py-1 bg-white border border-border rounded-lg font-semibold uppercase tracking-wide cursor-pointer hover:bg-paper transition-colors"
        >
          Overwrite
        </button>
      </div>
    </div>
  );
}
