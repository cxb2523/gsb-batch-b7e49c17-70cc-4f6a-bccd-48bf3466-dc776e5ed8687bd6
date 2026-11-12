import { useEffect, useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Edit2, ShieldCheck, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/errors';
import { updateWorkspace } from '@/features/workspaces/api';
import { workspaceKeys } from '@/features/workspaces/keys';
import type { Workspace } from '@/features/workspaces/schemas';

const MESSAGE_MS = 3000;

export function WorkspaceDetailsSection({
  workspace,
  canUpdate,
}: {
  workspace: Workspace;
  canUpdate: boolean;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setDraft] = useState<string | null>(null);
  const draft = nameDraft ?? workspace.name;
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(''), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;

    setIsSaving(true);
    setMessage('');
    try {
      const updated = await updateWorkspace(workspace.id, { name: draft.trim() });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      setMessage('Workspace updated successfully!');
      setIsEditing(false);
      // The slug follows the name, so the address bar has to follow it too.
      if (updated.slug !== workspace.slug) {
        void navigate(`/w/${updated.slug}/management`, { replace: true });
      }
    } catch (err) {
      setMessage(errorMessage(err) ?? 'Failed to update workspace');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="general"
      className="scroll-mt-24 sm:scroll-mt-28 bg-white rounded-2xl border border-border shadow-xs p-6 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between border-b border-border-subtle pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand-subtle text-brand flex items-center justify-center font-bold text-xs">
            ▤
          </div>
          <h2 className="text-sm font-bold text-ink">Workspace Details</h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider bg-surface-2 text-ink-muted px-2 py-0.5 rounded-md border border-badge-neutral-border">
          SLUG: {workspace.slug}
        </span>
      </div>

      {message && (
        <div className="p-3 bg-brand-subtle border border-brand-border text-xs rounded-xl font-medium text-brand-strong flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-success" />
          <span>{message}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 py-1">
        <label
          className="text-[11px] font-mono uppercase text-ink-muted font-semibold"
          htmlFor="workspace-name-input"
        >
          Workspace Name
        </label>

        {!isEditing && (
          <div className="flex items-center gap-2">
            <strong className="text-sm font-bold text-ink">{workspace.name || 'Workspace'}</strong>
            {canUpdate && (
              <button
                type="button"
                onClick={() => {
                  setDraft(workspace.name);
                  setIsEditing(true);
                }}
                title="Rename workspace"
                className="text-ink-subtle hover:text-ink p-1 transition-colors cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Always mounted so the current name stays readable by assistive tech and tests. */}
        <form onSubmit={save} className={isEditing ? 'flex items-center gap-2 max-w-sm' : 'hidden'}>
          <Input
            {...NOT_A_CREDENTIAL}
            id="workspace-name-input"
            aria-label="Workspace Name"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            required
            disabled={!canUpdate}
            className="h-7 px-2 text-xs border border-ink rounded-lg outline-none flex-1"
          />
          <button
            type="submit"
            aria-label="Save Changes"
            title="Save Changes"
            disabled={isSaving || !canUpdate}
            className="p-1 bg-ink text-white rounded-md hover:bg-ink-hover cursor-pointer disabled:opacity-60"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            title="Cancel"
            onClick={() => {
              setDraft(workspace.name);
              setIsEditing(false);
            }}
            className="p-1 text-ink-muted hover:bg-surface-2 rounded-md cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </form>

        <p className="text-xs text-ink-muted">A clear name helps your team find the right space.</p>
      </div>
    </div>
  );
}
