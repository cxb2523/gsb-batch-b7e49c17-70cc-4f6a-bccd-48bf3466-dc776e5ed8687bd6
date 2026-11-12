import { Link } from 'react-router-dom';
import { APP_VERSION } from '@/lib/constants';
import { ENCRYPTED_CHIP, ENCRYPTED_CHIP_TOOLTIP } from '@/lib/copy';

interface BoardFooterProps {
  isViewer: boolean;
  /** The caller's project role, which says why a viewer cannot edit. */
  accessRole: string | null;
  isGridOn: boolean;
}

export function BoardFooter({ isViewer, accessRole, isGridOn }: BoardFooterProps) {
  return (
    <footer className="h-9 w-full bg-white/95 backdrop-blur-md border-t border-border grid grid-cols-2 md:grid-cols-5 divide-x divide-border font-mono text-[11px] text-ink-muted z-20 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-1">
        <span className={`w-1.5 h-1.5 ${isViewer ? 'bg-amber-500' : 'bg-success'} rounded-full`} />
        <span className="text-ink font-medium">
          {isViewer ? 'MODE: VIEWER (READ-ONLY)' : 'MODE: EDITING (READY)'}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1">
        <span className="text-ink-subtle">⌖</span>
        {!isViewer ? (
          <Link
            to="/security"
            target="_blank"
            rel="noopener noreferrer"
            title={ENCRYPTED_CHIP_TOOLTIP}
            className="hover:text-ink transition-colors"
          >
            KEY: {ENCRYPTED_CHIP.toUpperCase()}
          </Link>
        ) : (
          <span>
            {accessRole === 'viewer' ? 'ACCESS: PROJECT VIEWER' : 'ACCESS: WORKSPACE VIEWER'}
          </span>
        )}
      </div>
      <div className="hidden md:flex items-center gap-2 px-3 py-1">
        <span>{isViewer ? 'AUTOSAVE: DISABLED (READ-ONLY)' : 'AUTOSAVE: ON STROKE END'}</span>
      </div>
      <div className="hidden md:flex items-center gap-2 px-3 py-1">
        <span>{isGridOn ? 'GRID: 20PX SNAP' : 'GRID: OFF'}</span>
      </div>
      <div className="hidden md:flex items-center justify-between px-3 py-1 text-ink-muted">
        <span>ENGINE: EXCALIDRAW</span>
        <span className="text-ink font-bold">CANVHQ {APP_VERSION.toUpperCase()}</span>
      </div>
    </footer>
  );
}
