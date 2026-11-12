interface BoardStashBannerProps {
  /** When the unsaved copy was written to this device. */
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}

/** Offers the unsaved copy kept on this device when it is newer than the stored board. */
export function BoardStashBanner({ savedAt, onRestore, onDiscard }: BoardStashBannerProps) {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-3 bg-white border border-border rounded-xl shadow-lg px-4 py-2.5 font-mono text-[11px] text-ink max-w-[92vw]">
      <span>
        Unsaved changes from {new Date(savedAt).toLocaleString()} are stored on this device.
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="px-2.5 py-1 bg-ink text-white rounded-lg font-semibold uppercase tracking-wide cursor-pointer hover:bg-ink-hover transition-colors"
      >
        Restore unsaved changes
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="px-2.5 py-1 bg-white border border-border rounded-lg font-semibold uppercase tracking-wide cursor-pointer hover:bg-paper transition-colors"
      >
        Discard
      </button>
    </div>
  );
}
