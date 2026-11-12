import { useState } from 'react';
import { Modal } from '@/components/Modal';
import type { PendingGrant } from '@/features/projects/hooks/useProjectAccess';

/** Confirms a grant whose key is already prepared; nothing is sent until the person agrees. */
export function GrantAccessDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingGrant;
  onCancel: () => void;
  onConfirm: (pending: PendingGrant) => Promise<boolean>;
}) {
  const [isGranting, setIsGranting] = useState(false);
  const person = pending.member.name || pending.member.email;

  const confirm = async () => {
    setIsGranting(true);
    try {
      if (await onConfirm(pending)) onCancel();
    } finally {
      setIsGranting(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      showCloseButton={false}
      titleId="grant-access-title"
      className="max-w-md w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-sans"
    >
      <div>
        <h3 id="grant-access-title" className="text-base font-bold text-ink">
          Grant access to {person}
        </h3>
        <p className="text-xs text-ink-muted mt-1 leading-relaxed">
          Your browser has prepared this project's key for them. Once you confirm, they can open the
          project's canvases. Nothing has been sent yet.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
        <button
          type="button"
          disabled={isGranting}
          onClick={onCancel}
          className="px-4 py-2 border border-border bg-white hover:bg-paper text-ink rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isGranting}
          onClick={() => void confirm()}
          className="px-4 py-2 bg-ink hover:bg-ink-hover text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
        >
          {isGranting ? 'Granting...' : 'Confirm and grant'}
        </button>
      </div>
    </Modal>
  );
}
