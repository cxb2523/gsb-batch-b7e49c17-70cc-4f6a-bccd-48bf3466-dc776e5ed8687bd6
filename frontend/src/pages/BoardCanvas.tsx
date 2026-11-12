import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { authClient, useSession } from '@/lib/auth-client';
import { MermaidImportModal } from '@/components/MermaidImportModal';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { useAccess } from '@/hooks/useAccess';
import { useWorkspace } from '@/features/workspaces/queries';
import { updateBoard } from '@/features/boards/api';
import { isEditable } from '@/features/boards/board-load';
import { boardKeys } from '@/features/boards/keys';
import type { BoardMetadata } from '@/features/boards/board-metadata';
import { useBoard } from '@/features/boards/queries';
import type { Board } from '@/features/boards/schemas';
import { useBoardSession } from '@/features/boards/hooks/useBoardSession';
import { BoardBlockedState } from '@/features/boards/components/BoardBlockedState';
import { BoardConflictBanner } from '@/features/boards/components/BoardConflictBanner';
import { BoardEditor } from '@/features/boards/components/BoardEditor';
import { BoardFooter } from '@/features/boards/components/BoardFooter';
import { BoardHeader } from '@/features/boards/components/BoardHeader';
import { BoardLeaveDialog } from '@/features/boards/components/BoardLeaveDialog';
import { BoardSharePanel } from '@/features/boards/components/BoardSharePanel';
import { BoardStashBanner } from '@/features/boards/components/BoardStashBanner';
import { ApiError } from '@/lib/http';

/** Statuses that mean this board is not for this caller; the page leaves instead of showing an error. */
const LEAVE_STATUSES = [401, 403, 404];

export function BoardCanvas() {
  const { slug, boardId } = useParams<{ slug: string; boardId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const hasSession = Boolean(session?.user);
  const [isMermaidModalOpen, setIsMermaidModalOpen] = useState(false);

  const {
    data: board,
    error: boardError,
    isFetchedAfterMount,
    refetch: refetchBoard,
  } = useBoard(slug, boardId);
  // The copy from an earlier visit may predate the last save, so the header may show it but the
  // canvas opens only from what the server said just now. Otherwise a saved board would open as an
  // empty new one. A later refetch that fails leaves the record the canvas was opened from.
  const [fetchedBoard, setFetchedBoard] = useState<BoardMetadata>();
  if (isFetchedAfterMount && !boardError && board && board !== fetchedBoard) {
    setFetchedBoard(board);
  }
  const { data: workspace } = useWorkspace(slug);
  const { can, role: accessRole, isAdministrator } = useAccess(slug, board?.projectId);
  const canvas = useBoardSession({
    workspaceRef: slug,
    boardId,
    board: fetchedBoard?.id === boardId ? fetchedBoard : undefined,
    canEdit: can('update', 'Board'),
    refreshBoard: refetchBoard,
  });

  const activeOrgId = workspace?.id ?? board?.project.organizationId ?? '';

  // Better Auth keeps its own notion of the active organization; keep it on the one this canvas belongs to.
  useEffect(() => {
    if (!activeOrgId) return;
    // Best effort: requests carry the workspace explicitly, so a stale active organization is harmless.
    void authClient.organization.setActive({ organizationId: activeOrgId }).catch(() => {});
  }, [activeOrgId]);

  const leavesPage = boardError instanceof ApiError && LEAVE_STATUSES.includes(boardError.status);

  useEffect(() => {
    if (!(boardError instanceof ApiError) || !leavesPage) return;
    if (boardError.status === 401 && !hasSession) {
      void navigate('/login');
      return;
    }
    toast.error(
      boardError.status === 404 ? 'Canvas not found' : 'You do not have access to this canvas',
    );
    void navigate(`/w/${slug}`);
  }, [boardError, leavesPage, hasSession, slug, navigate]);

  const renameBoard = async (title: string) => {
    if (!slug || !boardId) return;
    const updated = await updateBoard(slug, boardId, { title });
    queryClient.setQueryData<Board>(boardKeys.detail(slug, boardId), (cached) =>
      cached ? { ...cached, title: updated.title } : cached,
    );
    // The dashboard lists show this title too; they are keyed by workspace id, not the URL slug.
    void queryClient.invalidateQueries({ queryKey: boardKeys.lists(activeOrgId) });
  };

  const workspaceName = board?.project.organization?.name || workspace?.name || slug || 'Workspace';
  const showBoardError = boardError && !leavesPage && !isEditable(canvas.loadOutcome);

  const renderMain = () => {
    if (canvas.loadOutcome?.kind === 'blocked') {
      return (
        <BoardBlockedState
          reason={canvas.loadOutcome.reason}
          workspaceRef={slug ?? ''}
          onRetry={canvas.retryLoad}
        />
      );
    }
    if (showBoardError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-paper">
          <ErrorState
            title="Canvas details could not be loaded"
            message="The canvas details could not be fetched just now. Check your connection and try again."
            onRetry={() => void refetchBoard()}
          />
        </div>
      );
    }
    if (canvas.isCanvasLoading || !isEditable(canvas.loadOutcome)) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-paper">
          <LoadingState message="Decrypting spatial architecture canvas..." />
        </div>
      );
    }
    return (
      <BoardEditor
        apiRef={canvas.excalidrawApiRef}
        initialData={canvas.initialData}
        isViewer={canvas.isViewer}
        onChange={canvas.handleCanvasChange}
      />
    );
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-paper overflow-hidden select-none font-sans antialiased">
      <BoardHeader
        workspaceRef={slug ?? ''}
        workspaceName={workspaceName}
        projectId={board?.projectId}
        projectName={board?.project.name || 'Project'}
        title={board?.title ?? ''}
        isViewer={canvas.isViewer}
        syncState={canvas.syncState}
        onRename={renameBoard}
        onImportMermaid={() => setIsMermaidModalOpen(true)}
        shareControl={
          slug && boardId && can('share', 'Board') ? (
            <BoardSharePanel
              workspaceRef={slug}
              boardId={boardId}
              publicShareToken={board?.publicShareToken ?? null}
              cryptoKey={canvas.cryptoKey}
              canManageMembers={isAdministrator}
            />
          ) : null
        }
      />

      <main className="flex-1 w-full h-[calc(100vh-48px)] relative">
        {canvas.pendingStash && isEditable(canvas.loadOutcome) && !canvas.isCanvasLoading && (
          <BoardStashBanner
            savedAt={canvas.pendingStash.savedAt}
            onRestore={() => void canvas.restoreStash()}
            onDiscard={() => void canvas.discardStash()}
          />
        )}
        {canvas.conflict && (
          <BoardConflictBanner
            onReload={() => void canvas.resolveConflictReload()}
            onOverwrite={() => void canvas.resolveConflictOverwrite()}
          />
        )}
        {renderMain()}
      </main>

      <BoardFooter
        isViewer={canvas.isViewer}
        accessRole={accessRole}
        isGridOn={canvas.initialData?.appState?.gridModeEnabled !== false}
      />

      {canvas.leaveGuard.state === 'blocked' && (
        <BoardLeaveDialog onStay={canvas.leaveGuard.reset} onLeave={canvas.leaveGuard.proceed} />
      )}

      <MermaidImportModal
        isOpen={isMermaidModalOpen}
        onClose={() => setIsMermaidModalOpen(false)}
        onImport={canvas.importMermaid}
      />
    </div>
  );
}
