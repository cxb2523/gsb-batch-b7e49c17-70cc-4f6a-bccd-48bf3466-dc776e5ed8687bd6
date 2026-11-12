import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Workflow } from 'lucide-react';
import { UserNavDropdown } from '@/components/UserNavDropdown';
import { ENCRYPTED_CANVAS_LABEL } from '@/lib/copy';
import type { SyncState } from '../hooks/useBoardSave';
import { BoardSyncStatus } from './BoardSyncStatus';
import { BoardTitleEditor } from './BoardTitleEditor';

interface BoardHeaderProps {
  workspaceRef: string;
  workspaceName: string;
  projectId: string | undefined;
  projectName: string;
  title: string;
  isViewer: boolean;
  syncState: SyncState;
  onRename: (title: string) => Promise<void>;
  onImportMermaid: () => void;
  /** The share control, which owns its own popover. */
  shareControl: ReactNode;
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function BoardHeader({
  workspaceRef,
  workspaceName,
  projectId,
  projectName,
  title,
  isViewer,
  syncState,
  onRename,
  onImportMermaid,
  shareControl,
}: BoardHeaderProps) {
  const workspaceLabel = capitalizeFirst(workspaceName);
  const projectLabel = capitalizeFirst(projectName);

  return (
    <header className="h-14 w-full bg-white/90 backdrop-blur-md border-b border-border px-4 sm:px-6 flex items-center justify-between z-20 flex-shrink-0">
      <div className="flex items-center gap-3">
        <Link
          to={`/w/${workspaceRef}`}
          className="flex items-center gap-1.5 text-xs font-mono font-medium text-ink hover:text-ink bg-white hover:bg-paper border border-border rounded-lg px-2.5 py-1.5 shadow-2xs transition-colors cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-brand" />
          <span className="hidden sm:inline">Back</span>
        </Link>

        <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-muted capitalize">
          <Link
            to={`/w/${workspaceRef}`}
            className="text-ink-muted hover:text-ink font-medium truncate max-w-[120px] transition-colors capitalize"
            title={`Go to ${workspaceLabel} workspace`}
          >
            {workspaceLabel}
          </Link>
          <ChevronRight className="w-3 h-3 text-border-strong flex-shrink-0" />
          <Link
            to={projectId ? `/w/${workspaceRef}?project=${projectId}` : `/w/${workspaceRef}`}
            className="text-ink-muted hover:text-ink font-medium truncate max-w-[140px] transition-colors capitalize"
            title={`Go to ${projectLabel}`}
          >
            {projectLabel}
          </Link>
          <ChevronRight className="w-3 h-3 text-border-strong flex-shrink-0" />
        </div>

        <BoardTitleEditor title={title} isViewer={isViewer} onRename={onRename} />
      </div>

      <div className="hidden lg:flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-ink text-white rounded-full font-mono text-[10px] shadow-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-success-bright animate-pulse"></span>
          <span className="font-bold">E2EE</span>
          <span className="text-[9px] bg-ink-pill-bg text-success-light px-1.5 py-0.5 rounded-full border border-ink-pill-border">
            {ENCRYPTED_CANVAS_LABEL}
          </span>
        </div>
        <BoardSyncStatus isViewer={isViewer} syncState={syncState} />
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {!isViewer && (
          <button
            type="button"
            onClick={onImportMermaid}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border text-xs font-mono font-semibold transition-colors rounded-lg shadow-2xs bg-white hover:bg-paper border-border hover:border-border-strong text-ink cursor-pointer"
            title="Import Mermaid Diagram into Canvas"
          >
            <Workflow className="w-3.5 h-3.5 text-brand" />
            <span className="hidden sm:inline">Import Mermaid</span>
          </button>
        )}

        {shareControl}

        <UserNavDropdown />
      </div>
    </header>
  );
}
