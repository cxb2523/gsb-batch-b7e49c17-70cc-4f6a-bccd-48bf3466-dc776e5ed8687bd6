import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { errorMessage } from '@/lib/errors';
import { transferOwnership } from '@/features/workspaces/api';
import { workspaceKeys } from '@/features/workspaces/keys';
import { memberKeys } from '@/features/members/keys';
import type { WorkspaceMember } from '@/features/members/schemas';

/** Asks the Owner to confirm handing the workspace to an admin. A failure stays in the dialog. */
export function OwnershipTransferDialog({
  workspaceId,
  target,
  onClose,
}: {
  workspaceId: string;
  target: WorkspaceMember | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const transfer = async () => {
    if (!target) return;
    setIsTransferring(true);
    setError(null);
    try {
      await transferOwnership(workspaceId, { memberId: target.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.accessAll }),
        queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
        queryClient.invalidateQueries({ queryKey: memberKeys.all(workspaceId) }),
      ]);
      close();
      toast.success('Ownership transferred successfully');
    } catch (err) {
      setError(errorMessage(err) ?? 'Failed to transfer ownership');
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Transfer ownership"
      description={
        target
          ? `${target.name || target.email} becomes the Owner. You become an Admin. Only the Owner can delete the workspace or transfer it again.`
          : ''
      }
      confirmLabel="Transfer ownership"
      isPending={isTransferring}
      onConfirm={transfer}
    >
      {error && (
        <div className="p-3 bg-danger-subtle border border-danger-border text-danger text-xs rounded-xl font-medium">
          {error}
        </div>
      )}
    </ConfirmDialog>
  );
}
