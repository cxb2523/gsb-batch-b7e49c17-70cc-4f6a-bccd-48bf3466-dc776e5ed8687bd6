import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/button';

interface BoardLeaveDialogProps {
  onStay: () => void;
  onLeave: () => void;
}

/** Shown when the person tries to leave the canvas while changes are not saved yet. */
export function BoardLeaveDialog({ onStay, onLeave }: BoardLeaveDialogProps) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onStay();
      }}
      titleId="leave-dialog-title"
      showCloseButton={false}
      className="max-w-md w-full bg-white border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 font-sans"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-warning-subtle border border-warning-border text-warning flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h3 id="leave-dialog-title" className="text-base font-bold text-ink">
            Leave this canvas?
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">Your latest changes are not saved yet.</p>
        </div>
      </div>

      <p className="text-xs text-ink-prose leading-relaxed">
        If you leave now, a change that is still waiting is sent first. Anything that could not be
        saved stays on this device, and you can restore it the next time you open this canvas.
      </p>

      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border-subtle">
        <Button variant="outline" size="sm" type="button" onClick={onLeave}>
          Leave anyway
        </Button>
        <Button size="sm" type="button" onClick={onStay}>
          Stay on this canvas
        </Button>
      </div>
    </Modal>
  );
}
