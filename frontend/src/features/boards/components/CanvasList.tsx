import { Pagination } from '@/components/Pagination';
import { formatRelativeTime } from '@/lib/date';
import type { PageInfo } from '@/features/pagination';
import type { Board } from '../schemas';
import { CanvasCard } from './CanvasCard';

interface CanvasListProps {
  boards: Board[];
  pagination: PageInfo;
  projectName: string;
  /** Origin and workspace path that a canvas id is appended to for its shareable link. */
  canvasLinkBase: string;
  canCreate: boolean;
  canDelete: boolean;
  isCreating: boolean;
  onCreate: () => void;
  onOpen: (boardId: string) => void;
  onRequestDelete: (board: Board) => void;
  onPageChange: (page: number) => void;
}

function lastActivityLabel(boards: Board[]): string {
  const newest = boards
    .map((board) => board.updatedAt)
    .filter((updatedAt) => updatedAt !== undefined)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  return newest ? formatRelativeTime(newest) : 'today';
}

export function CanvasList({
  boards,
  pagination,
  projectName,
  canvasLinkBase,
  canCreate,
  canDelete,
  isCreating,
  onCreate,
  onOpen,
  onRequestDelete,
  onPageChange,
}: CanvasListProps) {
  return (
    <>
      <div className="flex items-center gap-2.5 text-xs text-ink-muted mb-6">
        <span>
          <strong className="text-ink font-semibold">
            {pagination.total} {pagination.total === 1 ? 'canvas' : 'canvases'}
          </strong>
        </span>
        <span>·</span>
        <span>
          Last activity{' '}
          <strong className="text-ink font-semibold">{lastActivityLabel(boards)}</strong>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {boards.map((board) => (
          <CanvasCard
            key={board.id}
            board={board}
            projectName={projectName}
            canvasUrl={`${canvasLinkBase}/canvas/${board.id}`}
            canDelete={canDelete}
            onOpen={() => onOpen(board.id)}
            onDelete={() => onRequestDelete(board)}
          />
        ))}

        {canCreate && (
          <div
            role="button"
            tabIndex={0}
            onClick={onCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCreate();
              }
            }}
            className="border-dashed border-2 border-border-strong hover:border-brand bg-surface hover:bg-surface-card-hover rounded-xl min-h-[260px] flex flex-col items-center justify-center text-center p-6 transition-all duration-200 cursor-pointer group select-none"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-subtle text-brand flex items-center justify-center text-2xl font-light mb-2 group-hover:scale-105 transition-transform shadow-2xs">
              ＋
            </div>
            <strong className="text-sm font-semibold text-ink">
              {isCreating ? 'Creating canvas...' : 'Create a canvas'}
            </strong>
            <span className="text-xs text-ink-muted mt-1 max-w-[180px] leading-relaxed">
              Start fresh with an empty canvas and a clear mind.
            </span>
          </div>
        )}
      </div>

      <Pagination
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        hasPrevPage={pagination.hasPrevPage}
        hasNextPage={pagination.hasNextPage}
        onPrev={() => onPageChange(Math.max(1, pagination.page - 1))}
        onNext={() => onPageChange(pagination.page + 1)}
        entityName="CANVASES"
        className="mt-10 pt-4 border-t border-border"
      />
    </>
  );
}
