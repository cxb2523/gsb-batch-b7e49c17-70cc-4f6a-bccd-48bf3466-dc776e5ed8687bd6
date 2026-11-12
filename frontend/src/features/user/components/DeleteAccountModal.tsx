import { useState } from 'react';
import { NOT_A_CREDENTIAL } from '@/lib/form-attributes';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { signOut } from '@/lib/auth-client';
import { clearLocalKeyMaterial } from '@/lib/key-store';
import { errorMessage } from '@/lib/errors';
import { ErrorState } from '@/components/ErrorState';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectChevronStyle } from '@/features/workspaces/components/selectChevronStyle';
import { deleteUserAccount } from '../api';
import { useOwnedWorkspaces } from '../queries';
import type { OwnedWorkspace } from '../schemas';

function memberCount(workspace: OwnedWorkspace) {
  return workspace.totalMembersCount ?? workspace.otherMembers.length + 1;
}

interface DeleteAccountModalProps {
  onClose: () => void;
}

/** Rendered only while open, so the owned-workspaces query refetches each time it opens. */
export function DeleteAccountModal({ onClose }: DeleteAccountModalProps) {
  const navigate = useNavigate();
  const { data: ownedWorkspaces = [], isPending, isError, error, refetch } = useOwnedWorkspaces();
  // Successor choices the user changed; every other workspace defaults to its first other member.
  const [chosenSuccessors, setChosenSuccessors] = useState<Record<string, string>>({});
  const [confirmSoleDeletion, setConfirmSoleDeletion] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const successorFor = (workspace: OwnedWorkspace) =>
    chosenSuccessors[workspace.id] ?? workspace.otherMembers[0]?.id ?? '';
  const hasSoleMemberWorkspaces = ownedWorkspaces.some((ws) => ws.otherMembers.length === 0);

  const handleConfirmDelete = async () => {
    if (confirmText !== 'DELETE') {
      setDeleteError('Please type "DELETE" to confirm account deletion.');
      return;
    }
    if (hasSoleMemberWorkspaces && !confirmSoleDeletion) {
      setDeleteError('Please confirm deletion of your sole-member workspace(s).');
      return;
    }

    const transfers: Record<string, string> = {};
    for (const ws of ownedWorkspaces) {
      if (ws.otherMembers.length > 0) transfers[ws.id] = successorFor(ws);
    }

    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteUserAccount({ transfers, confirmSoleDeletion });
      await clearLocalKeyMaterial();
      await signOut();
      void navigate('/login');
      window.location.href = '/login';
    } catch (err) {
      setDeleteError(errorMessage(err) ?? 'Failed to delete account.');
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
      className="max-w-lg w-full p-6 flex flex-col gap-4 font-sans max-h-[90vh] overflow-y-auto bg-white border border-border rounded-2xl shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2 text-danger font-bold text-sm">
          <AlertTriangle className="w-4 h-4" />
          <span>Delete Account & Transfer Workspaces</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-ink-subtle hover:text-ink p-1 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {deleteError && (
        <div
          role="alert"
          className="p-3 bg-danger-subtle border border-danger-border text-danger text-xs rounded-xl font-medium"
        >
          {deleteError}
        </div>
      )}

      {isPending ? (
        <div className="py-8 text-center font-mono text-xs text-ink-subtle">
          Checking owned workspaces...
        </div>
      ) : isError ? (
        <ErrorState
          message={errorMessage(error) ?? 'Could not check the workspaces you own.'}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {ownedWorkspaces.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-ink-muted">
                You are an <strong>Owner</strong> of the following workspace(s). Before deleting
                your account, select a successor for each workspace:
              </p>

              <div className="flex flex-col gap-3">
                {ownedWorkspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="p-3.5 bg-paper rounded-xl border border-border flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-ink">{ws.name}</span>
                      <span className="font-mono text-[10px] text-ink-subtle">
                        {memberCount(ws)} member{memberCount(ws) === 1 ? '' : 's'}
                      </span>
                    </div>

                    {ws.otherMembers.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <label
                          className="text-[11px] font-semibold text-ink"
                          htmlFor={`transfer-${ws.id}`}
                        >
                          Transfer ownership to:
                        </label>
                        <select
                          id={`transfer-${ws.id}`}
                          value={successorFor(ws)}
                          onChange={(e) =>
                            setChosenSuccessors((prev) => ({ ...prev, [ws.id]: e.target.value }))
                          }
                          className="h-8 px-2.5 pr-8 bg-white border border-border rounded-lg text-xs text-ink outline-none appearance-none cursor-pointer"
                          style={selectChevronStyle}
                        >
                          {ws.otherMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.email}) — current: {m.role}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-warning-subtle border border-warning-border rounded-lg text-[11px] text-warning">
                        You are the sole member of this workspace. It will be deleted along with all
                        its canvases and project assets.
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {hasSoleMemberWorkspaces && (
                <label className="flex items-start gap-2 pt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmSoleDeletion}
                    onChange={(e) => setConfirmSoleDeletion(e.target.checked)}
                    className="mt-0.5 rounded border-border-strong text-danger focus:ring-danger"
                  />
                  <span className="text-xs text-ink-muted">
                    I confirm permanently deleting the workspace(s) where I am the sole member.
                  </span>
                </label>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              You do not own any workspaces. Deleting your account will immediately remove all your
              personal session data.
            </p>
          )}

          <div className="pt-2 flex flex-col gap-1.5 border-t border-border-subtle">
            <Label className="text-xs font-semibold text-ink" htmlFor="confirm-delete-text">
              Type <strong>DELETE</strong> to confirm:
            </Label>
            <Input
              {...NOT_A_CREDENTIAL}
              id="confirm-delete-text"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-9 px-3 bg-paper border border-border rounded-xl text-xs font-mono text-ink outline-none focus:bg-white focus:border-danger"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 px-3.5 rounded-xl text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting || confirmText !== 'DELETE'}
              className="h-9 px-4 rounded-xl text-xs font-semibold"
            >
              {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
