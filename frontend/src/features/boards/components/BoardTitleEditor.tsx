import { useRef, useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { errorMessage } from '@/lib/errors';
import { Check, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

interface BoardTitleEditorProps {
  title: string;
  /** Viewers see the title and a badge; they cannot rename. */
  isViewer: boolean;
  /** Stores the new title; rejects when the server refuses it. */
  onRename: (title: string) => Promise<void>;
}

const TITLE_CLASS =
  'text-xs sm:text-sm font-bold text-ink tracking-tight truncate max-w-[200px] sm:max-w-[300px]';

export function BoardTitleEditor({ title, isViewer, onRename }: BoardTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const isRenamingRef = useRef(false);

  const startEditing = () => {
    setDraft(title);
    setIsEditing(true);
  };

  const save = async () => {
    const nextTitle = draft.trim();
    if (isRenamingRef.current) return;
    if (isViewer || !nextTitle || nextTitle === title) {
      setIsEditing(false);
      return;
    }

    isRenamingRef.current = true;
    try {
      await onRename(nextTitle);
    } catch (err) {
      console.error('Failed to update board title', err);
      toast.error(errorMessage(err) ?? 'The canvas could not be renamed.');
    } finally {
      isRenamingRef.current = false;
      setIsEditing(false);
    }
  };

  if (isViewer) {
    return (
      <div className="flex items-center gap-2">
        <h1 className={TITLE_CLASS}>{title || 'Untitled Canvas'}</h1>
        <span className="px-2 py-0.5 bg-warning-subtle text-warning border border-warning-border rounded-md font-mono text-[10px] uppercase font-bold tracking-wider">
          VIEWER
        </span>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          {...NOT_A_CREDENTIAL}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          autoFocus
          className="h-7 px-2 font-mono text-xs font-bold text-ink bg-white border border-brand rounded-lg outline-none"
        />
        <button
          onClick={() => void save()}
          className="p-1 text-ink hover:text-brand cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={startEditing}
      className="group flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-2 cursor-pointer transition-colors"
      title="Click to rename canvas"
    >
      <h1 className={TITLE_CLASS}>{title || 'Untitled Canvas'}</h1>
      <Edit2 className="w-3 h-3 text-brand opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
