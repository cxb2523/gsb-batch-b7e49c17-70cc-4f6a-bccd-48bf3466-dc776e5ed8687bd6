import { Link } from 'react-router-dom';
import { KeyRound, RefreshCw } from 'lucide-react';
import { describeBlockedReason, type BoardLoadBlockedReason } from '../board-load';
import { ENCRYPTED_CANVAS_LONG_LABEL } from '@/lib/copy';

interface BoardBlockedStateProps {
  reason: BoardLoadBlockedReason;
  workspaceRef: string;
  onRetry: () => void;
}

/** Shown instead of the editor when the board could not be opened; nothing here can save. */
export function BoardBlockedState({ reason, workspaceRef, onRetry }: BoardBlockedStateProps) {
  const { title, message } = describeBlockedReason(reason);

  return (
    <div className="w-full h-full flex items-center justify-center bg-paper p-6">
      <div className="max-w-md w-full bg-white border border-border rounded-2xl shadow-xl p-8 flex flex-col items-center text-center gap-4">
        <div className="w-12 h-12 bg-surface-2 rounded-xl flex items-center justify-center text-ink">
          <KeyRound className="w-6 h-6 text-brand" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-ink font-mono uppercase tracking-tight">
            {title}
          </h2>
          <span className="text-xs text-ink-muted font-mono">{ENCRYPTED_CANVAS_LONG_LABEL}</span>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed font-mono">{message}</p>
        <div className="pt-2 w-full flex flex-col gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-1.5 w-full h-10 bg-ink text-white text-xs font-semibold rounded-xl hover:bg-ink-hover transition-colors font-mono uppercase shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
          <Link
            to={`/w/${workspaceRef}`}
            className="inline-flex items-center justify-center w-full h-10 bg-white border border-border text-ink text-xs font-semibold rounded-xl hover:bg-paper transition-colors font-mono uppercase"
          >
            Return to Workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
