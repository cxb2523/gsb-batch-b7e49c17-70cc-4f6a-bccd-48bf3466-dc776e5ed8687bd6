import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';

export type DeleteTargetType = 'project' | 'member' | 'invitation';

export interface DeleteTarget {
  type: DeleteTargetType;
  id: string;
  title: string;
  description: string;
}

const HEADINGS: Record<DeleteTargetType, string> = {
  project: 'Delete Project',
  member: 'Remove Member',
  invitation: 'Revoke Invitation',
};

const QUESTIONS: Record<DeleteTargetType, { before: string; after: string }> = {
  project: { before: 'Are you sure you want to delete ', after: '?' },
  member: { before: 'Are you sure you want to remove ', after: ' from the workspace?' },
  invitation: { before: 'Are you sure you want to revoke the invitation for ', after: '?' },
};

function Question({ target }: { target: DeleteTarget }) {
  const { before, after } = QUESTIONS[target.type];
  return (
    <>
      {before}
      <strong className="font-semibold text-ink">"{target.title}"</strong>
      {after} {target.description}
    </>
  );
}

/**
 * Confirms removing a project, member or invitation. `onConfirm` does the work and throws on
 * failure; the dialog reports the error and closes, leaving the list as the server has it.
 */
export function DeleteTargetDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: DeleteTarget | null;
  onClose: () => void;
  onConfirm: (target: DeleteTarget) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  if (!target) return null;

  const confirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm(target);
    } catch (err) {
      toast.error(errorMessage(err) ?? 'Operation failed');
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      showCloseButton={false}
      titleId="confirm-delete-title"
      className="max-w-md w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-mono"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-danger-soft border border-danger-border text-danger flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h3 id="confirm-delete-title" className="text-sm font-bold text-ink font-sans">
            {HEADINGS[target.type]}
          </h3>
          <p className="text-xs text-ink-muted mt-0.5 font-mono">
            This action is permanent and cannot be undone.
          </p>
        </div>
      </div>

      <p className="text-xs text-ink-muted font-sans leading-relaxed">
        <Question target={target} />
      </p>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={isDeleting}
          onClick={onClose}
          className="font-mono text-xs font-medium"
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          disabled={isDeleting}
          onClick={() => void confirm()}
          className="font-mono text-xs font-semibold"
        >
          {isDeleting ? 'Processing...' : HEADINGS[target.type]}
        </Button>
      </div>
    </Modal>
  );
}
