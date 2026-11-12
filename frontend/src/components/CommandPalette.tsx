import { useState, useEffect, useRef } from 'react';
import { Search, Layout, ArrowRight, X } from 'lucide-react';
import { Modal } from '@/components/Modal';

export interface SearchableBoard {
  id: string;
  title: string;
  projectName?: string | undefined;
  updatedAt?: string | undefined;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  boards: SearchableBoard[];
  onSelectBoard: (boardId: string) => void;
}

export function CommandPalette({ isOpen, onClose, boards, onSelectBoard }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filteredBoards = boards.filter(
    (b) =>
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      (b.projectName && b.projectName.toLowerCase().includes(query.toLowerCase())),
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredBoards.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredBoards.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredBoards[selectedIndex]) {
          onSelectBoard(filteredBoards[selectedIndex].id);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredBoards, selectedIndex, onClose, onSelectBoard]);

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      showCloseButton={false}
      className="max-w-lg overflow-hidden p-0 bg-white border border-border shadow-2xl rounded-2xl"
    >
      {/* Search Input Bar */}
      <div className="flex items-center px-4 py-3.5 border-b border-border gap-3 bg-white">
        <Search className="w-4 h-4 text-brand flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or project..."
          className="flex-1 text-xs sm:text-sm bg-transparent outline-none placeholder:text-ink-subtle text-ink font-medium"
        />
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-md hover:bg-brand-subtle text-ink-subtle hover:text-ink flex items-center justify-center transition-colors cursor-pointer"
          aria-label="Close search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Results List */}
      <div className="max-h-80 overflow-y-auto p-2">
        {filteredBoards.length === 0 ? (
          <div className="py-10 text-center text-xs text-ink-subtle font-mono">
            No results found for "{query}"
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="px-3 py-1 font-mono text-[10px] text-ink-muted uppercase tracking-wider font-semibold">
              Results ({filteredBoards.length})
            </div>
            {filteredBoards.map((board, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  type="button"
                  key={board.id}
                  onClick={() => {
                    onSelectBoard(board.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-brand-subtle text-ink font-semibold'
                      : 'text-ink hover:bg-paper'
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-brand-tile text-brand-strong'
                          : 'bg-surface-2 text-ink-muted'
                      }`}
                    >
                      <Layout className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex flex-col truncate">
                      <span className="text-xs truncate">{board.title}</span>
                      {board.projectName && (
                        <span className="text-[10px] text-ink-muted font-mono mt-0.5">
                          {board.projectName}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight
                    className={`w-3.5 h-3.5 text-brand transition-transform ${
                      isSelected ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer shortcuts hint */}
      <div className="px-4 py-2.5 bg-white border-t border-border flex items-center justify-between text-[11px] font-mono text-ink-muted">
        <span className="flex items-center gap-2">
          <span>Navigate with ↑ ↓</span>
          <span>•</span>
          <span>Select with ↵</span>
        </span>
        <kbd className="bg-brand-subtle border border-brand-border text-brand text-[10px] px-1.5 py-0.5 rounded font-mono">
          ESC
        </kbd>
      </div>
    </Modal>
  );
}
