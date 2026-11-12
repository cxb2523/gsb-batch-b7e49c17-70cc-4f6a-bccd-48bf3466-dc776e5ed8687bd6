import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import { deleteBoard } from '../api';
import { boardKeys } from '../keys';
import type { Board } from '../schemas';

interface DeleteCanvasDialogProps {
  workspaceId: string;
  board: Board;
  onClose: () => void;
}

/** Stays open with the canvas untouched when the server refuses the deletion. */
export function DeleteCanvasDialog({ workspaceId, board, onClose }: DeleteCanvasDialogProps) {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteBoard(workspaceId, board.id);
      void queryClient.invalidateQueries({ queryKey: boardKeys.lists(workspaceId) });
      toast.success('Canvas deleted');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error) ?? 'Failed to delete canvas');
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
      titleId="delete-dialog-title"
      showCloseButton={false}
      className="max-w-md w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-sans"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-danger-soft border border-danger-soft-border text-danger-muted flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h3 id="delete-dialog-title" className="text-base font-bold text-ink">
            Delete Canvas
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            This action is permanent and cannot be undone.
          </p>
        </div>
      </div>

      <p className="text-xs text-ink-prose leading-relaxed">
        Are you sure you want to delete{' '}
        <strong className="font-semibold text-ink">"{board.title}"</strong>? All encrypted canvas
        data will be permanently removed.
      </p>

      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border-subtle">
        <Button variant="outline" size="sm" type="button" disabled={isDeleting} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          disabled={isDeleting}
          onClick={confirmDelete}
        >
          {isDeleting ? 'Deleting...' : 'Delete Canvas'}
        </Button>
      </div>
    </Modal>
  );
}
