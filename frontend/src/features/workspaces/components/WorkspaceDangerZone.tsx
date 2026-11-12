import { useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/errors';
import { useInvalidateUserMetrics } from '@/features/user/queries';
import { deleteWorkspace } from '@/features/workspaces/api';
import type { Workspace } from '@/features/workspaces/schemas';

function DeleteWorkspaceModal({
  workspace,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const invalidateUserMetrics = useInvalidateUserMetrics();
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const matches = confirmation.trim() === workspace.name.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;

    setIsDeleting(true);
    setError('');
    try {
      await deleteWorkspace(workspace.id);
      onClose();
      invalidateUserMetrics();
      void navigate('/workspace');
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to delete workspace. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      showCloseButton={false}
      titleId="delete-workspace-title"
      className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-border p-6 flex flex-col gap-4 relative font-sans"
    >
      <div className="flex items-start justify-between border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <h3 id="delete-workspace-title" className="text-base font-bold text-ink">
            Delete Workspace
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-subtle hover:text-ink p-1 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-ink-muted leading-relaxed">
        This action <strong className="text-danger font-semibold">cannot be undone</strong>. This
        will permanently delete the workspace{' '}
        <strong className="text-ink font-semibold">{workspace.name}</strong>, all associated
        projects, canvases, and encrypted payloads stored in cloud storage.
      </p>

      {error && (
        <div className="p-3 bg-danger-subtle border border-danger-border text-danger text-xs rounded-xl font-medium">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-delete-input" className="text-xs text-ink-muted font-medium">
            To confirm, please type{' '}
            <strong className="font-mono text-ink font-bold selection:bg-border">
              {workspace.name}
            </strong>{' '}
            below:
          </Label>
          <Input
            {...NOT_A_CREDENTIAL}
            id="confirm-delete-input"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={workspace.name}
            autoFocus
            required
            className="h-9 px-3 bg-paper border border-border rounded-xl text-xs text-ink outline-none focus:bg-white focus:border-danger font-medium"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button variant="outline" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" type="submit" disabled={!matches || isDeleting}>
            Permanently Delete Workspace
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkspaceDangerZone({
  workspace,
  canDelete,
  projectCount,
  boardCount,
}: {
  workspace: Workspace;
  canDelete: boolean;
  projectCount: number;
  boardCount: number;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div
      id="danger"
      className="scroll-mt-24 sm:scroll-mt-28 bg-white rounded-2xl border border-danger-border shadow-xs p-6 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between border-b border-danger-light pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-danger-subtle text-danger flex items-center justify-center font-bold text-xs">
            △
          </div>
          <h2 className="text-sm font-bold text-danger">Danger Zone</h2>
        </div>
        <span className="font-mono text-[10px] bg-danger-subtle text-danger border border-danger-border px-2 py-0.5 rounded-md font-semibold">
          IRREVERSIBLE
        </span>
      </div>

      {canDelete ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="flex flex-col gap-1 max-w-xl">
            <span className="text-xs font-semibold text-ink">Delete this workspace</span>
            <p className="text-xs text-ink-muted leading-relaxed">
              Permanently delete <strong className="text-ink">{workspace.name}</strong>, including
              all {projectCount} project
              {projectCount === 1 ? '' : 's'}, {boardCount} canvas
              {boardCount === 1 ? '' : 'es'}, and associated encrypted files.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="h-9 px-4 bg-danger hover:bg-danger-hover text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto shadow-xs"
          >
            Delete Workspace
          </button>
        </div>
      ) : (
        <div className="p-3 bg-paper border border-border text-ink-muted text-xs rounded-xl flex items-center justify-between gap-3">
          <span>Only the workspace owner can delete this workspace.</span>
          <span className="font-mono text-[10px] text-ink-subtle uppercase font-semibold">
            Owner permission required
          </span>
        </div>
      )}

      {isModalOpen && (
        <DeleteWorkspaceModal workspace={workspace} onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}
