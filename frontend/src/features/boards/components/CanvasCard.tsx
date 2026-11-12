import { useEffect, useRef, useState } from 'react';
import { Link as LinkIcon, MoreHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ThumbnailCover } from '@/components/ThumbnailCover';
import { formatRelativeTime } from '@/lib/date';
import type { Board } from '../schemas';

interface CanvasCardProps {
  board: Board;
  projectName: string;
  /** Absolute URL that the "Copy Canvas Link" action puts on the clipboard. */
  canvasUrl: string;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

export function CanvasCard({
  board,
  projectName,
  canvasUrl,
  canDelete,
  onOpen,
  onDelete,
}: CanvasCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (e.target instanceof Node && !menuRef.current?.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMenuOpen]);

  const copyLink = async () => {
    setIsMenuOpen(false);
    try {
      await navigator.clipboard.writeText(canvasUrl);
      toast.success('Canvas link copied to clipboard');
    } catch {
      toast.error('Could not copy the canvas link');
    }
  };

  return (
    <article
      onClick={onOpen}
      className={`border border-border hover:border-border-strong rounded-xl bg-white shadow-2xs hover:shadow-subtle hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group flex flex-col justify-between ${
        isMenuOpen ? 'relative z-30' : 'relative z-10'
      }`}
    >
      <div>
        <ThumbnailCover id={board.id} label={board.title} className="rounded-t-xl" />

        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink group-hover:text-brand transition-colors truncate">
              {board.title}
            </h3>
            <div className="relative" ref={isMenuOpen ? menuRef : undefined}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMenuOpen((prev) => !prev);
                }}
                title="Canvas options"
                aria-label="Canvas options"
                className="text-ink-subtle hover:text-ink transition-colors p-1 rounded hover:bg-surface-2 cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 bg-white border border-border rounded-xl shadow-xl py-1 z-40 font-sans text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => void copyLink()}
                    className="w-full px-3 py-1.5 text-left text-ink-prose hover:bg-paper hover:text-ink flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <LinkIcon className="w-3.5 h-3.5 text-brand" />
                    <span>Copy Canvas Link</span>
                  </button>
                  {canDelete && (
                    <>
                      <div className="border-t border-border-subtle my-1" />
                      <button
                        onClick={() => {
                          setIsMenuOpen(false);
                          onDelete();
                        }}
                        className="w-full px-3 py-1.5 text-left text-danger-muted hover:bg-danger-soft flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-danger-muted" />
                        <span>Delete Canvas</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-muted mt-1 truncate">{projectName}</p>
        </div>
      </div>

      <div className="border-t border-border-subtle px-4 py-2.5 bg-surface rounded-b-xl flex items-center justify-between font-mono text-[10px] text-ink-muted">
        <span>{board.updatedAt ? formatRelativeTime(board.updatedAt) : 'Updated recently'}</span>
        <span className="text-ink font-semibold group-hover:underline">OPEN CANVAS →</span>
      </div>
    </article>
  );
}
